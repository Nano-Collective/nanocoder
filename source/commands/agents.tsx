/**
 * Agents Command
 *
 * Lists all available subagents with their configurations.
 * Supports `/agents show <name>` to view a full agent definition.
 */

import {Box, Text} from 'ink';
import React from 'react';
import {ErrorMessage} from '@/components/message-box';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {parseMarkdown} from '@/markdown-parser/index';
import {getSubagentLoader} from '@/subagents/subagent-loader';
import type {SubagentConfigWithSource} from '@/subagents/types';
import type {Command} from '@/types/index';
import {wrapWithTrimmedContinuations} from '@/utils/text-wrapping';

interface SubagentsListProps {
	subagents: Array<{
		name: string;
		description: string;
		model: string | undefined;
		tools: string[] | undefined;
		isBuiltIn: boolean;
	}>;
}

function SubagentsList({subagents}: SubagentsListProps) {
	const {colors} = useTheme();
	const {boxWidth, truncate} = useResponsiveTerminal();
	const descMaxLen = Math.max(boxWidth - 12, 20);

	return (
		<TitledBoxWithPreferences
			title="Subagents"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			{subagents.length === 0 ? (
				<>
					<Box marginBottom={1}>
						<Text color={colors.text} bold>
							No subagents found
						</Text>
					</Box>
					<Text color={colors.secondary}>
						Create agents in{' '}
						<Text color={colors.primary}>.nanocoder/agents/</Text> or use{' '}
						<Text color={colors.primary}>/agents create {'<name>'}</Text>
					</Text>
				</>
			) : (
				subagents.map((agent, i) => (
					<Box
						key={agent.name}
						flexDirection="column"
						marginBottom={i < subagents.length - 1 ? 1 : 0}
					>
						<Box>
							<Text color={colors.text} bold>
								› {agent.name}
							</Text>
							<Text color={colors.secondary}>
								{' '}
								· {agent.model || 'inherit'}
							</Text>
						</Box>
						<Box marginLeft={4}>
							<Text color={colors.secondary}>
								{truncate(agent.description, descMaxLen)}
							</Text>
						</Box>
						<Box marginLeft={4}>
							<Text color={colors.secondary}>
								{agent.tools
									? `${agent.tools.length} tool${agent.tools.length === 1 ? '' : 's'}`
									: 'all tools'}
							</Text>
						</Box>
					</Box>
				))
			)}
		</TitledBoxWithPreferences>
	);
}

interface AgentDetailProps {
	agent: SubagentConfigWithSource;
}

function Field({
	label,
	value,
	colors,
}: {
	label: string;
	value: string;
	colors: ReturnType<typeof useTheme>['colors'];
}) {
	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={colors.primary} bold>
				{label}
			</Text>
			<Text color={colors.secondary} wrap="wrap">
				{value}
			</Text>
		</Box>
	);
}

function AgentDetail({agent}: AgentDetailProps) {
	const {colors} = useTheme();
	const {boxWidth} = useResponsiveTerminal();
	const textWidth = boxWidth - 6; // account for border + padding

	const sourceLabel = agent.source.isBuiltIn
		? 'built-in'
		: agent.source.filePath || 'unknown';

	const toolsSummary = agent.tools
		? agent.tools.join(', ')
		: 'all (filtered by config)';

	const fields: Array<{label: string; value: string}> = [
		{label: 'Source', value: sourceLabel},
		...(agent.provider ? [{label: 'Provider', value: agent.provider}] : []),
		{label: 'Model', value: agent.model || 'inherit'},
		{label: 'Tools', value: toolsSummary},
		...(agent.disallowedTools && agent.disallowedTools.length > 0
			? [{label: 'Disallowed tools', value: agent.disallowedTools.join(', ')}]
			: []),
	];

	const descriptionRendered = wrapWithTrimmedContinuations(
		parseMarkdown(agent.description, colors, textWidth),
		textWidth,
	);
	const systemPromptRendered = wrapWithTrimmedContinuations(
		parseMarkdown(agent.systemPrompt, colors, textWidth),
		textWidth,
	);

	return (
		<TitledBoxWithPreferences
			title={`Agent: ${agent.name}`}
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text>{descriptionRendered}</Text>
			</Box>

			{fields.map(f => (
				<Field key={f.label} label={f.label} value={f.value} colors={colors} />
			))}

			<Box flexDirection="column" marginBottom={1}>
				<Text color={colors.primary} bold>
					System prompt
				</Text>
				<Text>{systemPromptRendered}</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}

export const agentsCommand: Command = {
	name: 'agents',
	description:
		'List subagents. /agents show <name> for details, /agents copy <name> to customize',
	handler: async (args: string[]) => {
		const loader = getSubagentLoader();

		// /agents show <name>
		if (args[0] === 'show' && args[1]) {
			const agent = await loader.getSubagent(args[1]);
			if (!agent) {
				return React.createElement(ErrorMessage, {
					key: `agents-show-error-${Date.now()}`,
					message: `Agent '${args[1]}' not found. Run /agents to see available agents.`,
				});
			}
			return React.createElement(AgentDetail, {
				key: `agents-show-${Date.now()}`,
				agent,
			});
		}

		// /agents — list all
		const agents = await loader.listSubagents();
		const formatted = agents.map(agent => ({
			name: agent.name,
			description: agent.description,
			model: agent.model,
			tools: agent.tools,
			isBuiltIn: agent.source.isBuiltIn,
		}));

		return React.createElement(SubagentsList, {
			key: `agents-${Date.now()}`,
			subagents: formatted,
		});
	},
};
