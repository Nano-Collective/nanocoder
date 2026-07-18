import {useEffect, useState} from 'react';
import {DEFAULT_TERMINAL_COLUMNS} from '@/constants';

type TerminalSize = 'narrow' | 'normal' | 'wide';

// Calculate box width (leave some padding and ensure minimum width)
const calculateBoxWidth = (columns: number) =>
	Math.max(Math.min(columns - 4, 120), 40);

const computeWidth = () =>
	calculateBoxWidth(process.stdout.columns || DEFAULT_TERMINAL_COLUMNS);

// A single shared 'resize' listener fans out to every useTerminalWidth
// consumer. Each hook instance used to attach its own stdout listener, so a
// long conversation — or a resumed session replaying many messages at once —
// would exceed the EventEmitter max-listener limit and log a
// MaxListenersExceededWarning. One listener, many subscribers, no leak and no
// need to raise the limit.
const subscribers = new Set<(width: number) => void>();
let sharedListener: (() => void) | null = null;

function subscribe(onChange: (width: number) => void): () => void {
	subscribers.add(onChange);

	if (!sharedListener) {
		sharedListener = () => {
			const newWidth = computeWidth();
			for (const notify of subscribers) {
				notify(newWidth);
			}
		};
		process.stdout.on('resize', sharedListener);
	}

	return () => {
		subscribers.delete(onChange);
		// Detach the shared listener once nothing is listening anymore.
		if (subscribers.size === 0 && sharedListener) {
			process.stdout.off('resize', sharedListener);
			sharedListener = null;
		}
	};
}

const DEFAULT_TERMINAL_ROWS = 24;

const computeRows = () => process.stdout.rows || DEFAULT_TERMINAL_ROWS;

// Same shared-listener pattern as width, but for rows. Kept as a separate
// subscriber set so width consumers don't re-render on height-only changes.
const rowSubscribers = new Set<(rows: number) => void>();
let sharedRowListener: (() => void) | null = null;

function subscribeRows(onChange: (rows: number) => void): () => void {
	rowSubscribers.add(onChange);

	if (!sharedRowListener) {
		sharedRowListener = () => {
			const newRows = computeRows();
			for (const notify of rowSubscribers) {
				notify(newRows);
			}
		};
		process.stdout.on('resize', sharedRowListener);
	}

	return () => {
		rowSubscribers.delete(onChange);
		if (rowSubscribers.size === 0 && sharedRowListener) {
			process.stdout.off('resize', sharedRowListener);
			sharedRowListener = null;
		}
	};
}

/**
 * Reactive terminal height in rows. Drives the fixed-height fullscreen
 * layout: the interactive app sizes its root Box to exactly this many rows
 * so the frame never exceeds the alternate-screen viewport.
 */
export const useTerminalRows = () => {
	const [rows, setRows] = useState(computeRows);

	useEffect(() => {
		setRows(computeRows());
		return subscribeRows(setRows);
	}, []);

	return rows;
};

export const useTerminalWidth = () => {
	const [boxWidth, setBoxWidth] = useState(computeWidth);

	useEffect(() => {
		// Reconcile any resize that happened between initial render and mount,
		// then track future resizes via the shared listener. setState is a no-op
		// when the width is unchanged, so this won't cause an extra render.
		setBoxWidth(computeWidth());
		return subscribe(setBoxWidth);
	}, []);

	return boxWidth;
};

/**
 * Hook to detect terminal size category and provide responsive utilities
 * @returns Object with terminal width, size category, and utility functions
 */
export const useResponsiveTerminal = () => {
	const boxWidth = useTerminalWidth();
	const actualWidth = process.stdout.columns || DEFAULT_TERMINAL_COLUMNS;

	// Define breakpoints for terminal sizes
	const getSize = (width: number): TerminalSize => {
		if (width < 80) return 'narrow';
		if (width < 120) return 'normal';
		return 'wide';
	};

	const size = getSize(actualWidth);

	// Utility to truncate long text with ellipsis
	const truncate = (text: string, maxLength: number): string => {
		if (text.length <= maxLength) return text;
		return text.slice(0, maxLength - 3) + '...';
	};

	// Utility to truncate path intelligently (keep end of path)
	const truncatePath = (
		pathStr: string | undefined,
		maxLength: number,
	): string => {
		if (!pathStr || pathStr.length <= maxLength) return pathStr || '';
		return '...' + pathStr.slice(-(maxLength - 3));
	};

	return {
		boxWidth,
		actualWidth,
		size,
		isNarrow: size === 'narrow',
		isNormal: size === 'normal',
		isWide: size === 'wide',
		truncate,
		truncatePath,
	};
};
