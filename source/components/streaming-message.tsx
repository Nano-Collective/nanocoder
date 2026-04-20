import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {memo, useRef} from 'react';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {wrapWithTrimmedContinuations} from '@/utils/text-wrapping';
import {calculateTokens} from '@/utils/token-calculator';
import {AssistantMessageBox} from './assistant-message';

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
	const textWidth = boxWidth - 3;

	// Only show the tail of the content to keep the render small
	// and avoid off-screen reflow that causes iTerm2 flickering.
	const MAX_LINES = 12;
	const wrapped = wrapWithTrimmedContinuations(message.trimEnd(), textWidth);
	const lines = wrapped.split('\n');
	const truncated = lines.length > MAX_LINES;
	const visibleLines = truncated ? lines.slice(-MAX_LINES) : lines;
	const displayText = visibleLines.join('\n');

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
