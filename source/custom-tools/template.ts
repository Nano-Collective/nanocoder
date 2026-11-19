/**
 * Mustache-flavoured template rendering for custom tool script bodies.
 *
 * Supported syntax:
 *   {{ name }}                — shell-quoted substitution of `args[name]`
 *   {{# name }}…{{/ name }}   — section: included only when `args[name]` is
 *                                truthy. Inside the section, `{{ name }}`
 *                                expands to the (still shell-quoted) value.
 *   {{^ name }}…{{/ name }}   — inverted section: included only when
 *                                `args[name]` is falsy/empty (the complement
 *                                of `{{# name }}`).
 *
 * Scalar values are passed through the quote function for the selected shell.
 * Arrays are joined into a single space-separated string with each element
 * individually quoted.
 */

import {expandSections} from '@/utils/template-sections';

/**
 * Wrap a string in POSIX-safe single quotes.
 *
 * The only character that can't appear inside single-quoted strings is
 * another single quote, so we close the quote, escape it, and reopen.
 *
 *   "  ;rm -rf /;  "  →  "'  ;rm -rf /;  '"
 *   "it's a test"     →  "'it'\\''s a test'"
 */
export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Wrap a string in cmd.exe-safe double quotes.
 *
 * Percent expansion cannot be escaped reliably in a command string, and
 * newlines would introduce another command. Reject those values instead of
 * silently changing them. Other cmd metacharacters stay literal inside the
 * surrounding double quotes.
 */
export function cmdQuote(value: string): string {
	if (/[\0%\r\n]/.test(value)) {
		throw new Error(
			'cmd.exe arguments cannot contain percent signs, carriage returns, newlines, or null bytes',
		);
	}
	return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Render an argument value as a shell-safe token (or token list, for arrays).
 */
export function renderValue(
	value: unknown,
	quote: (value: string) => string = shellQuote,
): string {
	if (value === null || value === undefined) return '';
	if (Array.isArray(value)) {
		return value.map(v => quote(stringify(v))).join(' ');
	}
	return quote(stringify(value));
}

function stringify(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean')
		return String(value);
	return JSON.stringify(value);
}

/**
 * Whether an argument should activate a `{{# name }}…{{/ name }}` section.
 * Empty strings, empty arrays, zero, false, null, and undefined are all
 * treated as "not provided".
 */
function isTruthyArg(value: unknown): boolean {
	if (value === null || value === undefined) return false;
	if (typeof value === 'string') return value.length > 0;
	if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
	if (typeof value === 'boolean') return value;
	if (Array.isArray(value)) return value.length > 0;
	return true;
}

/**
 * Render a template body against a bag of arguments.
 *
 * Sections are expanded first (recursively), then plain substitutions. This
 * lets section bodies contain `{{ name }}` references to the gating var.
 */
export function renderBody(
	body: string,
	args: Record<string, unknown>,
	quote: (value: string) => string = shellQuote,
): string {
	const afterSections = expandSections(body, name => isTruthyArg(args[name]));
	return expandSubstitutions(afterSections, args, quote);
}

// ---------------------------------------------------------------------------
// Placeholder context check
//
// A substituted value is safe only where the shell reads the quoting we add.
// Put a placeholder inside "…" and our single quotes become literal while
// $(…) in the value still runs; inside '…' our quotes close the author's and
// the value lands unquoted; in a comment or here-document a newline in the
// value starts a new command. Rendering can't fix those from the inside, so
// a body that puts a placeholder there is rejected when the tool loads.
// ---------------------------------------------------------------------------

type BodyToken =
	| {kind: 'char'; c: string}
	| {kind: 'value'; name: string}
	| {kind: 'section'; sigil: '#' | '^' | '/'; name: string};

const TOKEN_RE = /\{\{\s*([#^/]?)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}|[\s\S]/g;

function tokenizeBody(body: string): BodyToken[] {
	const tokens: BodyToken[] = [];
	for (const match of body.matchAll(TOKEN_RE)) {
		const name = match[2];
		if (name === undefined) {
			tokens.push({kind: 'char', c: match[0]});
		} else if (match[1]) {
			tokens.push({
				kind: 'section',
				sigil: match[1] as '#' | '^' | '/',
				name,
			});
		} else {
			tokens.push({kind: 'value', name});
		}
	}
	return tokens;
}

/** Characters after which a `#` starts a POSIX comment. */
const WORD_BREAK = /[\s;&|()<>]/;

/**
 * One level of POSIX quoting. `code` is shell code (the top level, `$(...)`
 * or a backtick substitution, ended by `end`); `depth` counts nested parens
 * in code and braces in `${...}`.
 */
interface PosixFrame {
	kind: 'code' | 'single' | 'ansi' | 'double' | 'param';
	end?: ')' | '`';
	depth: number;
}

const POSIX_REASON: Record<string, string> = {
	single:
		"is inside a '...' string, so the value's own quotes close it and the value ends up unquoted",
	ansi: "is inside a $'...' string, so the value's own quotes close it and the value ends up unquoted",
	double:
		'is inside a "..." string, where the quotes added around the value are literal and $(...) or backticks in the value still run',
	param:
		'is inside a ${...} expansion, where the quotes added around the value are not reliable',
	comment:
		'is inside a # comment, where a newline in the value would end the comment and run the rest',
	heredoc:
		'is inside a here-document, where $(...) in the value runs and a line in the value can end the document early',
	backslash:
		'follows a backslash, which escapes the opening quote added around the value',
	dollar: "follows a $, which turns the value's quoting into $'...' escapes",
};

function posixProblem(tokens: BodyToken[]): string | undefined {
	const stack: PosixFrame[] = [{kind: 'code', depth: 0}];
	const sections: Array<{name: string; signature: string}> = [];
	const pendingHeredocs: Array<{delimiter: string; stripTabs: boolean}> = [];
	let prev = '\n';
	let i = 0;

	const top = () => stack[stack.length - 1] as PosixFrame;
	const signature = () => stack.map(frame => frame.kind).join('>');
	const charAt = (index: number) => {
		const token = tokens[index];
		return token?.kind === 'char' ? token.c : undefined;
	};
	const fail = (name: string, reason: string) =>
		`Placeholder {{ ${name} }} ${POSIX_REASON[reason]}. Values are already quoted for the shell, so don't wrap a placeholder in quotes. Use it bare, or assign it first (${name}={{ ${name} }}) and use "$${name}".`;

	// Skip the bodies of here-documents that start on the line just ended.
	const skipHeredocs = (): string | undefined => {
		while (pendingHeredocs.length > 0) {
			const {delimiter, stripTabs} = pendingHeredocs.shift() as {
				delimiter: string;
				stripTabs: boolean;
			};
			for (;;) {
				if (i >= tokens.length) return undefined;
				let line = '';
				while (i < tokens.length && charAt(i) !== '\n') {
					const token = tokens[i] as BodyToken;
					if (token.kind === 'value') return fail(token.name, 'heredoc');
					if (token.kind === 'char') line += token.c;
					i++;
				}
				i++; // the newline
				const text = stripTabs ? line.replace(/^\t+/, '') : line;
				if (text === delimiter) break;
			}
		}
		return undefined;
	};

	while (i < tokens.length) {
		const token = tokens[i] as BodyToken;
		const frame = top();

		if (token.kind === 'section') {
			if (token.sigil === '/') {
				const open = sections.pop();
				if (open && open.signature !== signature()) {
					return `Section {{# ${open.name} }}...{{/ ${open.name} }} opens and closes in different quoting contexts, so including or leaving it out changes how the rest of the body is quoted. Keep quotes balanced inside a section.`;
				}
			} else {
				sections.push({name: token.name, signature: signature()});
			}
			i++;
			continue;
		}

		if (token.kind === 'value') {
			if (frame.kind !== 'code') return fail(token.name, frame.kind);
			if (prev === '$') return fail(token.name, 'dollar');
			prev = "'";
			i++;
			continue;
		}

		const c = token.c;
		const next = charAt(i + 1);
		const escaped = tokens[i + 1];
		if (c === '\\' && frame.kind !== 'single' && escaped?.kind === 'value') {
			return fail(
				escaped.name,
				frame.kind === 'code' ? 'backslash' : frame.kind,
			);
		}

		if (frame.kind === 'single') {
			if (c === "'") stack.pop();
		} else if (frame.kind === 'ansi') {
			if (c === '\\') i++;
			else if (c === "'") stack.pop();
		} else if (frame.kind === 'param') {
			if (c === '{') frame.depth++;
			else if (c === '}' && frame.depth-- === 0) stack.pop();
		} else if (frame.kind === 'double') {
			if (c === '\\') {
				i++;
			} else if (c === '"') {
				stack.pop();
			} else if (c === '`') {
				stack.push({kind: 'code', end: '`', depth: 0});
			} else if (c === '$' && next === '(') {
				stack.push({kind: 'code', end: ')', depth: 0});
				i++;
			} else if (c === '$' && next === '{') {
				stack.push({kind: 'param', depth: 0});
				i++;
			}
		} else {
			// Shell code: top level, $(...) or `...`.
			if (c === '\\') {
				i += 2;
				prev = 'x';
				continue;
			}
			if (c === "'") {
				stack.push({kind: prev === '$' ? 'ansi' : 'single', depth: 0});
			} else if (c === '"') {
				stack.push({kind: 'double', depth: 0});
			} else if (c === '`') {
				if (frame.end === '`') stack.pop();
				else stack.push({kind: 'code', end: '`', depth: 0});
			} else if (c === '$' && next === '(') {
				stack.push({kind: 'code', end: ')', depth: 0});
				i += 2;
				prev = '(';
				continue;
			} else if (c === '$' && next === '{') {
				stack.push({kind: 'param', depth: 0});
				i += 2;
				prev = '{';
				continue;
			} else if (c === '(') {
				frame.depth++;
			} else if (c === ')') {
				if (frame.depth > 0) frame.depth--;
				else if (frame.end === ')') stack.pop();
			} else if (c === '#' && WORD_BREAK.test(prev)) {
				while (i < tokens.length && charAt(i) !== '\n') {
					const inComment = tokens[i] as BodyToken;
					if (inComment.kind === 'value') {
						return fail(inComment.name, 'comment');
					}
					i++;
				}
				continue;
			} else if (
				c === '<' &&
				next === '<' &&
				prev !== '<' &&
				charAt(i + 2) !== '<'
			) {
				i += 2;
				const stripTabs = charAt(i) === '-';
				if (stripTabs) i++;
				while (charAt(i) === ' ' || charAt(i) === '\t') i++;
				let delimiter = '';
				while (i < tokens.length) {
					const part = tokens[i] as BodyToken;
					if (part.kind === 'value') return fail(part.name, 'heredoc');
					if (part.kind !== 'char' || /[\s;&|()<>]/.test(part.c)) break;
					if (part.c !== "'" && part.c !== '"' && part.c !== '\\') {
						delimiter += part.c;
					}
					i++;
				}
				if (delimiter) pendingHeredocs.push({delimiter, stripTabs});
				prev = 'x';
				continue;
			} else if (c === '\n' && pendingHeredocs.length > 0) {
				i++;
				prev = '\n';
				const problem = skipHeredocs();
				if (problem) return problem;
				continue;
			}
		}

		prev = c;
		i++;
	}

	return undefined;
}

function cmdProblem(tokens: BodyToken[]): string | undefined {
	let quoted = false;
	const sections: Array<{name: string; quoted: boolean}> = [];
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i] as BodyToken;
		if (token.kind === 'section') {
			if (token.sigil !== '/') {
				sections.push({name: token.name, quoted});
				continue;
			}
			const open = sections.pop();
			if (open && open.quoted !== quoted) {
				return `Section {{# ${open.name} }}...{{/ ${open.name} }} opens and closes in different quoting contexts, so including or leaving it out changes how the rest of the body is quoted. Keep quotes balanced inside a section.`;
			}
			continue;
		}
		if (token.kind === 'value') {
			if (quoted) {
				return `Placeholder {{ ${token.name} }} is inside a "..." string, where the quotes added around the value close it and the value ends up unquoted. Values are already quoted for cmd.exe, so use the placeholder bare.`;
			}
			continue;
		}
		if (token.c === '"') {
			quoted = !quoted;
		} else if (token.c === '^' && !quoted) {
			const escaped = tokens[i + 1];
			if (escaped?.kind === 'value') {
				return `Placeholder {{ ${escaped.name} }} follows a ^, which escapes the opening quote added around the value. Use the placeholder bare.`;
			}
			i++;
		}
	}
	return undefined;
}

/**
 * Find a placeholder whose substituted value the shell would not read as one
 * quoted word. Returns a message for the first one, or undefined when every
 * placeholder is safe. `shell` is the dialect the body will run under;
 * `declared`, when given, limits the check to the tool's parameter names.
 */
export function findUnsafePlaceholder(
	body: string,
	shell: 'posix' | 'cmd',
	declared?: readonly string[],
): string | undefined {
	// A placeholder for an undeclared name always renders empty (the handler
	// drops undeclared arguments), so it can't carry a value anywhere.
	const names = declared ? new Set(declared) : undefined;
	const tokens = tokenizeBody(body).filter(
		token => token.kind !== 'value' || !names || names.has(token.name),
	);
	return shell === 'cmd' ? cmdProblem(tokens) : posixProblem(tokens);
}

function expandSubstitutions(
	body: string,
	args: Record<string, unknown>,
	quote: (value: string) => string,
): string {
	return body.replace(
		/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
		(_match, name: string) => {
			if (!(name in args)) return '';
			return renderValue(args[name], quote);
		},
	);
}
