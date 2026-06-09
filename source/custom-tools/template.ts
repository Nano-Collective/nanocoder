/**
 * Mustache-flavoured template rendering for custom tool script bodies.
 *
 * Supported syntax:
 *   {{ name }}                — shell-quoted substitution of `args[name]`
 *   {{# name }}…{{/ name }}   — section: included only when `args[name]` is
 *                                truthy. Inside the section, `{{ name }}`
 *                                expands to the (still shell-quoted) value.
 *
 * All scalar values are passed through `shellQuote()` which wraps the value
 * in single quotes and escapes embedded single quotes. Arrays are joined into
 * a single space-separated string with each element individually quoted.
 *
 * Substitution happens *before* the body is handed to the shell, so the
 * shell sees a complete, safe command line.
 */

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
 * Render an argument value as a shell-safe token (or token list, for arrays).
 */
export function renderValue(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (Array.isArray(value)) {
		return value.map(v => shellQuote(stringify(v))).join(' ');
	}
	return shellQuote(stringify(value));
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
): string {
	const afterSections = expandSections(body, args);
	return expandSubstitutions(afterSections, args);
}

function expandSections(body: string, args: Record<string, unknown>): string {
	// Match `{{# name }}...{{/ name }}` where the closing tag matches the
	// opening tag. `[\s\S]` so the body can span newlines. Non-greedy so
	// adjacent sections don't merge.
	const sectionRegex =
		/\{\{#\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}([\s\S]*?)\{\{\/\s*\1\s*\}\}/g;

	// Apply repeatedly so nested sections collapse from inside-out.
	let prev: string;
	let next = body;
	let safety = 0;
	do {
		prev = next;
		next = prev.replace(sectionRegex, (_match, name: string, inner: string) => {
			return isTruthyArg(args[name]) ? expandSections(inner, args) : '';
		});
		safety++;
	} while (next !== prev && safety < 16);
	return next;
}

function expandSubstitutions(
	body: string,
	args: Record<string, unknown>,
): string {
	return body.replace(
		/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
		(_match, name: string) => {
			if (!(name in args)) return '';
			return renderValue(args[name]);
		},
	);
}
