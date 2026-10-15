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
