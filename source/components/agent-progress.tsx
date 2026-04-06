import {Box, Text} from 'ink';
import {useEffect, useReducer} from 'react';

import ToolMessage from '@/components/tool-message';
import {useTheme} from '@/hooks/useTheme';
import {subagentProgress} from '@/services/subagent-events';

interface AgentProgressProps {
	subagentName: string;
	description: string;
	isLive?: boolean;
	completedState?: {
		toolCallCount: number;
		tokenCount: number;
		success: boolean;
	};
}

export default function AgentProgress({
	subagentName,
	description,
	isLive = false,
	completedState,
}: AgentProgressProps) {
	const {colors} = useTheme();
	const isComplete = !!completedState;

	const [, forceRender] = useReducer((x: number) => x + 1, 0);

	// Poll the mutable progress state every 100ms
	useEffect(() => {
		if (!isLive || isComplete) return;

		const interval = setInterval(() => {
			forceRender();
		}, 100);

		return () => clearInterval(interval);
	}, [isLive, isComplete]);

	// Read current state from the mutable store
	const toolCallCount = isComplete
		? completedState.toolCallCount
		: subagentProgress.toolCallCount;
	const tokenCount = isComplete
		? completedState.tokenCount
		: subagentProgress.tokenCount;

	const dotColor = isComplete
		? completedState?.success
			? colors.success
			: colors.error
		: colors.secondary;

	const terminalWidth = process.stdout.columns || 80;
	const maxDescLen = Math.max(terminalWidth - 4, 40);
	const shortDesc =
		description.length > maxDescLen
			? `${description.slice(0, maxDescLen)}...`
			: description;

	const messageContent = (
		<Box flexDirection="column">
			<Text color={colors.tool}>⚒ agent: {subagentName}</Text>

			<Box flexShrink={1}>
				<Text wrap="truncate-end" color={colors.primary}>
					{shortDesc}
				</Text>
			</Box>

			{!isComplete && (
				<Box>
					<Text color={colors.secondary}>
						{toolCallCount > 0 ? `${toolCallCount} tool calls` : ''}
						{toolCallCount > 0 && tokenCount > 0 ? ' · ' : ''}
						{tokenCount > 0 ? `~${tokenCount.toLocaleString()} tokens` : ''}
					</Text>
				</Box>
			)}

			{isComplete && (
				<>
					<Box>
						<Text color={colors.secondary}>Status: </Text>
						<Text color={dotColor}>●</Text>
					</Box>
					<Box>
						<Text color={colors.secondary}>
							{completedState.toolCallCount} tool calls · ~
							{completedState.tokenCount.toLocaleString()} tokens
						</Text>
					</Box>
				</>
			)}
		</Box>
	);

	return (
		<ToolMessage message={messageContent} hideBox={true} isLive={isLive} />
	);
}
