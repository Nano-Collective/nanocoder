/**
 * Agents Command
 *
 * Lists all available subagents with their configurations.
 */

import {Box, Text} from 'ink';
import React from 'react';
import {getSubagentLoader} from '@/subagents/subagent-loader';
import {Command} from '@/types/index';

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
	return (
		<Box flexDirection="column" gap={1}>
			{subagents.map(agent => (
				<Box key={agent.name} flexDirection="column" marginBottom={1}>
					<Box>
						<Text bold>
							{agent.isBuiltIn ? '⚙' : '📋'} {agent.name}
						</Text>
					</Box>
					<Box marginLeft={2}>
						<Text dimColor>{agent.description}</Text>
					</Box>
					<Box marginLeft={2}>
						<Text dimColor>
							Model: {agent.model || 'inherit'} | Tools:{' '}
							{agent.tools
								? agent.tools.join(', ')
								: 'all (filtered by config)'}
						</Text>
					</Box>
				</Box>
			))}
		</Box>
	);
}

export const agentsCommand: Command = {
	name: 'agents',
	description: 'List all available subagents',
	handler: async (_args: string[]) => {
		const loader = getSubagentLoader();
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
