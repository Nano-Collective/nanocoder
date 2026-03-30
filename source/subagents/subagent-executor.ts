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

/** Maximum recursion depth for subagent delegation */
const MAX_SUBAGENT_DEPTH = 2;

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
	 * @param signal - Optional abort signal for cancellation
	 * @param depth - Current recursion depth (internal use)
	 * @returns The result from the subagent execution
	 */
	async execute(
		task: SubagentTask,
		signal?: AbortSignal,
		depth = 0,
	): Promise<SubagentResult> {
		const startTime = Date.now();

		// Prevent infinite recursion
		if (depth >= MAX_SUBAGENT_DEPTH) {
			return {
				subagentName: task.subagent_type,
				output: '',
				success: false,
				error: `Maximum subagent recursion depth (${MAX_SUBAGENT_DEPTH}) exceeded`,
				executionTimeMs: Date.now() - startTime,
			};
		}

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

			// Get filtered tools for this subagent (excludes agent tool to prevent recursion)
			const filteredTools = this.filterTools(config);

			// Get client and track original model for restoration
			const {originalModel} = this.prepareClient(config);

			// Build initial messages
			const messages: Message[] = [
				{role: 'system', content: context.systemMessage},
				...context.initialMessages,
			];

			try {
				// Execute the subagent conversation
				const output = await this.runSubagentConversation(
					messages,
					filteredTools,
					config.maxTurns,
					config,
					signal,
				);

				return {
					subagentName: config.name,
					output,
					success: true,
					executionTimeMs: Date.now() - startTime,
				};
			} finally {
				// Restore original model if we changed it
				if (originalModel !== null) {
					this.parentClient.setModel(originalModel);
				}
			}
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
	 * Always excludes the 'agent' tool to prevent infinite recursion.
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
			// Always exclude agent tool to prevent infinite recursion
			if (name === 'agent') continue;
			if (name in allTools) {
				filtered[name] = allTools[name] as AISDKCoreTool;
			}
		}

		return filtered;
	}

	/**
	 * Prepare the client for subagent execution.
	 * Sets the model if different from parent, returns original model for restoration.
	 * @param config - The subagent configuration
	 * @returns Object containing the original model (null if not changed)
	 */
	private prepareClient(config: SubagentConfigWithSource): {
		originalModel: string | null;
	} {
		// If model is 'inherit' or not specified, use parent client as-is
		if (config.model === 'inherit' || !config.model) {
			return {originalModel: null};
		}

		// Save original model for restoration
		const originalModel = this.parentClient.getCurrentModel();

		// Set the model on the parent client
		this.parentClient.setModel(config.model);

		return {originalModel};
	}

	/**
	 * Run the subagent conversation loop.
	 * @param messages - Initial messages for the conversation
	 * @param tools - Available tools for the subagent
	 * @param maxTurns - Maximum number of conversation turns
	 * @param config - The subagent configuration for permission enforcement
	 * @param signal - Optional abort signal for cancellation
	 * @returns The final output from the subagent
	 */
	private async runSubagentConversation(
		messages: Message[],
		tools: Record<string, AISDKCoreTool>,
		maxTurns: number | undefined,
		config: SubagentConfigWithSource,
		signal?: AbortSignal,
	): Promise<string> {
		const maxIterations = maxTurns ?? 10; // Default max turns
		let iterations = 0;
		let output = '';

		while (iterations < maxIterations) {
			iterations++;

			// CRITICAL FIX: Do NOT filter out tool messages
			// The OpenAI-compatible API requires tool results after tool_calls
			// Passing all messages allows the LLM to see tool execution results

			// Get response from LLM
			const response = await this.parentClient.chat(
				messages,
				tools,
				{
					onToken: token => {
						output += token;
					},
				},
				signal,
			);

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

					// Permission enforcement: check if tool is allowed in readOnly mode
					if (config.permissionMode === 'readOnly') {
						const isReadOnly = this.toolManager.isReadOnly(toolName);
						if (!isReadOnly) {
							messages.push({
								role: 'tool',
								content: `Error: Tool '${toolName}' is not read-only. Subagent is in read-only mode.`,
								tool_call_id: toolCall.id,
								name: toolName,
							});
							continue;
						}
					}

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
					} else {
						messages.push({
							role: 'tool',
							content: `Error: Tool '${toolName}' not found`,
							tool_call_id: toolCall.id,
							name: toolName,
						});
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
