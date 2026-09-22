import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {memo, useRef} from 'react';
import {useNonInteractiveRender} from '@/hooks/useNonInteractiveRender';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {wrapWithTrimmedContinuations} from '@/utils/text-wrapping';
import {calculateTokens} from '@/utils/token-calculator';
import {computeStreamingTail} from './streaming-message';

/**
 * Lightweight streaming reasoning component. Shows the last N lines of
 * plain text to avoid expensive markdown parsing and terminal reflow
 * on every token update. The final AssistantReasoning handles full rendering.
 */
export default memo(function StreamingReasoning({
	reasoning,
	expand,
}: {
	reasoning: string;
	expand: boolean;
}) {
	// Snapshot the wall clock on first render so tok/s measures streaming
	// throughput rather than request-send-to-now (which over-counts the
	// pre-first-token latency for reasoning models).
	const startRef = useRef<number>(Date.now());
	const startTime = startRef.current;
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();
	const nonInteractive = useNonInteractiveRender();
	const textWidth = boxWidth - 3;

	// Only show the tail of the content to keep the render small
	// and avoid off-screen reflow that causes iTerm2 flickering. Bounding the
	// wrap input to that tail also keeps each flush O(tail) instead of
	// re-wrapping the whole history, which grows for the length of the stream.
	const MAX_LINES = 12;

	// Collapsed is the default, and nothing below the header renders then, so
	// neither the wrap nor the token count is worth paying for on every flush.
	let truncated = false;
	let displayText = '';
	let tokens = 0;
	if (expand) {
		const {tail, sliced} = computeStreamingTail(
			reasoning,
			textWidth,
			MAX_LINES,
		);
		const wrapped = wrapWithTrimmedContinuations(tail, textWidth);
		const lines = wrapped.split('\n');
		truncated = sliced || lines.length > MAX_LINES;
		displayText = (
			lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines
		).join('\n');
		tokens = calculateTokens(reasoning);
	}

	const elapsedSec = (Date.now() - startTime) / 1000;
	const tokPerSec = elapsedSec > 0.1 ? (tokens / elapsedSec).toFixed(1) : '—';

	return (
		<Box flexDirection="column" marginBottom={2}>
			<Box>
				<Text color={colors.tool}>
					{'\u2699'} Thinking
					<Spinner type="simpleDots" />
				</Text>
				{expand ? (
					<Text>
						{'  '}~{tokens.toLocaleString()} tokens · {tokPerSec} tok/s
					</Text>
				) : nonInteractive ? null : (
					<Text color={colors.secondary}>{'  '}ctrl+r to expand</Text>
				)}
			</Box>
			{expand && (
				<Box flexDirection="column">
					{truncated && <Text color={colors.secondary}>…</Text>}
					<Text color={colors.secondary} italic>
						{displayText}
					</Text>
				</Box>
			)}
		</Box>
	);
});
