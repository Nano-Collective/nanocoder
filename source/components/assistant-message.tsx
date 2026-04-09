import {Box, Text} from 'ink';
import {memo, useMemo} from 'react';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {parseMarkdown} from '@/markdown-parser/index';
import type {AssistantMessageProps} from '@/types/index';
import {wrapWithTrimmedContinuations} from '@/utils/text-wrapping';
import {calculateTokens} from '@/utils/token-calculator';

export default memo(function AssistantMessage({
	message,
	model,
}: AssistantMessageProps) {
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();
	const tokens = calculateTokens(message);

	// Inner text width: outer width minus left border (1) and padding (1 each side)
	const textWidth = boxWidth - 3;

	// Render markdown to terminal-formatted text with theme colors
	// Pre-wrap to avoid Ink's trim:false leaving leading spaces on wrapped lines
	const renderedMessage = useMemo(() => {
		try {
			const parsed = parseMarkdown(message, colors, textWidth).trimEnd();
			return wrapWithTrimmedContinuations(parsed, textWidth);
		} catch {
			// Fallback to plain text if markdown parsing fails
			return wrapWithTrimmedContinuations(message.trimEnd(), textWidth);
		}
	}, [message, colors, textWidth]);

	return (
		<>
			<Box marginBottom={1} marginTop={1}>
				<Text color={colors.info} bold>
					{model}:
				</Text>
			</Box>
			<Box
				flexDirection="column"
				marginBottom={1}
				backgroundColor={colors.base}
				width={boxWidth}
				padding={1}
				borderStyle="bold"
				borderLeft={true}
				borderRight={false}
				borderTop={false}
				borderBottom={false}
				borderLeftColor={colors.secondary}
			>
				<Text>{renderedMessage}</Text>
			</Box>
			<Box marginBottom={2}>
				<Text color={colors.secondary}>~{tokens.toLocaleString()} tokens</Text>
			</Box>
		</>
	);
});
