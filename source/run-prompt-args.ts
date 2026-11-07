/**
 * Which argv entries after `run` are the prompt, and which are flags.
 *
 * This lives in its own module for one reason: it used to live inside
 * `cli.tsx` with a hand-written copy of itself in `cli.spec.ts`, and the copy
 * fell six flags behind the original — `--mode`, `--json`, `--output-format`,
 * `--trust-directory` and the alt-screen pair were stripped by the parser and
 * left in the prompt by the copy. The tests passed against a parser nobody
 * ships. A duplicate that can drift will, and no test written against the
 * duplicate can notice, because it is testing the duplicate.
 *
 * Deliberately free of imports: `cli.tsx` keeps its top-level import graph
 * empty so `--version` and `--help` stay a fast path, and this must not be
 * what breaks that.
 */

/** A flag taking a value: `--flag value` or `--flag=value`. */
const VALUED_FLAGS = [
	'--vscode-port',
	'--provider',
	'--model',
	'--context-max',
	'--mode',
	'--output-format',
	'--prompt-file',
] as const;

/** A flag standing alone. */
const BARE_FLAGS = [
	'--vscode',
	'--json',
	'--trust-directory',
	'--plain',
	'--no-plain',
	'--alt-screen',
	'--no-alt-screen',
	// Display concerns, like the alt-screen pair above. Meaningless on a
	// non-interactive run, but a user who passes one should not have it become
	// the first two words of their prompt.
	'--mouse',
	'--no-mouse',
] as const;

/**
 * The prompt built from the words after `run`, with every known flag removed.
 * Returns undefined when there is no `run` command, or nothing after it.
 */
export function parseRunPrompt(args: string[]): string | undefined {
	const runCommandIndex = args.indexOf('run');
	if (runCommandIndex === -1 || !args[runCommandIndex + 1]) {
		return undefined;
	}

	const afterRunArgs = args.slice(runCommandIndex + 1);
	const promptArgs: string[] = [];
	for (let i = 0; i < afterRunArgs.length; i++) {
		const arg = afterRunArgs[i];
		if (VALUED_FLAGS.some(flag => arg === flag)) {
			i++; // skip the value too
			continue;
		}
		if (VALUED_FLAGS.some(flag => arg.startsWith(`${flag}=`))) {
			continue; // fused form carries its own value
		}
		if (BARE_FLAGS.some(flag => arg === flag)) {
			continue;
		}
		promptArgs.push(arg);
	}
	return promptArgs.join(' ');
}

/** Flags taking a value. Exported so tests cover them from the source list. */
export const RUN_FLAGS_WITH_VALUES: readonly string[] = VALUED_FLAGS;

/** Flags standing alone. Exported for the same reason. */
export const RUN_FLAGS_STANDALONE: readonly string[] = BARE_FLAGS;

/** Every flag this parser removes. */
export const KNOWN_RUN_FLAGS: readonly string[] = [
	...VALUED_FLAGS,
	...BARE_FLAGS,
];

/**
 * `--prompt-file -` means "read the prompt from stdin", the usual Unix
 * spelling. Without it a Windows user has no way to say so (`/dev/stdin` does
 * not exist there) and a Unix user has to know about the device file.
 */
export const STDIN_PROMPT_FILE = '-';

/** Slice to at most `max` UTF-16 units without leaving half a surrogate pair. */
function sliceWholeCharacters(text: string, max: number): string {
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	const last = cut.charCodeAt(cut.length - 1);
	// A high surrogate at the end has lost its pair to the cut.
	return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * Read piped text from `stream`, stopping once more than `max` characters have
 * arrived.
 *
 * Reads at most `max + 1` characters: the extra one is how the caller learns
 * the input was longer than the cap, without buffering a pipe of unbounded
 * size just to measure it. Stopping early destroys the stream, which hands the
 * writer a closed pipe instead of making it wait on a reader that has gone.
 */
export async function readStdinText(
	stream: AsyncIterable<string | Uint8Array>,
	max: number,
): Promise<string> {
	const decoder = new TextDecoder('utf-8');
	let text = '';
	for await (const chunk of stream) {
		text +=
			typeof chunk === 'string' ? chunk : decoder.decode(chunk, {stream: true});
		if (text.length > max) break;
	}
	return text;
}

/**
 * Fold piped stdin into the run prompt.
 *
 * - No usable stdin (empty, or only whitespace): the prompt is unchanged, so a
 *   non-TTY with nothing piped (CI with stdin on /dev/null) behaves as before.
 * - Stdin and a prompt: the text follows the prompt in a <stdin> block, so the
 *   model can tell the instruction from the material it applies to.
 * - Stdin alone: the text is the prompt.
 *
 * Text over `max` characters is cut (never mid-surrogate-pair) and says so,
 * so neither the model nor the person reading the transcript takes a partial
 * pipe for the whole thing.
 */
export function composePromptWithStdin(
	prompt: string | undefined,
	stdin: string,
	max: number,
): string | undefined {
	if (!stdin.trim()) return prompt;

	const truncated = stdin.length > max;
	let body = sliceWholeCharacters(stdin, max).trimEnd();
	if (truncated) {
		body += `\n\n[stdin truncated - kept the first ${body.length} characters]`;
	}

	if (!prompt?.trim()) return body;
	return `${prompt}\n\n<stdin>\n${body}\n</stdin>`;
}
