import {Box, Text} from 'ink';
import {memo, useMemo} from 'react';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {Colors, parseMarkdown} from '@/markdown-parser/index';
import type {AssistantReasoningProps} from '@/types/index';
import {wrapWithTrimmedContinuations} from '@/utils/text-wrapping';
import {calculateTokens} from '@/utils/token-calculator';

export default memo(function AssistantReasoning({
	reasoning,
	compact,
}: AssistantReasoningProps) {
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();
	const tokens = calculateTokens(reasoning);

	// Render markdown to terminal-formatted text
	// Pre-wrap to avoid Ink's trim:false leaving leading spaces on wrapped lines
	const renderedMessage = useMemo(() => {
		try {
			// Reasoning should be rendered subtly, so render markdown with single color
			const mutedColors: Colors = {
				text: colors.secondary,
				primary: colors.secondary,
				secondary: colors.secondary,
				success: colors.secondary,
				error: colors.secondary,
				warning: colors.secondary,
				info: colors.secondary,
				tool: colors.secondary,
			};
			const parsed = parseMarkdown(reasoning, mutedColors, boxWidth).trimEnd();
			return wrapWithTrimmedContinuations(parsed, boxWidth);
		} catch {
			// Fallback to plain text if markdown parsing fails
			return wrapWithTrimmedContinuations(reasoning.trimEnd(), boxWidth);
		}
	}, [reasoning, colors, boxWidth]);

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={colors.tool}>{'\u2699'} Thinking</Text>
			{!compact && (
				<>
					<Box marginBottom={1}>
						<Text color={colors.secondary} italic>
							{renderedMessage}
						</Text>
					</Box>
					<Box>
						<Text color={colors.secondary}>
							~{tokens.toLocaleString()} tokens{' '}
						</Text>
					</Box>
				</>
			)}
		</Box>
	);
});
