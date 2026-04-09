import {Box, Text} from 'ink';
import {useEffect, useReducer} from 'react';

import ToolMessage from '@/components/tool-message';
import {useTheme} from '@/hooks/useTheme';
import {
	getSubagentProgress,
	subagentProgress,
} from '@/services/subagent-events';

interface AgentProgressProps {
	subagentName: string;
	description: string;
	isLive?: boolean;
	agentId?: string;
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
	agentId,
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

	// Read current state from the correct progress source
	const progress = agentId ? getSubagentProgress(agentId) : subagentProgress;
	const toolCallCount = isComplete
		? completedState.toolCallCount
		: progress.toolCallCount;
	const tokenCount = isComplete
		? completedState.tokenCount
		: progress.tokenCount;

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

/**
 * Renders multiple agent progress indicators for parallel execution.
 * Each agent gets its own row with independent progress tracking.
 */
interface MultiAgentProgressProps {
	agents: Array<{
		agentId: string;
		subagentName: string;
		description: string;
	}>;
	isLive?: boolean;
	completedStates?: Map<
		string,
		{
			toolCallCount: number;
			tokenCount: number;
			success: boolean;
		}
	>;
}

export function MultiAgentProgress({
	agents,
	isLive = false,
	completedStates,
}: MultiAgentProgressProps) {
	return (
		<Box flexDirection="column">
			{agents.map(agent => (
				<Box key={agent.agentId} marginBottom={1}>
					<AgentProgress
						subagentName={agent.subagentName}
						description={agent.description}
						isLive={isLive && !completedStates?.has(agent.agentId)}
						agentId={agent.agentId}
						completedState={completedStates?.get(agent.agentId)}
					/>
				</Box>
			))}
		</Box>
	);
}
