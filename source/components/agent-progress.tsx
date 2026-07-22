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
		toolHistory?: string[];
	};
}

/**
 * Collapse consecutive duplicates into `name (×N)` so a chatty agent that
 * hammers the same tool stays readable.
 */
function groupConsecutive(
	history: string[],
): Array<{name: string; count: number}> {
	const groups: Array<{name: string; count: number}> = [];
	for (const name of history) {
		const last = groups[groups.length - 1];
		if (last && last.name === name) {
			last.count++;
		} else {
			groups.push({name, count: 1});
		}
	}
	return groups;
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
	const toolHistory = isComplete
		? (completedState.toolHistory ?? [])
		: progress.toolHistory;
	const allGroups = groupConsecutive(toolHistory);
	const MAX_VISIBLE_GROUPS = 3;
	const toolGroups = allGroups.slice(-MAX_VISIBLE_GROUPS);
	const hiddenEarlierCount = Math.max(0, allGroups.length - toolGroups.length);

	const dotColor = isComplete
		? completedState?.success
			? colors.success
			: colors.error
		: colors.secondary;

	// Defensive: callers should pass a string, but a malformed model tool call
	// can supply a non-string. Coerce so we never render a raw object/array.
	const safeDescription =
		typeof description === 'string' ? description : String(description ?? '');
	const terminalWidth = process.stdout.columns || 80;
	const maxDescLen = Math.max(terminalWidth - 4, 40);
	const shortDesc =
		safeDescription.length > maxDescLen
			? `${safeDescription.slice(0, maxDescLen)}...`
			: safeDescription;

	const messageContent = (
		<Box flexDirection="column">
			<Text color={colors.tool}>⚒ agent: {subagentName}</Text>

			<Box flexShrink={1}>
				<Text wrap="truncate-end" color={colors.primary}>
					{shortDesc}
				</Text>
			</Box>

			{!isComplete && (
				<Box flexDirection="column">
					<Box>
						<Text color={colors.secondary}>
							{toolCallCount > 0 ? `${toolCallCount} tool calls` : ''}
							{toolCallCount > 0 && tokenCount > 0 ? ' · ' : ''}
							{tokenCount > 0 ? `~${tokenCount.toLocaleString()} tokens` : ''}
						</Text>
					</Box>
					{agentId && (
						<Box>
							<Text color={colors.secondary} italic>
								Press Ctrl+S to attach to session
							</Text>
						</Box>
					)}
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

			{toolGroups.length > 0 && (
				<Box flexDirection="column" marginLeft={2}>
					{hiddenEarlierCount > 0 && (
						<Text color={colors.secondary}>
							↳ + {hiddenEarlierCount} earlier
						</Text>
					)}
					{toolGroups.map((g, i) => (
						<Text key={`${g.name}-${i}`} color={colors.secondary}>
							↳ {g.name}
							{g.count > 1 ? ` (×${g.count})` : ''}
						</Text>
					))}
				</Box>
			)}
		</Box>
	);

	return <ToolMessage message={messageContent} hideBox={true} />;
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
