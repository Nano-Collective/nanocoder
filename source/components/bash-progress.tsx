import {Box, Text} from 'ink';
import {useEffect, useState} from 'react';

import ToolMessage from '@/components/tool-message';
import {BASH_OUTPUT_DISPLAY_LINES, TRUNCATION_OUTPUT_LIMIT} from '@/constants';
import {useTheme} from '@/hooks/useTheme';
import {type BashExecutionState, bashExecutor} from '@/services/bash-executor';
import {calculateTokens} from '@/utils/token-calculator';

interface BashProgressProps {
	executionId: string;
	command: string;
	/** If provided, renders a static completed state without event subscription */
	completedState?: BashExecutionState;
	/** If true, renders with reduced margins for live display */
	isLive?: boolean;
	/** If true, renders the captured output once the command completes.
	 * Used for user-typed !commands; model tool calls stay compact. */
	showOutput?: boolean;
}

export default function BashProgress({
	executionId,
	command,
	completedState,
	isLive = false,
	showOutput = false,
}: BashProgressProps) {
	const {colors} = useTheme();

	// If completedState is provided, use it directly (static mode)
	const [state, setState] = useState<BashExecutionState>(
		completedState ?? {
			executionId,
			command,
			outputPreview: '',
			fullOutput: '',
			stderr: '',
			isComplete: false,
			exitCode: null,
			error: null,
		},
	);

	// Subscribe to bash executor events (only if not in static mode)
	useEffect(() => {
		// Skip event subscription if we have a completed state
		if (completedState) return;

		const handleUpdate = (update: BashExecutionState) => {
			if (update.executionId === executionId) {
				setState(update);
			}
		};

		bashExecutor.on('start', handleUpdate);
		bashExecutor.on('progress', handleUpdate);
		bashExecutor.on('complete', handleUpdate);

		// Get initial state if execution already started
		const initialState = bashExecutor.getState(executionId);
		if (initialState) {
			setState(initialState);
		}

		return () => {
			bashExecutor.off('start', handleUpdate);
			bashExecutor.off('progress', handleUpdate);
			bashExecutor.off('complete', handleUpdate);
		};
	}, [executionId, completedState]);

	// Escape-to-cancel for a running bash command is owned by the single
	// section-level handler in InteractiveApp. execute_bash is the only entry
	// point for bash and it always sets isToolExecuting + an abort controller,
	// so the global handler reliably tears this command down via handleCancel.

	// Determine dot color
	let dotColor = colors.secondary;
	if (state.isComplete) {
		dotColor =
			state.exitCode === 0 && !state.error ? colors.success : colors.error;
	}

	// Calculate output stats for completed state (use truncated size to match what LLM receives)
	const totalOutput = state.fullOutput + state.stderr;
	const truncatedOutput =
		totalOutput.length > TRUNCATION_OUTPUT_LIMIT
			? totalOutput.substring(0, TRUNCATION_OUTPUT_LIMIT)
			: totalOutput;
	const estimatedTokens = calculateTokens(truncatedOutput);

	// Completed output for user-typed !commands. Mirrors the error/stderr-first
	// ordering of formatBashResultForLLM, tail-capped so a verbose command
	// can't flood the static transcript (the model still receives the full,
	// separately-truncated output).
	let displayedOutput = '';
	let hiddenLineCount = 0;
	if (showOutput && state.isComplete) {
		const sections = [
			state.error ? `Error: ${state.error}` : '',
			state.stderr ? `Stderr:\n${state.stderr.trimEnd()}` : '',
			state.fullOutput
				? `${state.stderr ? 'Stdout:\n' : ''}${state.fullOutput.trimEnd()}`
				: '',
		].filter(Boolean);
		const lines = sections.join('\n').split('\n');
		hiddenLineCount = Math.max(0, lines.length - BASH_OUTPUT_DISPLAY_LINES);
		displayedOutput = lines.slice(-BASH_OUTPUT_DISPLAY_LINES).join('\n');
	}

	const messageContent = (
		<Box flexDirection="column">
			<Text color={colors.tool}>⚒ execute_bash</Text>

			<Box flexDirection="column">
				<Text color={colors.secondary}>Command:</Text>
				<Text wrap="wrap" color={colors.primary}>
					{command}
				</Text>
			</Box>
			{state.isComplete && (
				<Box>
					<Text color={colors.secondary}>Status: </Text>
					<Text color={dotColor}>●</Text>
				</Box>
			)}

			{!state.isComplete && state.outputPreview && (
				<Box flexDirection="column">
					<Text color={colors.secondary}>Output: </Text>
					<Text color={colors.text}>{state.outputPreview}</Text>
				</Box>
			)}

			{state.isComplete && displayedOutput && (
				<Box flexDirection="column">
					{hiddenLineCount > 0 && (
						<Text color={colors.secondary}>
							… (+{hiddenLineCount} earlier lines)
						</Text>
					)}
					<Text wrap="wrap" color={colors.text}>
						{displayedOutput}
					</Text>
				</Box>
			)}

			{state.isComplete && (
				<Box>
					<Text color={colors.secondary}>Tokens: </Text>
					<Text color={colors.text}>~{estimatedTokens}</Text>
				</Box>
			)}
		</Box>
	);

	return (
		<ToolMessage message={messageContent} hideBox={true} isLive={isLive} />
	);
}
