import {Box, Text} from 'ink';
import React, {memo} from 'react';

import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

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
			<Text color={colors.text}>{message}</Text>
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
						<Text color={colors.secondary} dimColor>
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
						<Text color={colors.text} dimColor>
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
						<Text color={colors.tool} dimColor>
							Output truncated to 4k characters to save context
						</Text>
					)}
				</TitledBoxWithPreferences>
			)}
		</>
	);
});
