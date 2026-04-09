import {Box, Text, useInput} from 'ink';
import {useEffect, useState} from 'react';

import ToolMessage from '@/components/tool-message';
import {TRUNCATION_OUTPUT_LIMIT} from '@/constants';
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
}

export default function BashProgress({
	executionId,
	command,
	completedState,
	isLive = false,
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

	// Handle escape key to cancel execution (only if not in static mode)
	useInput((_input, key) => {
		if (key.escape && !state.isComplete && !completedState) {
			bashExecutor.cancel(executionId);
		}
	});

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

	const messageContent = (
		<Box flexDirection="column">
			<Text color={colors.tool}>⚒ execute_bash</Text>

			<Box>
				<Text color={colors.secondary}>Command: </Text>
				<Box marginLeft={1} flexShrink={1}>
					<Text wrap="truncate-end" color={colors.primary}>
						{command}
					</Text>
				</Box>
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
