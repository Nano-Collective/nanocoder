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
		<Box flexDirection="column" marginBottom={1}>
			<Text color={colors.tool}>{'\u2699'} Thinking</Text>
			<Box marginBottom={1}>
				<Text color={colors.secondary} italic>
					{renderedMessage}
				</Text>
			</Box>
			<Box>
				<Text color={colors.secondary}>~{tokens.toLocaleString()} tokens </Text>
			</Box>
		</Box>
	);
});
