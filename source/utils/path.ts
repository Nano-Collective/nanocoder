import {homedir} from 'node:os';
import {resolve, sep} from 'node:path';
import stringWidth from 'string-width';

export function homeRelative(path: string, home: string = homedir()): string {
	const resolved = resolve(path);
	const resolvedHome = resolve(home);

	if (resolvedHome === sep || /^[A-Za-z]:\\$/.test(resolvedHome)) {
		return resolved;
	}

	if (resolved === resolvedHome) {
		return '~';
	}

	if (resolved.startsWith(resolvedHome + sep)) {
		return `~${resolved.slice(resolvedHome.length)}`;
	}

	return resolved;
}

/**
 * Leading (or, from the end, trailing) characters of `str` that together
 * occupy at most `width` terminal columns. Code units are the wrong unit
 * here: one CJK character or emoji is a single unit but two columns.
 */
function sliceToWidth(str: string, width: number, fromEnd = false): string {
	if (width <= 0) return '';
	const characters = [...str];
	if (fromEnd) characters.reverse();

	const kept: string[] = [];
	let used = 0;
	for (const character of characters) {
		const columns = stringWidth(character);
		if (used + columns > width) break;
		used += columns;
		kept.push(character);
	}

	if (fromEnd) kept.reverse();
	return kept.join('');
}

// Keeps root and leaf visible; truncatePath (useTerminalWidth.tsx) only keeps the tail.
// `maxLength` is terminal columns, not characters: every caller is budgeting a
// row of the UI, and a wide glyph counted as one column overflows the row.
export function truncateMiddle(str: string, maxLength: number): string {
	if (stringWidth(str) <= maxLength) {
		return str;
	}

	const ellipsis = '...';
	if (maxLength <= ellipsis.length) {
		return sliceToWidth(str, Math.max(0, maxLength));
	}

	const budget = maxLength - ellipsis.length;
	const keepStart = Math.ceil(budget / 2);
	const keepEnd = Math.floor(budget / 2);

	return (
		sliceToWidth(str, keepStart) + ellipsis + sliceToWidth(str, keepEnd, true)
	);
}
