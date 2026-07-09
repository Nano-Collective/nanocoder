import {Box, Text} from 'ink';
import {memo, useMemo} from 'react';
import {useNonInteractiveRender} from '@/hooks/useNonInteractiveRender';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {parseMarkdownParts} from '@/markdown-parser/index';
import type {AssistantMessageProps} from '@/types/index';
import {wrapWithTrimmedContinuations} from '@/utils/text-wrapping';
import {calculateTokens} from '@/utils/token-calculator';

export function AssistantMessageBox({
	text,
	truncated,
}: {
	text: string;
	truncated?: boolean;
}) {
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();

	return (
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
			{truncated && <Text>…</Text>}
			<Text>{text}</Text>
		</Box>
	);
}

export default memo(function AssistantMessage({
	message,
	model,
}: AssistantMessageProps) {
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();
	const nonInteractive = useNonInteractiveRender();
	const tokens = calculateTokens(message);

	// Inner text width: outer width minus left border (1) and padding (1 each side)
	const textWidth = nonInteractive ? boxWidth : boxWidth - 3;

	const displayMessage = message;

	// Render markdown into segments: text parts (rendered inside the bordered box)
	// and code parts (rendered without a border so they can be copied cleanly).
	// For non-interactive mode we join all parts back into a flat string.
	// Pre-wrap text parts to avoid Ink's trim:false leaving leading spaces on
	// wrapped lines. trim() removes leading/trailing whitespace.
	const renderedParts = useMemo(() => {
		try {
			const parts = parseMarkdownParts(displayMessage, colors, textWidth);
			return parts
				.map(part => {
					if (part.type === 'text') {
						const trimmed = part.content.trim();
						return trimmed
							? {
									type: 'text' as const,
									content: wrapWithTrimmedContinuations(trimmed, textWidth),
								}
							: null;
					}
					return part; // code: keep as-is, no wrapping
				})
				.filter(Boolean);
		} catch {
			// Fallback to a single text part if parsing fails
			return [
				{
					type: 'text' as const,
					content: wrapWithTrimmedContinuations(
						displayMessage.trim(),
						textWidth,
					),
				},
			];
		}
	}, [displayMessage, colors, textWidth]);

	// Non-interactive (`run`) mode: plain markdown text, no header/box/token
	// counter — keeps stdout output close to what a regular CLI would emit.
	if (nonInteractive) {
		const flatText = renderedParts.map(p => p?.content ?? '').join('\n');
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Text>{flatText}</Text>
			</Box>
		);
	}

	return (
		<>
			<Box marginBottom={1} marginTop={1}>
				<Text color={colors.info} bold>
					{model}:
				</Text>
			</Box>
			{renderedParts.map((part, index) =>
				part?.type === 'text' ? (
					<AssistantMessageBox key={index} text={part.content} />
				) : (
					// Code blocks rendered without any border or margin so they can be
					// selected and copied cleanly from the terminal.
					<Box key={index} marginBottom={1}>
						<Text>{part?.content}</Text>
					</Box>
				),
			)}
			<Box marginBottom={2}>
				<Text color={colors.secondary}>~{tokens.toLocaleString()} tokens</Text>
			</Box>
		</>
	);
});
