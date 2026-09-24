export interface CompletionWindow<T> {
	start: number;
	end: number;
	items: T[];
}

/**
 * Keep the selected row inside a fixed-size completion list.
 *
 * @param items - Full completion list
 * @param selectedIndex - Selected index in `items`, or a negative value when nothing is selected
 * @param maxRows - Maximum rows to render
 * @returns The visible slice and its offset into `items`
 */
export function visibleCompletionWindow<T>(
	items: readonly T[],
	selectedIndex: number,
	maxRows: number,
): CompletionWindow<T> {
	if (items.length <= maxRows) {
		return {start: 0, end: items.length, items: [...items]};
	}

	const selected = selectedIndex >= 0 ? selectedIndex : 0;
	const centeredStart = selected - Math.floor(maxRows / 2);
	const maxStart = items.length - maxRows;
	const start = Math.min(Math.max(centeredStart, 0), maxStart);
	const end = start + maxRows;

	return {start, end, items: items.slice(start, end)};
}
