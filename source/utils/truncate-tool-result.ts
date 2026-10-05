import {MAX_TOOL_RESULT_CHARS} from '@/constants';

const HEAD_SHARE = 0.4;

// Matches prompt-scrub's placeholder token exactly (see
// @nanocollective/prompt-scrub's rehydrate.ts). Scrubbing runs before this
// truncation's own caller re-truncates a result that expanded past the cap
// (placeholders can be longer than what they replace), so a cut has to know
// about these tokens to avoid landing inside one.
const PLACEHOLDER_PATTERN = /«[A-Za-z]+_\d+»/g;

function createElisionMarker(totalLength: number): string {
	return `\n... [Output truncated: ${totalLength} characters total; request a narrower result to inspect omitted content] ...\n`;
}

/**
 * If `index` falls strictly inside a «Category_N» placeholder token, move it
 * to the token's start (`bias: 'before'`) or end (`bias: 'after'`) so the cut
 * excludes the token whole instead of splitting it. Both directions push the
 * cut away from the kept content and into the elided middle, so the result
 * never grows past the caller's budget.
 */
function snapOutsidePlaceholder(
	content: string,
	index: number,
	bias: 'before' | 'after',
): number {
	for (const match of content.matchAll(PLACEHOLDER_PATTERN)) {
		const start = match.index ?? 0;
		const end = start + match[0].length;
		if (index > start && index < end) {
			return bias === 'before' ? start : end;
		}
		if (start > index) break;
	}
	return index;
}

// How far a cut may move to reach whitespace. Past this the text is one long
// unbroken run (minified output, base64) and a hard cut is the only option.
const MAX_TOKEN_SNAP = 256;

/**
 * Move a cut out of the middle of a whitespace-delimited token: back to the
 * whitespace before it (`bias: 'before'`) or forward to the whitespace after
 * it (`bias: 'after'`), into the elided middle either way.
 *
 * This runs before scrubbing on tools that bound their own output (bash).
 * A cut through a secret left a fragment like `sk-live-abcdef1234` that no
 * detector recognises any more, so part of the key went to the provider even
 * with scrubbing on. Dropping the token whole means a secret is either kept
 * intact, where the scrubber catches it, or not sent at all.
 */
function snapOutsideToken(
	content: string,
	index: number,
	bias: 'before' | 'after',
): number {
	const isSpace = (char: string | undefined) =>
		char === undefined || /\s/.test(char);
	if (index <= 0 || index >= content.length) return index;
	if (isSpace(content[index - 1]) || isSpace(content[index])) return index;
	if (bias === 'before') {
		for (let i = index; i > index - MAX_TOKEN_SNAP && i > 0; i--) {
			if (isSpace(content[i - 1])) return i;
		}
	} else {
		for (let i = index; i < index + MAX_TOKEN_SNAP && i < content.length; i++) {
			if (isSpace(content[i])) return i;
		}
	}
	return index;
}

/**
 * Bound text returned by a tool before it is added to model context.
 *
 * Keeping the tail is important for compiler, test-runner, and command output,
 * where the actionable summary usually appears after the verbose beginning.
 */
export function truncateToolResult(
	content: string,
	maxLength = MAX_TOOL_RESULT_CHARS,
): string {
	if (content.length <= maxLength) return content;
	if (maxLength <= 0) return '';

	const marker = createElisionMarker(content.length);
	const contentBudget = maxLength - marker.length;
	if (contentBudget <= 0) return marker.slice(0, maxLength);

	const headLength = Math.floor(contentBudget * HEAD_SHARE);
	const tailLength = contentBudget - headLength;

	const headEnd = snapOutsideToken(
		content,
		snapOutsidePlaceholder(content, headLength, 'before'),
		'before',
	);
	const tailStart = Math.max(
		headEnd,
		snapOutsideToken(
			content,
			snapOutsidePlaceholder(content, content.length - tailLength, 'after'),
			'after',
		),
	);

	return content.slice(0, headEnd) + marker + content.slice(tailStart);
}
