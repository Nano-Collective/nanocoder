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
 * All scalar values are passed through `shellQuote()` which wraps the value
 * in single quotes and escapes embedded single quotes. Arrays are joined into
 * a single space-separated string with each element individually quoted.
 *
 * Substitution happens *before* the body is handed to the shell, so the
 * shell sees a complete, safe command line.
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
	const afterSections = expandSections(body, name => isTruthyArg(args[name]));
	return expandSubstitutions(afterSections, args);
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
