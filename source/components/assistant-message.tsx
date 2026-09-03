import {Box, Text} from 'ink';
import {memo, useMemo} from 'react';
import {useNonInteractiveRender} from '@/hooks/useNonInteractiveRender';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {parseMarkdownParts} from '@/markdown-parser/index';
import type {AssistantMessageProps} from '@/types/index';
import {formatUsageIndicator} from '@/usage/format';
import {wrapWithTrimmedContinuations} from '@/utils/text-wrapping';
import {calculateTokens} from '@/utils/token-calculator';

export function AssistantMessageBox({
	text,
	truncated,
}: {
	text: string;
	truncated?: boolean;
}) {
	return (
		<Box flexDirection="column" marginBottom={1}>
			{truncated && <Text>…</Text>}
			<Text>{text}</Text>
		</Box>
	);
}

export default memo(function AssistantMessage({
	message,
	model,
	usage,
	showUsageFooter = true,
}: AssistantMessageProps) {
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();
	const nonInteractive = useNonInteractiveRender();
	const tokens = calculateTokens(message);
	// Prefer the provider-reported usage (real token counts + cost); fall
	// back to the client-side estimate of the message text when the
	// provider reported nothing.
	const usageIndicator = usage ? formatUsageIndicator(usage) : null;

	const textWidth = boxWidth;

	const displayMessage = message;

	// Render markdown into segments: text parts and code parts.
	// Both render without left border characters (┃) so terminal mouse
	// selection and copy-paste remain clean without ASCII artifacts.
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
			{showUsageFooter ? (
				<Box marginBottom={2}>
					<Text color={colors.secondary}>
						{usageIndicator ?? `~${tokens.toLocaleString()} tokens`}
					</Text>
				</Box>
			) : (
				// Keep the trailing gap the footer used to provide, so turning
				// the footer off doesn't visually cram messages together.
				<Box marginBottom={1} />
			)}
		</>
	);
});
