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

/** Slice `text` from the start so the result is at most `maxColumns`
 *  visual columns. If truncated, appends an ellipsis (`…`, single col). */
export function truncateByColumns(text: string, maxColumns: number): string {
	if (maxColumns <= 0) return '';
	if (width(text) <= maxColumns) return text;
	const ellipsis = '\u2026'; // …
	if (maxColumns <= width(ellipsis)) return ellipsis;

	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (width(text.slice(0, mid)) + width(ellipsis) <= maxColumns) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}
	return text.slice(0, lo) + ellipsis;
}

/** Like `truncateByColumns` but keeps the END of the path (so a deep
 *  `/foo/bar/baz.ts` is shown as `…/bar/baz.ts`). Prepends the ellipsis
 *  when truncated. */
export function truncatePathByColumns(
	pathStr: string | undefined,
	maxColumns: number,
): string {
	if (!pathStr) return '';
	if (width(pathStr) <= maxColumns) return pathStr;
	const ellipsis = '\u2026';
	if (maxColumns <= width(ellipsis)) return ellipsis;

	let lo = 0;
	let hi = pathStr.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (width(pathStr.slice(-mid)) + width(ellipsis) <= maxColumns) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}
	return ellipsis + pathStr.slice(-lo);
}
