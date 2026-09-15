import {Box, Text} from 'ink';
import React, {memo} from 'react';

import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {TOOL_OUTPUT_DISPLAY_LINES} from '@/constants';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

/**
 * Display state for one tool result: `expanded` lifts the line cap (set by
 * `/expand`), and `expandId` is the number `/expand` accepts for it.
 */
export const ToolOutputContext = React.createContext<{
	expanded: boolean;
	expandId?: number;
}>({expanded: false});

/**
 * Renders the first TOOL_OUTPUT_DISPLAY_LINES items, then a "+N more lines"
 * note. Only the visible items are rendered, so a huge file costs nothing.
 *
 * Diff views pass `isChange` so the note can say when the cap hides edits
 * rather than trailing context ("+N more lines, K changed").
 */
export function CappedLines<T>({
	items,
	renderItem,
	isChange,
}: {
	items: T[];
	renderItem: (item: T, index: number) => React.ReactNode;
	isChange?: (item: T, index: number) => boolean;
}) {
	const {expanded, expandId} = React.useContext(ToolOutputContext);
	const {colors} = useTheme();
	const hiddenCount = expanded
		? 0
		: Math.max(0, items.length - TOOL_OUTPUT_DISPLAY_LINES);
	const visibleCount = items.length - hiddenCount;
	const hiddenChanges =
		isChange && hiddenCount > 0
			? items
					.slice(visibleCount)
					.filter((item, i) => isChange(item, visibleCount + i)).length
			: 0;
	const changes = hiddenChanges > 0 ? `, ${hiddenChanges} changed` : '';
	const hint = expandId === undefined ? '' : ` · /expand ${expandId}`;

	return (
		<>
			{items.slice(0, visibleCount).map(renderItem)}
			{hiddenCount > 0 && (
				<Text color={colors.secondary}>
					{`… (+${hiddenCount} more lines${changes}${hint})`}
				</Text>
			)}
		</>
	);
}

export default memo(function ToolMessage({
	title,
	message,
	hideTitle = false,
	hideBox = false,
	isBashMode = false,
	isLive = false,
}: {
	title?: string;
	message: string | React.ReactNode;
	hideTitle?: boolean;
	hideBox?: boolean;
	isBashMode?: boolean;
	isLive?: boolean;
}) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();
	// Handle both string and ReactNode messages
	const messageContent =
		typeof message === 'string' ? (
			<CappedLines
				items={message.split('\n')}
				renderItem={(line, index) => (
					<Text key={index} color={colors.text}>
						{line}
					</Text>
				)}
			/>
		) : (
			message
		);

	const borderColor = colors.tool;

	return (
		<>
			{hideBox ? (
				<Box
					width={boxWidth}
					flexDirection="column"
					marginBottom={isLive ? 0 : 1}
				>
					{isBashMode && (
						<Text color={colors.tool} bold>
							Bash Command Output
						</Text>
					)}
					{messageContent}
					{isBashMode && (
						<Text color={colors.secondary}>
							Output truncated to 4k characters to save context
						</Text>
					)}
				</Box>
			) : hideTitle ? (
				<Box
					borderStyle="round"
					width={boxWidth}
					borderColor={borderColor}
					paddingX={2}
					paddingY={0}
					flexDirection="column"
					marginBottom={1}
				>
					{messageContent}
					{isBashMode && (
						<Text color={colors.text}>
							Output truncated to 4k characters to save context
						</Text>
					)}
				</Box>
			) : (
				<TitledBoxWithPreferences
					title={title || 'Tool Message'}
					width={boxWidth}
					borderColor={borderColor}
					paddingX={2}
					paddingY={1}
					flexDirection="column"
					marginBottom={1}
				>
					{messageContent}
					{isBashMode && (
						<Text color={colors.tool}>
							Output truncated to 4k characters to save context
						</Text>
					)}
				</TitledBoxWithPreferences>
			)}
		</>
	);
});
