/**
 * Turning raw command output into something a model can act on, and into
 * something two runs can be compared on.
 *
 * Two jobs, deliberately separate:
 *
 *  1. {@link prepareOutputForModel} - ANSI stripped, byte-capped, head+tail
 *     preserved. A failing suite can emit megabytes; feeding that raw both
 *     blows the context window and buries the actual error.
 *  2. {@link signatureOf} - a stable fingerprint used to answer "did anything
 *     change since last time?". This is the input to the loop's stop rules,
 *     so it has to be blind to everything that legitimately varies between
 *     two runs of the same broken code.
 *
 * The distinction matters: a duration of "1.2s" vs "1.3s" must not read as
 * progress, but it must also still be visible to the model - so (1) keeps it
 * and (2) drops it.
 */

import {createHash} from 'node:crypto';

// Escape-sequence prefixes are built from char codes instead of being written
// as literal control bytes or \u escapes. Either form is invisible in an
// editor, gets normalised away by some tooling, and turns a one-line diff into
// an unreadable one. Spelling them out keeps the patterns reviewable.
const ESC = String.fromCharCode(0x1b); // ESC
const CSI_8BIT = String.fromCharCode(0x9b); // 8-bit CSI
const BEL = String.fromCharCode(0x07); // BEL
const BACKSLASH = String.fromCharCode(0x5c); // \

// Three scoped patterns rather than one monolithic "ansi-regex". The popular
// single-expression version does not handle spaces inside an OSC string
// (ESC ] 0 ;my window title BEL), so it silently strands the payload in the
// output. Split by escape type, and applied in this order: ESCAPE on its own
// would eat the introducer of a CSI sequence and leave its parameters behind.

// OSC:  ESC ] <payload> (BEL | ST). Window titles, hyperlinks, clipboard.
const OSC_PATTERN = new RegExp(
	ESC +
		'\\][^' +
		BEL +
		ESC +
		']*(?:' +
		BEL +
		'|' +
		ESC +
		BACKSLASH +
		BACKSLASH +
		')',
	'g',
);

// CSI:  ESC [ <params> <intermediates> <final>. Colours, cursor movement.
const CSI_PATTERN = new RegExp(
	'[' + ESC + CSI_8BIT + ']\\[[0-?]*[ -/]*[@-~]',
	'g',
);

// Two-character escapes: ESC c (reset), ESC ( B, ESC 7, ...
const ESCAPE_PATTERN = new RegExp(ESC + '[@-_]', 'g');

/**
 * Fixed allowance so the elision marker can never push output past the cap.
 * Only usable once the cap is larger than the marker itself - see the
 * small-cap branch in {@link prepareOutputForModel}.
 */
const MARKER_RESERVE_BYTES = 64;

/** Share of the budget kept from the head. Failures often start with setup. */
const HEAD_SHARE = 0.4;

export interface PreparedOutput {
	text: string;
	truncated: boolean;
	originalBytes: number;
}

/**
 * Remove escape sequences. Test runners colour output even when it is piped,
 * and the codes cost context window and confuse the model.
 */
export function stripAnsi(input: string): string {
	return input
		.replace(OSC_PATTERN, '')
		.replace(CSI_PATTERN, '')
		.replace(ESCAPE_PATTERN, '');
}

/**
 * Cut to `maxBytes`, keeping the head and the tail.
 *
 * The tail matters most: a stack trace, the assertion diff, and the summary
 * line all land at the end. The head is not worthless either - the run banner
 * and the first failure live at the top - so both ends survive and the middle
 * is elided with an explicit marker, so the model can tell it is not looking
 * at contiguous output.
 */
export function prepareOutputForModel(
	input: string,
	maxBytes: number,
): PreparedOutput {
	const buffer = Buffer.from(input, 'utf-8');
	const originalBytes = buffer.byteLength;

	if (maxBytes <= 0 || originalBytes <= maxBytes) {
		return {text: input, truncated: false, originalBytes};
	}

	// A cap smaller than the elision marker cannot carry the marker. Reserve
	// the whole budget for the tail and say nothing, rather than emit a result
	// that overran the caller's cap - the cap exists to bound how much text
	// reaches the model, so exceeding it is worse than losing the explanation.
	if (maxBytes <= MARKER_RESERVE_BYTES) {
		const tail = stripLeadingReplacement(
			buffer.subarray(originalBytes - maxBytes).toString('utf-8'),
		);
		return {text: tail, truncated: true, originalBytes};
	}

	const budget = maxBytes - MARKER_RESERVE_BYTES;
	const headBytes = Math.floor(budget * HEAD_SHARE);
	const tailBytes = budget - headBytes;

	// Buffer#toString over a byte range that lands mid-codepoint yields
	// U+FFFD. The head is scrubbed from the end, the tail from the start.
	const head = stripTrailingReplacement(
		buffer.subarray(0, headBytes).toString('utf-8'),
	);
	const tail = stripLeadingReplacement(
		buffer.subarray(originalBytes - tailBytes).toString('utf-8'),
	);

	const omitted = originalBytes - headBytes - tailBytes;
	const marker = `\n... ${omitted} bytes omitted ...\n`;

	return {
		text: head + marker + tail,
		truncated: true,
		originalBytes,
	};
}

function stripTrailingReplacement(text: string): string {
	let end = text.length;
	while (end > 0 && text.charCodeAt(end - 1) === 0xfffd) end--;
	return text.slice(0, end);
}

function stripLeadingReplacement(text: string): string {
	let start = 0;
	while (start < text.length && text.charCodeAt(start) === 0xfffd) start++;
	return text.slice(start);
}

/**
 * Everything that legitimately differs between two runs of the same broken
 * code, replaced with a placeholder.
 *
 * Ordered most-specific first: "sec" has to be tried before the bare "s", and
 * the home-directory rule before the Windows-path rule (a path can contain
 * digits that otherwise read as a duration).
 */
export function normalizeForSignature(input: string): string {
	let text = stripAnsi(input);

	text = text.replace(/\r\n?/g, '\n');

	// Wall-clock durations: "in 1.2s", "(842ms)", "took 3 s", "1.5m".
	// Longest alternative first - JS alternation is leftmost-first, so "sec"
	// must be tried before "s" or "1.2sec" would normalise to "1.2<dur>c".
	// The trailing \b is what keeps "3 files" from matching the bare "s".
	text = text.replace(
		/\b\d+(?:\.\d+)?\s*(?:nanoseconds|nanosec|ns|milliseconds|millis|msec|ms|microseconds|usec|us|seconds|second|secs|sec|s|minutes|minute|mins|min|m|hours|hour|hrs|hr|h)\b/gi,
		'<dur>',
	);
	// Byte and memory counts: "512MB", "1.5 GB", "4096 bytes".
	text = text.replace(
		/\b\d+(?:\.\d+)?\s*(?:bytes|byte|kb|mb|gb|tb|b)\b/gi,
		'<size>',
	);
	// The user's home directory: stable per machine, meaningless for identity,
	// and a privacy leak if a signature is ever logged.
	text = text.replace(/[A-Za-z]:\\Users\\[^\\\s"']+/g, '<home>');
	text = text.replace(/\/(?:home|Users)\/[^/\s"']+/g, '<home>');
	// Temp dirs: parallel runners append a per-worker suffix.
	text = text.replace(/\/(?:tmp|var\/folders)\/[\w.-]+/g, '<tmp>');
	// pids, ports, and pointer values.
	text = text.replace(/\b(?:pid|process)\s*[:=]?\s*\d+/gi, 'pid=<n>');
	text = text.replace(/\bport\s*[:=]?\s*\d+/gi, 'port=<n>');
	text = text.replace(/\b0x[0-9a-f]+\b/gi, '<hex>');
	// Absolute Windows paths outside Users (temp dirs, worktrees).
	text = text.replace(/\b[A-Za-z]:\\[^\s"']+/g, '<path>');

	return (
		text
			.split('\n')
			.map(line => line.trim())
			.filter(line => line !== '')
			// Sort: the single most important normalisation here. Parallel
			// runners interleave their output differently on every run, so two
			// runs of identical failures produce different line orders. Without
			// this the "no progress" stop rule would never fire and the loop
			// would burn every attempt re-reading the same errors.
			.sort()
			.join('\n')
	);
}

/**
 * Stable fingerprint of a command run, for identity comparison only.
 *
 * Never display this and never feed it to a model - it exists so the loop can
 * ask "is this the same failure as last time?".
 */
export function signatureOf(input: string): string {
	return createHash('sha256')
		.update(normalizeForSignature(input), 'utf-8')
		.digest('hex')
		.slice(0, 16);
}
