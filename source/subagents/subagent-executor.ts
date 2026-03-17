/**
 * Subagent Executor
 *
 * Handles execution of subagent tasks with isolated context and tool filtering.
 */

import type {ToolManager} from '@/tools/tool-manager';
import type {AISDKCoreTool, LLMClient, Message} from '@/types/core';
import {getSubagentLoader} from './subagent-loader.js';
import type {
	SubagentConfigWithSource,
	SubagentContext,
	SubagentResult,
	SubagentTask,
} from './types.js';

/**
 * SubagentExecutor manages the execution of delegated tasks to subagents.
 * Each subagent runs in an isolated context with filtered tools.
 */
export class SubagentExecutor {
	private toolManager: ToolManager;
	private parentClient: LLMClient;
	private projectRoot: string;

	/**
	 * Create a new SubagentExecutor.
	 * @param toolManager - The tool manager for tool access
	 * @param parentClient - The parent LLM client (for context)
	 * @param projectRoot - The project root directory
	 */
	constructor(
		toolManager: ToolManager,
		parentClient: LLMClient,
		projectRoot: string = process.cwd(),
	) {
		this.toolManager = toolManager;
		this.parentClient = parentClient;
		this.projectRoot = projectRoot;
	}

	/**
	 * Execute a subagent task.
	 * @param task - The task to delegate
	 * @returns The result from the subagent execution
	 */
	async execute(task: SubagentTask): Promise<SubagentResult> {
		const startTime = Date.now();

		try {
			// Load the subagent configuration
			const loader = getSubagentLoader(this.projectRoot);
			const configWithSource = await loader.getSubagent(task.subagent_type);

			if (!configWithSource) {
				return {
					subagentName: task.subagent_type,
					output: '',
					success: false,
					error: `Subagent '${task.subagent_type}' not found`,
					executionTimeMs: Date.now() - startTime,
				};
			}

			const config = configWithSource;

			// Create isolated context for the subagent
			const context = this.createSubagentContext(config, task);

			// Get filtered tools for this subagent
			const filteredTools = this.filterTools(config);

			// Create or get client for this subagent
			const client = await this.createSubagentClient(config);

			// Build initial messages
			const messages: Message[] = [
				{role: 'system', content: context.systemMessage},
				...context.initialMessages,
			];

			// Execute the subagent conversation
			const output = await this.runSubagentConversation(
				client,
				messages,
				filteredTools,
				config.maxTurns,
			);

			return {
				subagentName: config.name,
				output,
				success: true,
				executionTimeMs: Date.now() - startTime,
			};
		} catch (error) {
			return {
				subagentName: task.subagent_type,
				output: '',
				success: false,
				error: error instanceof Error ? error.message : String(error),
				executionTimeMs: Date.now() - startTime,
			};
		}
	}

	/**
	 * Create an isolated context for a subagent.
	 * @param config - The subagent configuration
	 * @param task - The task to execute
	 * @returns The isolated context for the subagent
	 */
	private createSubagentContext(
		config: SubagentConfigWithSource,
		task: SubagentTask,
	): SubagentContext {
		// Build system message from config
		const systemMessage = config.systemPrompt;

		// Build initial messages with the task description
		const initialMessages = [
			{
				role: 'user' as const,
				content: this.buildTaskPrompt(task),
			},
		];

		// Determine available tools based on config
		const availableTools = this.getAvailableToolNames(config);

		return {
			availableTools,
			systemMessage,
			initialMessages,
			permissionMode: config.permissionMode || 'normal',
		};
	}

	/**
	 * Build the prompt for the subagent task.
	 * @param task - The task to execute
	 * @returns The formatted task prompt
	 */
	private buildTaskPrompt(task: SubagentTask): string {
		let prompt = `Task: ${task.description}\n`;

		if (task.prompt) {
			prompt += `\nAdditional Context:\n${task.prompt}\n`;
		}

		if (task.context && Object.keys(task.context).length > 0) {
			prompt += `\nContext:\n${JSON.stringify(task.context, null, 2)}\n`;
		}

		return prompt;
	}

	/**
	 * Get the list of available tool names for a subagent.
	 * @param config - The subagent configuration
	 * @returns Array of available tool names
	 */
	private getAvailableToolNames(config: SubagentConfigWithSource): string[] {
		const allTools = Object.keys(this.toolManager.getAllTools());

		// Start with all tools, then filter
		let available = allTools;

		// Apply explicit allow list if provided
		if (config.tools && config.tools.length > 0) {
			available = available.filter(tool => config.tools?.includes(tool));
		}

		// Remove disallowed tools
		if (config.disallowedTools && config.disallowedTools.length > 0) {
			available = available.filter(
				tool => !config.disallowedTools?.includes(tool),
			);
		}

		return available;
	}

	/**
	 * Filter tools based on subagent configuration.
	 * @param config - The subagent configuration
	 * @returns Record of filtered AI SDK tools
	 */
	private filterTools(
		config: SubagentConfigWithSource,
	): Record<string, AISDKCoreTool> {
		const allTools = this.toolManager.getAllTools();
		const availableNames = this.getAvailableToolNames(config);

		const filtered: Record<string, AISDKCoreTool> = {} as Record<
			string,
			AISDKCoreTool
		>;
		for (const name of availableNames) {
			if (name in allTools) {
				filtered[name] = allTools[name] as AISDKCoreTool;
			}
		}

		return filtered;
	}

	/**
	 * Create or get a client for the subagent.
	 * @param config - The subagent configuration
	 * @returns A client configured for the subagent
	 */
	private async createSubagentClient(
		config: SubagentConfigWithSource,
	): Promise<LLMClient> {
		// If model is 'inherit', use the parent client's model
		if (config.model === 'inherit' || !config.model) {
			return this.parentClient;
		}

		// Otherwise, we need to create a new client with the specified model
		// For now, we'll reuse the parent client but change the model
		// In a future implementation, we might create a separate client
		const client = this.parentClient;
		const modelToUse = config.model;

		// Set the model on the client
		client.setModel(modelToUse);

		return client;
	}

	/**
	 * Run the subagent conversation loop.
	 * @param client - The LLM client to use
	 * @param messages - Initial messages for the conversation
	 * @param tools - Available tools for the subagent
	 * @param maxTurns - Maximum number of conversation turns
	 * @returns The final output from the subagent
	 */
	private async runSubagentConversation(
		client: LLMClient,
		messages: Message[],
		tools: Record<string, AISDKCoreTool>,
		maxTurns: number | undefined,
	): Promise<string> {
		const maxIterations = maxTurns ?? 10; // Default max turns
		let iterations = 0;
		let output = '';

		while (iterations < maxIterations) {
			iterations++;

			// Filter to only non-tool messages for the chat call
			// Tool messages are added after tool execution in the loop
			const chatMessages = messages.filter(
				msg => msg.role !== 'tool',
			) as Message[];

			// Get response from LLM
			const response = await client.chat(chatMessages, tools, {
				onToken: token => {
					output += token;
				},
			});

			// Check if there were tool calls
			const toolCalls = response.choices[0]?.message.tool_calls;
			if (toolCalls && toolCalls.length > 0) {
				// Add assistant message with tool calls
				messages.push({
					role: 'assistant',
					content: response.choices[0].message.content || '',
					tool_calls: toolCalls,
				});

				// Execute each tool call
				for (const toolCall of toolCalls) {
					const toolName = toolCall.function.name;
					const toolHandler = this.toolManager.getToolHandler(toolName);

					if (toolHandler) {
						try {
							const result = await toolHandler(toolCall.function.arguments);
							messages.push({
								role: 'tool',
								content: result,
								tool_call_id: toolCall.id,
								name: toolName,
							});
						} catch (error) {
							messages.push({
								role: 'tool',
								content: `Error: ${error instanceof Error ? error.message : String(error)}`,
								tool_call_id: toolCall.id,
								name: toolName,
							});
						}
					}
				}

				// Continue the conversation
				continue;
			}

			// No more tool calls, we're done
			output = response.choices[0].message.content || '';
			break;
		}

		return output;
	}
}
