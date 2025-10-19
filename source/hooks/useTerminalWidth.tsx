import {useState, useEffect} from 'react';

export type TerminalSize = 'narrow' | 'normal' | 'wide';

export const useTerminalWidth = () => {
	// Calculate box width (leave some padding and ensure minimum width)
	const calculateBoxWidth = (columns: number) =>
		Math.max(Math.min(columns - 4, 120), 40);

	const [boxWidth, setBoxWidth] = useState(() =>
		calculateBoxWidth(process.stdout.columns || 80),
	);

	useEffect(() => {
		const handleResize = () => {
			const newWidth = calculateBoxWidth(process.stdout.columns || 80);
			// Only update if width actually changed
			setBoxWidth(prevWidth => (prevWidth !== newWidth ? newWidth : prevWidth));
		};

		// Listen for terminal resize events
		process.stdout.on('resize', handleResize);

		return () => {
			process.stdout.off('resize', handleResize);
		};
	}, []);

	return boxWidth;
};

/**
 * Hook to detect terminal size category and provide responsive utilities
 * @returns Object with terminal width, size category, and utility functions
 */
export const useResponsiveTerminal = () => {
	const boxWidth = useTerminalWidth();
	const actualWidth = process.stdout.columns || 80;

	// Define breakpoints for terminal sizes
	const getSize = (width: number): TerminalSize => {
		if (width < 60) return 'narrow';
		if (width < 100) return 'normal';
		return 'wide';
	};

	const size = getSize(actualWidth);

	// Utility to truncate long text with ellipsis
	const truncate = (text: string, maxLength: number): string => {
		if (text.length <= maxLength) return text;
		return text.slice(0, maxLength - 3) + '...';
	};

	// Utility to truncate path intelligently (keep end of path)
	const truncatePath = (pathStr: string, maxLength: number): string => {
		if (pathStr.length <= maxLength) return pathStr;
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
