/**
 * Agent Delegation Tool
 *
 * Allows the LLM to delegate tasks to specialized subagents.
 * This tool is the bridge between the main conversation and subagent execution.
 * Supports parallel execution of multiple agents via unique agentId tracking.
 */

import {randomUUID} from 'node:crypto';
import type {SubagentExecutor} from '@/subagents/subagent-executor.js';
import {getSubagentLoader} from '@/subagents/subagent-loader.js';
import {jsonSchema, tool} from '@/types/core';
import type {NanocoderToolExport} from '@/types/index';

export interface AgentToolArgs {
	subagent_type: string;
	description: string;
	prompt?: string;
	context?: Record<string, unknown>;
}

let executorInstance: SubagentExecutor | null = null;

/**
 * Set the subagent executor instance.
 * Called during app initialization.
 */
export function setAgentToolExecutor(executor: SubagentExecutor): void {
	executorInstance = executor;
}

/**
 * Cached list of available agent names for the tool description.
 */
let availableAgentNames = 'explore (codebase exploration and research)';

/**
 * Update the agent tool's knowledge of available subagents.
 * Call after subagent loader initializes or reloads.
 */
export function setAvailableAgentNames(
	agents: Array<{name: string; description: string}>,
): void {
	if (agents.length > 0) {
		availableAgentNames = agents
			.map(a => `${a.name} (${a.description.slice(0, 60)})`)
			.join(', ');
	}
}

/**
 * Start agent execution and return a promise with a unique agent ID.
 * Like executeBashCommand — starts immediately, doesn't block the caller.
 *
 * @param args - Agent tool arguments
 * @param signal - Optional abort signal for cancellation
 * @returns Object with unique agentId and promise that resolves with the result
 */
export function startAgentExecution(
	args: AgentToolArgs,
	signal?: AbortSignal,
): {
	agentId: string;
	promise: Promise<{content: string; success: boolean; error?: string}>;
} {
	const agentId = randomUUID();

	if (!executorInstance) {
		return {
			agentId,
			promise: Promise.reject(new Error('Subagent executor not initialized')),
		};
	}

	const {subagent_type, description, prompt, context} = args;
	const executor = executorInstance;

	// Wrap in setTimeout(0) to fully detach from the current call stack.
	// This ensures the caller can set up the live component and Ink can
	// render before execution begins — matching how spawn() works for bash.
	const promise = new Promise<{
		content: string;
		success: boolean;
		error?: string;
	}>(resolve => {
		setTimeout(async () => {
			const result = await executor.execute(
				{
					subagent_type,
					description,
					prompt,
					context,
				},
				signal,
				0,
				agentId,
			);
			resolve({
				content: result.output,
				success: result.success,
				error: result.error,
			});
		}, 0);
	});

	return {agentId, promise};
}

async function executeAgent(args: AgentToolArgs): Promise<string> {
	if (!executorInstance) {
		throw new Error('Subagent executor not initialized');
	}

	const {subagent_type, description, prompt, context} = args;

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

const agentCoreTool = tool({
	description:
		'Delegate a task to a specialized subagent. The subagent runs in its own context and returns only its result. Use this to explore the codebase, research, or execute focused tasks without filling your context. You can call this tool multiple times in a single response — all agent calls will execute in parallel for maximum efficiency.',
	inputSchema: jsonSchema<AgentToolArgs>({
		type: 'object',
		properties: {
			subagent_type: {
				type: 'string',
				get description() {
					return `Which subagent to use. Available: ${availableAgentNames}`;
				},
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
	needsApproval: false,
	execute: async args => {
		return await executeAgent(args);
	},
});

export const agentTool: NanocoderToolExport = {
	name: 'agent',
	tool: agentCoreTool,
	readOnly: false,
};
