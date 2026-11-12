import type {Key} from 'ink';
import {useCallback, useEffect, useRef, useState} from 'react';
import {KEYBOARD_SHORTCUTS} from '@/components/composer/keymap';
import {useTerminalRows} from '@/hooks/useTerminalWidth';

// Rows around the shortcut list that must stay on screen so the close hint
// and the lower border are never pushed below a short terminal: the overlay's
// title row, borders and padding (5), the blank row and hint row under the
// list (2), the status row (1), the app frame's padding (2), and one spare
// row, because Ink repaints the whole inline transcript on every render once
// a frame is as tall as the terminal. The parent hides the rest of the footer
// while the overlay is open; see onShortcutsOverlayChange.
export const SHORTCUTS_OVERHEAD_ROWS = 11;

export interface ShortcutsWindow {
	/** Index of the first legend row on screen. */
	start: number;
	/** How many legend rows fit. */
	visibleCount: number;
	/** Largest valid `start`; 0 when every row fits. */
	maxStart: number;
}

/**
 * State for the `?` shortcuts overlay: whether it is open, and which window
 * of the legend is on screen. The window is sized to the terminal height and
 * re-clamped every render, so shrinking the terminal while the overlay is
 * open keeps it inside the list.
 *
 * Key handlers read `isOpenNow()` rather than `isOpen`: both UserInput's
 * useInput and TextInput's see every keystroke, and either can still hold a
 * render-old closure.
 */
export function useShortcutsOverlay(
	onOpenChange?: (open: boolean) => void,
	rowCount: number = KEYBOARD_SHORTCUTS.length,
) {
	const [isOpen, setIsOpen] = useState(false);
	const isOpenRef = useRef(false);
	const isOpenNow = useCallback(() => isOpenRef.current, []);
	const [scroll, setScroll] = useState(0);

	const setOpen = (open: boolean) => {
		isOpenRef.current = open;
		setIsOpen(open);
		if (open) setScroll(0);
		onOpenChange?.(open);
	};

	// A tool confirmation or question prompt can replace the composer while
	// the overlay is open. Report it closed then, or the parent keeps its
	// footer hidden and its scrolling paused with no overlay on screen.
	const onOpenChangeRef = useRef(onOpenChange);
	onOpenChangeRef.current = onOpenChange;
	useEffect(
		() => () => {
			if (isOpenRef.current) {
				onOpenChangeRef.current?.(false);
			}
		},
		[],
	);

	const terminalRows = useTerminalRows();
	const visibleCount = Math.max(
		1,
		Math.min(rowCount, terminalRows - SHORTCUTS_OVERHEAD_ROWS),
	);
	const maxStart = rowCount - visibleCount;
	const start = Math.min(scroll, maxStart);
	// Keep the clamp from a taller terminal, so shrinking it again keeps the
	// same top row instead of jumping back to the older, deeper offset.
	useEffect(() => {
		if (scroll > maxStart) {
			setScroll(maxStart);
		}
	}, [scroll, maxStart]);

	const windowRef = useRef({maxStart, pageSize: visibleCount});
	windowRef.current = {maxStart, pageSize: visibleCount};
	const scrollBy = (delta: number) => {
		const {maxStart: latestMaxStart} = windowRef.current;
		setScroll(prev =>
			Math.max(
				0,
				Math.min(Math.min(prev, latestMaxStart) + delta, latestMaxStart),
			),
		);
	};

	/**
	 * Keys while the overlay is open: Escape closes it, ↑/↓ and PgUp/PgDn
	 * scroll it. Every other key is swallowed.
	 */
	const handleKey = (key: Key) => {
		const {pageSize} = windowRef.current;
		if (key.escape) setOpen(false);
		else if (key.upArrow) scrollBy(-1);
		else if (key.downArrow) scrollBy(1);
		else if (key.pageUp) scrollBy(-pageSize);
		else if (key.pageDown) scrollBy(pageSize);
	};

	const view: ShortcutsWindow = {start, visibleCount, maxStart};
	return {isOpen, isOpenNow, setOpen, handleKey, view};
}
