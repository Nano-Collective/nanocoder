import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {memo, useRef} from 'react';
import {useNonInteractiveRender} from '@/hooks/useNonInteractiveRender';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {wrapWithTrimmedContinuations} from '@/utils/text-wrapping';
import {calculateTokens} from '@/utils/token-calculator';
import {AssistantMessageBox} from './assistant-message';

/**
 * Pure helper: slices a bounded tail from a potentially huge streaming
 * message so that downstream work (trim, wrap, split) is always O(tail)
 * rather than O(full message). Exported for unit testing.
 *
 * Strategy: slice from the raw message FIRST (no full-string allocation),
 * then trim only the small tail. Snap the slice start backward to the
 * nearest preceding newline so we always start at a clean line boundary
 * (avoids partial first lines even on messages with very long single lines).
 */
export function computeStreamingTail(
	message: string,
	textWidth: number,
	maxLines: number,
): {tail: string; sliced: boolean} {
	const tailCharLimit = Math.max(textWidth, 1) * maxLines * 4;
	const rawTailStart =
		message.length > tailCharLimit ? message.length - tailCharLimit : 0;
	let sliceStart = rawTailStart;
	if (sliceStart > 0) {
		// Search backward for a preceding newline so we never start mid-line.
		// (Searching forward could leave a dangling partial first line when the
		// message contains very long single lines with no following newline.)
		const prevNewline = message.lastIndexOf('\n', sliceStart);
		sliceStart = prevNewline === -1 ? 0 : prevNewline + 1;
	}
	const tail = (sliceStart > 0 ? message.slice(sliceStart) : message).trim();
	return {tail, sliced: sliceStart > 0};
}

/**
 * Lightweight streaming message component. Shows the last N lines of
 * plain text to avoid expensive markdown parsing and terminal reflow
 * on every token update. The final AssistantMessage handles full rendering.
 */
export default memo(function StreamingMessage({
	message,
	model,
}: {
	message: string;
	model: string;
}) {
	// Snapshot the wall clock on first render so tok/s measures streaming
	// throughput rather than request-send-to-now.
	const startRef = useRef<number>(Date.now());
	const startTime = startRef.current;
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();
	const nonInteractive = useNonInteractiveRender();
	const textWidth = nonInteractive ? boxWidth : boxWidth - 3;

	// Only show the tail of the content to keep the render small
	// and avoid off-screen reflow that causes iTerm2 flickering.
	const MAX_LINES = 12;
	const {tail, sliced} = computeStreamingTail(message, textWidth, MAX_LINES);
	const wrapped = wrapWithTrimmedContinuations(tail, textWidth);
	const lines = wrapped.split('\n');
	const truncated = sliced || lines.length > MAX_LINES;
	const visibleLines =
		lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines;
	const displayText = visibleLines.join('\n');

	// Non-interactive (`run`) mode: just the streamed tail, no header/box.
	// Token calculation is skipped here — it's not displayed and computing it
	// on the full message on every flush would add unnecessary per-render cost.
	if (nonInteractive) {
		return (
			<Box flexDirection="column" marginBottom={1}>
				{truncated && <Text>…</Text>}
				<Text>{displayText}</Text>
			</Box>
		);
	}

	const tokens = calculateTokens(message);
	const elapsedSec = (Date.now() - startTime) / 1000;
	const tokPerSec = elapsedSec > 0.1 ? (tokens / elapsedSec).toFixed(1) : '—';

	return (
		<>
			<Box marginBottom={1} marginTop={1}>
				<Text color={colors.info} bold>
					<Spinner type="dots" /> {model}
				</Text>
				<Text>
					{'  '}~{tokens.toLocaleString()} tokens · {tokPerSec} tok/s
				</Text>
			</Box>
			<AssistantMessageBox truncated={truncated} text={displayText} />
		</>
	);
});
