/**
 * Subagent Executor
 *
 * Handles execution of subagent tasks with isolated context and tool filtering.
 * Supports concurrent execution via unique agentId for progress isolation.
 */

import {createLLMClient} from '@/client-factory';
import {
	getSubagentProgress,
	subagentProgress,
	updateSubagentProgress,
	updateSubagentProgressById,
} from '@/services/subagent-events';
import type {ToolManager} from '@/tools/tool-manager';
import type {
	AISDKCoreTool,
	DevelopmentMode,
	LLMClient,
	Message,
} from '@/types/core';
import {parseToolArguments} from '@/utils/tool-args-parser';
import {getSubagentLoader} from './subagent-loader.js';
import type {
	SubagentConfigWithSource,
	SubagentContext,
	SubagentResult,
	SubagentTask,
} from './types.js';

/** Maximum recursion depth for subagent delegation */
const MAX_SUBAGENT_DEPTH = 2;

/** Maximum number of concurrent subagents */
export const MAX_CONCURRENT_AGENTS = 5;

/**
 * SubagentExecutor manages the execution of delegated tasks to subagents.
 * Each subagent runs in an isolated context with filtered tools.
 */
export class SubagentExecutor {
	private toolManager: ToolManager;
	private parentClient: LLMClient;
	private projectRoot: string;
	private parentMode: DevelopmentMode;

	constructor(
		toolManager: ToolManager,
		parentClient: LLMClient,
		projectRoot: string = process.cwd(),
		parentMode: DevelopmentMode = 'normal',
	) {
		this.toolManager = toolManager;
		this.parentClient = parentClient;
		this.projectRoot = projectRoot;
		this.parentMode = parentMode;
	}

	/**
	 * Update the parent development mode (called when mode changes).
	 */
	setParentMode(mode: DevelopmentMode): void {
		this.parentMode = mode;
	}

	/**
	 * Execute a subagent task.
	 *
	 * @param task - The task to execute
	 * @param signal - Optional abort signal for cancellation
	 * @param depth - Recursion depth (prevents infinite delegation)
	 * @param agentId - Optional unique ID for concurrent progress tracking.
	 *                  When provided, progress is written to the agent-specific
	 *                  slot in the progress map instead of the global singleton.
	 */
	async execute(
		task: SubagentTask,
		signal?: AbortSignal,
		depth = 0,
		agentId?: string,
	): Promise<SubagentResult> {
		const startTime = Date.now();

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
			const loader = getSubagentLoader(this.projectRoot);
			const config = await loader.getSubagent(task.subagent_type);

			if (!config) {
				return {
					subagentName: task.subagent_type,
					output: '',
					success: false,
					error: `Subagent '${task.subagent_type}' not found`,
					executionTimeMs: Date.now() - startTime,
				};
			}

			// In plan mode, only allow read-only subagents
			if (this.parentMode === 'plan' && config.permissionMode !== 'readOnly') {
				return {
					subagentName: task.subagent_type,
					output: '',
					success: false,
					error: `Subagent '${config.name}' cannot run in plan mode because it is not read-only. Only subagents with permissionMode: readOnly are allowed in plan mode.`,
					executionTimeMs: Date.now() - startTime,
				};
			}

			const context = this.createSubagentContext(config, task);
			const filteredTools = this.filterTools(config);

			const messages: Message[] = [
				{role: 'system', content: context.systemMessage},
				...context.initialMessages,
			];

			// Get the client for this subagent — either a new one for a
			// different provider, or the parent client with model switching.
			// When agentId is set (concurrent mode), always create a new client
			// for non-inherit models to avoid mutating the shared parent.
			const {client, restoreParent} = await this.prepareClient(
				config,
				!!agentId,
			);

			try {
				const output = await this.runSubagentConversation(
					client,
					messages,
					filteredTools,
					config.maxTurns,
					config,
					signal,
					agentId,
				);

				// Read final token count from the correct progress source
				const finalTokenCount = agentId
					? getSubagentProgress(agentId).tokenCount
					: subagentProgress.tokenCount;

				return {
					subagentName: config.name,
					output,
					success: true,
					tokensUsed: finalTokenCount,
					executionTimeMs: Date.now() - startTime,
				};
			} finally {
				restoreParent();
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

	private createSubagentContext(
		config: SubagentConfigWithSource,
		task: SubagentTask,
	): SubagentContext {
		const initialMessages = [
			{
				role: 'user' as const,
				content: this.buildTaskPrompt(task),
			},
		];

		const availableTools = this.getAvailableToolNames(config);

		return {
			availableTools,
			systemMessage: config.systemPrompt,
			initialMessages,
			permissionMode: config.permissionMode || 'normal',
		};
	}

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

	private getAvailableToolNames(config: SubagentConfigWithSource): string[] {
		const allTools = Object.keys(this.toolManager.getAllTools());

		let available = allTools;

		if (config.tools && config.tools.length > 0) {
			available = available.filter(tool => config.tools?.includes(tool));
		}

		if (config.disallowedTools && config.disallowedTools.length > 0) {
			available = available.filter(
				tool => !config.disallowedTools?.includes(tool),
			);
		}

		// Always exclude agent tool to prevent infinite recursion
		available = available.filter(name => name !== 'agent');

		return available;
	}

	/**
	 * Filter tools based on subagent configuration.
	 * In readOnly mode, only read-only tools are included.
	 */
	private filterTools(
		config: SubagentConfigWithSource,
	): Record<string, AISDKCoreTool> {
		const allTools = this.toolManager.getAllToolsWithoutExecute();
		const availableNames = this.getAvailableToolNames(config);

		const filtered: Record<string, AISDKCoreTool> = {} as Record<
			string,
			AISDKCoreTool
		>;
		for (const name of availableNames) {
			if (!(name in allTools)) continue;

			// In readOnly mode, only include read-only tools in the LLM's tool set
			if (
				config.permissionMode === 'readOnly' &&
				!this.toolManager.isReadOnly(name)
			) {
				continue;
			}

			filtered[name] = allTools[name] as AISDKCoreTool;
		}

		return filtered;
	}

	/**
	 * Prepare the LLM client for subagent execution.
	 *
	 * If the agent specifies a `provider`, creates a brand-new client for that
	 * provider/model combination. This lets subagents use a completely different
	 * backend (e.g. local Ollama for research, cloud API for the main agent).
	 *
	 * If no provider is set, reuses the parent client (switching model if needed).
	 *
	 * @param concurrent - When true, creates a new client instead of mutating
	 *                     the parent client's model (safe for parallel execution).
	 */
	private async prepareClient(
		config: SubagentConfigWithSource,
		concurrent = false,
	): Promise<{
		client: LLMClient;
		restoreParent: () => void;
	}> {
		// Different provider — create a new client entirely
		if (config.provider) {
			const model =
				config.model && config.model !== 'inherit' ? config.model : undefined;

			const {client} = await createLLMClient(config.provider, model);
			return {client, restoreParent: () => {}};
		}

		// Same provider, different model
		if (config.model && config.model !== 'inherit') {
			// In concurrent mode, create a new client to avoid mutating the
			// shared parent client (which would race with other agents)
			if (concurrent) {
				const {client} = await createLLMClient(undefined, config.model);
				return {client, restoreParent: () => {}};
			}

			const availableModels = await this.parentClient.getAvailableModels();
			if (!availableModels.includes(config.model)) {
				throw new Error(
					`Model '${config.model}' is not available. Configured models: ${availableModels.join(', ')}`,
				);
			}

			const originalModel = this.parentClient.getCurrentModel();
			this.parentClient.setModel(config.model);
			return {
				client: this.parentClient,
				restoreParent: () => this.parentClient.setModel(originalModel),
			};
		}

		// Inherit everything
		return {client: this.parentClient, restoreParent: () => {}};
	}

	/**
	 * Run the subagent conversation loop.
	 *
	 * @param agentId - When provided, writes progress to the agent-specific
	 *                  slot instead of the global singleton.
	 */
	private async runSubagentConversation(
		client: LLMClient,
		messages: Message[],
		tools: Record<string, AISDKCoreTool>,
		maxTurns: number | undefined,
		config: SubagentConfigWithSource,
		signal?: AbortSignal,
		agentId?: string,
	): Promise<string> {
		const maxIterations = maxTurns ?? 10;
		let iterations = 0;
		let totalToolCalls = 0;
		let totalTokens = 0;

		// Rough token estimate: ~4 chars per token
		const estimateTokens = (text: string) => Math.ceil(text.length / 4);

		const emitProgress = (
			status: 'running' | 'tool_call' | 'complete' | 'error',
			currentTool?: string,
		) => {
			const event = {
				subagentName: config.name,
				status,
				currentTool,
				toolCallCount: totalToolCalls,
				turnCount: iterations,
				tokenCount: totalTokens,
			};

			if (agentId) {
				updateSubagentProgressById(agentId, event);
			} else {
				updateSubagentProgress(event);
			}
		};

		emitProgress('running');

		// Keep a direct reference to the mutable progress object for the
		// onToken callback (which fires frequently and must be fast).
		const progressRef = agentId ? getSubagentProgress(agentId) : null;

		while (iterations < maxIterations) {
			// Check for cancellation before each turn
			if (signal?.aborted) {
				emitProgress('error');
				throw new Error('Aborted');
			}

			iterations++;

			// Yield to event loop so Ink can render current state
			emitProgress('running');
			await new Promise(resolve => setTimeout(resolve, 50));

			const response = await client.chat(
				messages,
				tools,
				{
					onToken: () => {
						totalTokens++;
						// Update the live token count directly on the mutable
						// progress object so the UI polls the latest value.
						if (agentId) {
							const progress = progressRef;
							if (progress) {
								progress.tokenCount = totalTokens;
							}
						} else {
							subagentProgress.tokenCount = totalTokens;
						}
					},
				},
				signal,
			);

			const responseContent = response.choices[0]?.message.content || '';

			const toolCalls = response.choices[0]?.message.tool_calls;
			if (!toolCalls || toolCalls.length === 0) {
				emitProgress('complete');
				return responseContent;
			}

			// Count tokens from tool call arguments
			for (const tc of toolCalls) {
				const argStr =
					typeof tc.function.arguments === 'string'
						? tc.function.arguments
						: JSON.stringify(tc.function.arguments);
				totalTokens += estimateTokens(argStr);
			}

			messages.push({
				role: 'assistant',
				content: responseContent,
				tool_calls: toolCalls,
			});

			// Execute each tool call — yield between each so Ink can render
			for (const toolCall of toolCalls) {
				// Check for cancellation before each tool call
				if (signal?.aborted) {
					emitProgress('error');
					throw new Error('Aborted');
				}

				const toolName = toolCall.function.name;
				totalToolCalls++;
				emitProgress('tool_call', toolName);
				await new Promise(resolve => setTimeout(resolve, 50));

				const toolResult = await this.executeToolCall(
					toolName,
					toolCall.function.arguments,
					config,
					signal,
				);

				// Count tokens from tool results
				totalTokens += estimateTokens(toolResult);

				messages.push({
					role: 'tool',
					content: toolResult,
					tool_call_id: toolCall.id,
					name: toolName,
				});

				emitProgress('running', toolName);
				await new Promise(resolve => setTimeout(resolve, 50));
			}
		}

		// Hit max iterations
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i]?.role === 'assistant' && messages[i]?.content) {
				return messages[i].content;
			}
		}
		return '';
	}

	/**
	 * Execute a single tool call with permission enforcement and argument parsing.
	 */
	private async executeToolCall(
		toolName: string,
		rawArguments: unknown,
		config: SubagentConfigWithSource,
		signal?: AbortSignal,
	): Promise<string> {
		if (signal?.aborted) {
			return 'Error: Execution was cancelled';
		}
		if (config.permissionMode === 'readOnly') {
			if (!this.toolManager.isReadOnly(toolName)) {
				return `Error: Tool '${toolName}' is not read-only. Subagent is in read-only mode.`;
			}
		}

		const toolHandler = this.toolManager.getToolHandler(toolName);
		if (!toolHandler) {
			return `Error: Tool '${toolName}' not found`;
		}

		try {
			const parsedArgs = parseToolArguments(rawArguments);
			return await toolHandler(parsedArgs);
		} catch (error) {
			return `Error: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
}
