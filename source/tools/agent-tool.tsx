/**
 * Agent Delegation Tool
 *
 * Allows the LLM to delegate tasks to specialized subagents.
 * This tool is the bridge between the main conversation and subagent execution.
 */

import {Text} from 'ink';
import React from 'react';
import type {SubagentExecutor} from '@/subagents/subagent-executor.js';
import {getSubagentLoader} from '@/subagents/subagent-loader.js';
import {jsonSchema, tool} from '@/types/core';
import type {NanocoderToolExport, ToolFormatter} from '@/types/index';

interface AgentToolArgs {
	subagent_type: string;
	description: string;
	prompt?: string;
	context?: Record<string, unknown>;
}

/**
 * Format the arguments and result of the agent tool.
 */
const formatAgent: ToolFormatter = (args, result) => {
	const {subagent_type, description} = args as {
		subagent_type: string;
		description: string;
	};

	return (
		<>
			<FormattedMessage
				subagent={subagent_type}
				description={description}
				result={result}
			/>
		</>
	);
};

/**
 * Component to display the formatted agent delegation result.
 */
interface FormattedMessageProps {
	subagent: string;
	description: string;
	result?: string;
}

const FormattedMessage: React.FC<FormattedMessageProps> = ({
	subagent,
	description,
	result,
}) => {
	return (
		<>
			<Text>🤖 Agent: {subagent}</Text>
			<Text dimColor>Task: {description}</Text>
			{result && (
				<>
					<Text dimColor>Result:</Text>
					<Text>{result}</Text>
				</>
			)}
		</>
	);
};

/**
 * Create the agent delegation tool.
 * This is a factory function that creates the tool definition.
 * The actual executor is set at runtime via setExecutor().
 */
let executorInstance: SubagentExecutor | null = null;

/**
 * Set the subagent executor instance.
 * This should be called during app initialization.
 */
export function setAgentToolExecutor(executor: SubagentExecutor): void {
	executorInstance = executor;
}

/**
 * Execute the agent delegation.
 */
async function executeAgent(args: AgentToolArgs): Promise<string> {
	if (!executorInstance) {
		throw new Error('Subagent executor not initialized');
	}

	const {subagent_type, description, prompt, context} = args;

	// Validate that the subagent exists
	const loader = getSubagentLoader();
	const agentExists = await loader.hasSubagent(subagent_type);
	if (!agentExists) {
		throw new Error(
			`Subagent '${subagent_type}' not found. Available subagents: ${(
				await loader.listSubagents()
			)
				.map(a => a.name)
				.join(', ')}`,
		);
	}

	// Execute the subagent task
	const result = await executorInstance.execute({
		subagent_type,
		description,
		prompt,
		context,
	});

	if (!result.success) {
		throw new Error(result.error || 'Subagent execution failed');
	}

	return result.output;
}

/**
 * Agent tool export.
 * This will be registered in the tool registry.
 */
const agentCoreTool = tool({
	description:
		'Delegate a task to a specialized subagent. Use this when you need to explore the codebase, perform research, or execute a focused task.',
	inputSchema: jsonSchema<AgentToolArgs>({
		type: 'object',
		properties: {
			subagent_type: {
				type: 'string',
				description:
					'Which subagent to use. Common options: explore (codebase search), plan (research for planning)',
			},
			description: {
				type: 'string',
				description: 'What the subagent should do. Be specific and clear.',
			},
			prompt: {
				type: 'string',
				description:
					'Additional context or instructions for the subagent (optional).',
			},
			context: {
				type: 'object',
				description:
					'Additional context data to pass to the subagent (optional).',
			},
		},
		required: ['subagent_type', 'description'],
	}),
	needsApproval: false, // Agent delegation is safe - subagents enforce their own permissions
	execute: async args => {
		return await executeAgent(args);
	},
});

export const agentTool: NanocoderToolExport = {
	name: 'agent',
	tool: agentCoreTool,
	formatter: formatAgent,
	readOnly: true, // Agent delegation itself is read-only (the subagent may use non-read-only tools)
};
