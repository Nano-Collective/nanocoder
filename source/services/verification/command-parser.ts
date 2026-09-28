/**
 * Parsing for the user-configured verification command.
 *
 * Two shapes are supported:
 *
 *  - **Array form** (recommended): `["npm", "run", "test:ci"]`. Each element
 *    becomes one argv entry, verbatim. Nothing is interpreted, so this is the
 *    only shape that is safe on every platform without further checks.
 *  - **String form**: `"npm run test:ci"`. Tokenised with POSIX-ish quoting
 *    (single quotes are literal, double quotes honour `\\` and `\"`), then each
 *    resulting token is screened for shell metacharacters.
 *
 * ## Why the string form rejects metacharacters instead of running them
 *
 * On POSIX we never spawn a shell, so `npm test && rm -rf build` would quietly
 * run only `npm test`. That is a footgun, not a feature — and it is exactly
 * the kind of thing a user writes once, gets a silent no-op, and never
 * reports. On Windows the runner *must* use a shell to execute the `npm.cmd`
 * shim (see `runner.ts`), so there a metacharacter is not inert: it is live.
 *
 * Rejecting in the parser closes the Windows hole and makes the failure
 * explicit on both platforms. The alternative — accept `&&` and honour it —
 * was rejected because it makes one config file behave differently per
 * platform, which is worse than an error message pointing at the array form.
 */

export interface ParsedCommand {
	/** argv[0]. Never contains a path separator unless the user wrote one. */
	command: string;
	/** argv[1..]. May be empty; never contains shell metacharacters. */
	args: string[];
	/**
	 * Human-readable rendering for logs and UI. Quoting is *not* restored —
	 * this is for display only and is never fed back to a shell.
	 */
	display: string;
}

export type CommandParseResult =
	| {ok: true; value: ParsedCommand}
	| {ok: false; error: string};

/**
 * Characters that signal shell intent: command chaining (`; & |`), redirection
 * (`< > ^`), substitution (`` ` ``, `$`), grouping (`( ) { }`), history
 * expansion (`!`), variable expansion (`%`), and glob/tilde expansion
 * (`* ? ~`).
 *
 * Absent from this set, and therefore allowed: `- _ . : , / \ = @ + #` — which
 * together cover the overwhelming majority of real test invocations
 * (`--reporter=dot`, `./gradlew`, `src/foo.test.ts:12`).
 */
const SHELL_METACHARACTERS = /[;&|<>^$(){}\r\n`!*?~%]/;

const METACHARACTER_HELP =
	'The array form passes each element straight to the process with no ' +
	'interpretation, and is supported on every platform: ' +
	'`"command": ["npm", "run", "test:ci"]`.';

/**
 * Tokenise a command string, honouring single and double quotes.
 *
 * Returns `null` for input the user has to fix (unterminated quote, trailing
 * backslash); every other input yields at least one token, because `''` is a
 * legitimate empty argument and is tracked separately from "no token yet".
 */
function tokenize(input: string): string[] | null {
	const tokens: string[] = [];
	let current = '';
	// Distinguishes `''` (one empty argument) from `''` (no argument), which
	// POSIX treats differently and which `if (current)` would collapse.
	let hasToken = false;
	let i = 0;

	while (i < input.length) {
		const char = input[i];

		if (/\s/.test(char)) {
			if (hasToken) {
				tokens.push(current);
				current = '';
				hasToken = false;
			}
			i++;
			continue;
		}

		if (char === "'") {
			i++;
			hasToken = true;
			while (i < input.length && input[i] !== "'") {
				current += input[i];
				i++;
			}
			if (i >= input.length) return null;
			i++;
			continue;
		}

		if (char === '"') {
			i++;
			hasToken = true;
			while (i < input.length && input[i] !== '"') {
				// Only `\"` and `\\` are escapes; a lone backslash before any
				// other character stays literal, matching POSIX shells.
				if (input[i] === '\\' && i + 1 < input.length) {
					const next = input[i + 1];
					if (next === '"' || next === '\\') {
						current += next;
						i += 2;
						continue;
					}
				}
				current += input[i];
				i++;
			}
			if (i >= input.length) return null;
			i++;
			continue;
		}

		current += char;
		hasToken = true;
		i++;
	}

	if (hasToken) tokens.push(current);
	return tokens;
}

function describeMetacharacter(char: string): string {
	const named: Record<string, string> = {
		';': ';',
		'&': '&',
		'|': '|',
		'<': '<',
		'>': '>',
		'^': '^',
		$: '$',
		'(': '(',
		')': ')',
		'{': '{',
		'}': '}',
		'`': '`',
		'!': '!',
		'*': '*',
		'?': '?',
		'~': '~',
		'%': '%',
		'\r': '\\r',
		'\n': '\\n',
	};
	return named[char] ?? char;
}

function toDisplay(command: string, args: string[]): string {
	return [command, ...args].join(' ');
}

/**
 * Normalise either configured shape into a {@link ParsedCommand}.
 *
 * Pure and platform-independent: the Windows shell decision is made by the
 * runner, after the metacharacter screen has already run.
 */
export function parseVerificationCommand(
	input: string | readonly string[] | undefined,
): CommandParseResult {
	if (input === undefined) {
		return {ok: false, error: 'No verification command is configured.'};
	}

	// --- array form ---------------------------------------------------------
	if (Array.isArray(input)) {
		const tokens = input as readonly string[];
		if (tokens.length === 0) {
			return {
				ok: false,
				error: 'Verification command array is empty.',
			};
		}
		const [command, ...args] = tokens;
		if (typeof command !== 'string' || command.trim() === '') {
			return {
				ok: false,
				error: 'Verification command must start with a program name.',
			};
		}
		for (const arg of args) {
			if (typeof arg !== 'string') {
				return {
					ok: false,
					error: 'Verification command array must contain only strings.',
				};
			}
		}
		// Deliberately *not* screened here. The array form is how a user opts
		// out of interpretation, and a metacharacter is only ever interpreted
		// if the command reaches a shell. The runner re-screens every argv
		// immediately before it enables one (see `findShellMetacharacter`) —
		// that runtime check, not this one, is what keeps Windows safe, and
		// putting it here would break legitimate argv like `["sh", "-c", "x"]`.
		return {
			ok: true,
			value: {command, args: [...args], display: toDisplay(command, args)},
		};
	}

	// --- string form --------------------------------------------------------
	if (typeof input !== 'string') {
		return {
			ok: false,
			error: 'Verification command must be a string or an array of strings.',
		};
	}

	const trimmed = input.trim();
	if (trimmed === '') {
		return {
			ok: false,
			error: 'Verification command is empty.',
		};
	}

	// Rejected before tokenising, not after. A newline is whitespace, so the
	// tokeniser would happily split "npm test\nrm -rf /" into a harmless-looking
	// argv — on POSIX it genuinely is harmless, but the same bytes are a
	// command separator on Windows. Screening the raw input means the check
	// cannot be routed around by quoting.
	if (/[\r\n]/.test(trimmed)) {
		return {
			ok: false,
			error: metacharacterError('\\n'),
		};
	}

	const tokens = tokenize(trimmed);
	if (tokens === null) {
		return {
			ok: false,
			error: `Unterminated quote in verification command: ${JSON.stringify(trimmed)}. ${METACHARACTER_HELP}`,
		};
	}
	if (tokens.length === 0) {
		return {ok: false, error: 'Verification command is empty.'};
	}

	for (const token of tokens) {
		const match = SHELL_METACHARACTERS.exec(token);
		if (match) {
			return {ok: false, error: metacharacterError(match[0])};
		}
	}

	const [command, ...args] = tokens;
	return {
		ok: true,
		value: {command, args, display: toDisplay(command, args)},
	};
}

function metacharacterError(char: string): string {
	return (
		`Verification command must not contain "${describeMetacharacter(char)}". ` +
		`Nanocoder runs the command directly, never through a shell, so ` +
		`chaining, redirection, and substitution would be silently ignored ` +
		`on macOS/Linux and executed on Windows. ${METACHARACTER_HELP}`
	);
}

/**
 * First shell metacharacter in `tokens`, or `null` when the argv is safe to
 * hand to `cmd.exe` / `sh -c`.
 *
 * The parser applies this to the string form so the user gets an actionable
 * error at configuration time. The runner applies it to *every* argv right
 * before enabling a shell — including the array form, which is why the array
 * form is not screened during parsing. Two call sites, one rule: nothing
 * reaches a shell that this function would reject.
 */
export function findShellMetacharacter(
	tokens: readonly string[],
): string | null {
	for (const token of tokens) {
		const match = SHELL_METACHARACTERS.exec(token);
		if (match) return describeMetacharacter(match[0]);
	}
	return null;
}
