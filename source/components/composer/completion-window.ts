/**
 * The rows of a completion list to render: all of them when they fit,
 * otherwise a window kept around the selected row so it never scrolls out
 * of view.
 */
export function completionWindow<T>(
	items: T[],
	selectedIndex: number,
	maxRows: number,
): {start: number; end: number; items: T[]} {
	if (items.length <= maxRows) {
		return {start: 0, end: items.length, items};
	}

	const centeredStart =
		(selectedIndex >= 0 ? selectedIndex : 0) - Math.floor(maxRows / 2);
	const start = Math.min(Math.max(centeredStart, 0), items.length - maxRows);
	const end = start + maxRows;

	return {start, end, items: items.slice(start, end)};
}
