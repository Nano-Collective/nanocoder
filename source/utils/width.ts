import stringWidth from 'string-width';

/**
 * Visual-column width measurement for terminal output.
 *
 * `string.length` (UTF-16 code units) lies about how wide a string renders.
 * A CJK glyph is one code unit but two columns; an emoji with VS-16 is two
 * code units and four columns; some `Misc Symbols` glyphs (`⚒`, `⚠`, `❯`)
 * are East-Asian-Ambiguous and render as 1 col on a Western terminal but
 * 2 cols on a CJK-configured terminal. We use `string-width`'s default
 * `ambiguousIsNarrow: true` (per UAX #11) which matches what the rest of
 * the terminal-emulator ecosystem does.
 */

const DEFAULT_OPTIONS = {ambiguousIsNarrow: true} as const;

/** Visual-column count of `text` as it would appear in a monospace terminal.
 *  ANSI escape sequences are NOT counted (string-width strips them). */
export function width(text: string): number {
	return stringWidth(text, DEFAULT_OPTIONS);
}
