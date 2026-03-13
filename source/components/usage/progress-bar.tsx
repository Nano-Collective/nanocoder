/**
 * ASCII progress bar component for usage visualization
 */

import {Text} from 'ink';

interface ProgressBarProps {
	percent: number;
	width: number;
	color: string;
}

/**
 * Renders an ASCII progress bar
 */
export function ProgressBar({percent, width, color}: ProgressBarProps) {
	// Ensure values are valid numbers to prevent crashes
	const safePercent = Number.isFinite(percent) ? percent : 0;
	const safeWidth =
		Number.isFinite(width) && width > 0 ? Math.floor(width) : 10;

	const clampedPercent = Math.min(100, Math.max(0, safePercent));
	const filledWidth = Math.round((safeWidth * clampedPercent) / 100);
	const emptyWidth = safeWidth - filledWidth;

	const filledBar = '█'.repeat(filledWidth);
	const emptyBar = '░'.repeat(emptyWidth);

	return (
		<Text>
			<Text color={color}>{filledBar}</Text>
			<Text color="gray">{emptyBar}</Text>
		</Text>
	);
}
