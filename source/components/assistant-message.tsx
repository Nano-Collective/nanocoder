import {Box, Text} from 'ink';
import {memo, useMemo} from 'react';
import wrapAnsi from 'wrap-ansi';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {parseMarkdown} from '@/markdown-parser/index';
import type {AssistantMessageProps} from '@/types/index';

// Ink uses wrap-ansi with trim: false, which preserves the space at word
// boundaries as leading whitespace on continuation lines. This function
// wraps each original line individually and trims only the artifact spaces
// from continuation lines, preserving intentional indentation.
function wrapWithTrimmedContinuations(text: string, width: number): string {
	if (width <= 0) return text;
	const originalLines = text.split('\n');
	const result: string[] = [];

	for (const line of originalLines) {
		if (line === '') {
			result.push('');
			continue;
		}
		const wrapped = wrapAnsi(line, width, {trim: false, hard: true});
		const subLines = wrapped.split('\n');

		result.push(subLines[0] ?? '');

		for (let i = 1; i < subLines.length; i++) {
			// Trim the leading space that is a word-wrap artifact.
			// Handle ANSI escape codes that may precede the space.
			result.push(
				(subLines[i] ?? '').replace(/^((?:\x1b\[[0-9;]*m)*)\s/, '$1'),
			);
		}
	}

	return result.join('\n');
}

export default memo(function AssistantMessage({
	message,
	model,
}: AssistantMessageProps) {
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();

	// Inner text width: outer width minus left border (1) and padding (1 each side)
	const textWidth = boxWidth - 3;

	// Render markdown to terminal-formatted text with theme colors
	// Pre-wrap to avoid Ink's trim:false leaving leading spaces on wrapped lines
	const renderedMessage = useMemo(() => {
		try {
			const parsed = parseMarkdown(message, colors).trimEnd();
			return wrapWithTrimmedContinuations(parsed, textWidth);
		} catch {
			// Fallback to plain text if markdown parsing fails
			return wrapWithTrimmedContinuations(message.trimEnd(), textWidth);
		}
	}, [message, colors, textWidth]);

	return (
		<>
			<Box marginBottom={1}>
				<Text color={colors.info} bold>
					{model}:
				</Text>
			</Box>
			<Box
				flexDirection="column"
				marginBottom={2}
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
		</>
	);
});
