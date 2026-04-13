import {Box, Text} from 'ink';
import {memo, useMemo} from 'react';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {parseMarkdown} from '@/markdown-parser/index';
import type {AssistantReasoningProps} from '@/types/index';
import {wrapWithTrimmedContinuations} from '@/utils/text-wrapping';
import {calculateTokens} from '@/utils/token-calculator';

export default memo(function AssistantReasoning({
	reasoning,
	model,
}: AssistantReasoningProps) {
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();
	const tokens = calculateTokens(reasoning);

	// Inner text width: outer width minus left border (1) and padding (1 each side)
	const textWidth = boxWidth - 3;

	// Render markdown to terminal-formatted text with theme colors
	// Pre-wrap to avoid Ink's trim:false leaving leading spaces on wrapped lines
	const renderedMessage = useMemo(() => {
		try {
			const parsed = parseMarkdown(reasoning, colors, textWidth).trimEnd();
			return wrapWithTrimmedContinuations(parsed, textWidth);
		} catch {
			// Fallback to plain text if markdown parsing fails
			return wrapWithTrimmedContinuations(reasoning.trimEnd(), textWidth);
		}
	}, [reasoning, colors, textWidth]);

	return (
		<>
			<Box marginBottom={1} marginTop={0}>
				<Text color={colors.info} bold>
					{model}
				</Text>
				<Text color={colors.text}>{' is thinking:'}</Text>
			</Box>
			<Box
				flexDirection="column"
				marginBottom={1}
				backgroundColor={colors.base}
				width={boxWidth}
				padding={1}
				paddingLeft={2}
				borderStyle="bold"
				borderLeft={false}
				borderRight={false}
				borderTop={false}
				borderBottom={false}
				borderLeftColor={colors.secondary}
			>
				<Text color={colors.secondary} italic>
					{renderedMessage}
				</Text>
			</Box>
			<Box marginBottom={0}>
				<Text color={colors.secondary}>~{tokens.toLocaleString()} tokens</Text>
			</Box>
		</>
	);
});
