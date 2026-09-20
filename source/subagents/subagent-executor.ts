/**
 * Subagent Executor
 *
 * Handles execution of subagent tasks with isolated context and tool filtering.
 * Supports concurrent execution via unique agentId for progress isolation.
 */

import {createLLMClient} from '@/client-factory';
import {getAppConfig, getRetryLimits} from '@/config/index';
import {getProjectContextPreferences} from '@/config/preferences';
import {computeToolCallSignature} from '@/hooks/chat-handler/utils/tool-signature';
import {
	appendRelevantProjectContextWithCount,
	type MemoryFinder,
	type ProjectContextOptions,
} from '@/memory/project-context';
import {SemanticMemoryManager} from '@/memory/semantic-memory-manager';
import {
	appendPostToolUseOutput,
	runPreToolUseGate,
} from '@/services/lifecycle-hooks';
import {
	appendSubagentTool,
	getSubagentProgress,
	subagentProgress,
	updateSubagentProgress,
	updateSubagentProgressById,
} from '@/services/subagent-events';
import {
	cleanupSubagentSession,
	initSubagentSession,
	updateSubagentSessionMessages,
	updateSubagentSessionStreaming,
} from '@/services/subagent-session-store';
import {resolveToolApproval} from '@/tools/approval-policy';
import {SESSION_ARTIFACT_TOOLS, type ToolManager} from '@/tools/tool-manager';
import type {
	AISDKCoreTool,
	ApiCallRecord,
	ApiUsage,
	DevelopmentMode,
	LLMClient,
	Message,
	ToolCall,
	ToolExecutionContext,
} from '@/types/core';
import {maybeAutoCompact} from '@/utils/auto-compact';
import {formatError} from '@/utils/error-formatter';
import {capMessagesForModel} from '@/utils/message-capping';
import {signalToolApproval} from '@/utils/tool-approval-queue';
import {parseToolArguments} from '@/utils/tool-args-parser';
import {toolErrorToContent} from '@/utils/tool-validation';
import {truncateToolResult} from '@/utils/truncate-tool-result';
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

/** Receives provider-reported usage for one subagent model invocation. */
export type SubagentApiCallHandler = (
	call: ApiCallRecord,
) => void | Promise<void>;

export interface SubagentExecutorOptions {
	memoryFinder?: MemoryFinder;
	projectContextOptions?: ProjectContextOptions;
	onApiCallComplete?: SubagentApiCallHandler;
}

function hasReportedUsage(usage: ApiUsage | undefined): usage is ApiUsage {
	return (
		usage !== undefined &&
		(Number.isFinite(usage.inputTokens) ||
			Number.isFinite(usage.outputTokens) ||
			Number.isFinite(usage.totalTokens) ||
			Number.isFinite(usage.cacheReadTokens) ||
			Number.isFinite(usage.cacheWriteTokens))
	);
}

/** Stats adapter used by production subagent runtimes. */
export async function recordSubagentApiCallForStats(
	call: ApiCallRecord,
): Promise<void> {
	try {
		const {recordApiCallForStats} = await import('@/stats/record');
		await recordApiCallForStats(call);
	} catch {
		// Usage accounting must never affect subagent execution.
	}
}

/**
 * Thrown when the conversation loop stops itself (repeated-call cap). Carries
 * the assistant text produced before the stop so the parent still receives the
 * work the subagent did complete instead of an empty result.
 */
class SubagentLoopStopError extends Error {
	readonly partialOutput: string;

	constructor(message: string, partialOutput: string) {
		super(message);
		this.name = 'SubagentLoopStopError';
		this.partialOutput = partialOutput;
	}
}

/**
 * SubagentExecutor manages the execution of delegated tasks to subagents.
 * Each subagent runs in an isolated context with filtered tools.
 */
export class SubagentExecutor {
	private toolManager: ToolManager;
	private parentClient: LLMClient;
	private projectRoot: string;
	private parentMode: DevelopmentMode;
	private onApiCallComplete?: SubagentApiCallHandler;
	/**
	 * Live source for the current development mode, read on every tool-approval
	 * check. When set (the interactive app wires it to the same ref the main
	 * loop uses), it takes precedence over the static `parentMode` so the
	 * subagent honors the mode at spawn time AND a switch made while it is mid
	 * execution (e.g. flipping to yolo). Falls back to `parentMode` for callers
	 * that don't supply a resolver (plain shell, tests).
	 */
	private modeResolver?: () => DevelopmentMode;
	private memoryFinder: MemoryFinder;
	private projectContextOptions?: ProjectContextOptions;

	constructor(
		toolManager: ToolManager,
		parentClient: LLMClient,
		projectRoot: string = process.cwd(),
		parentMode: DevelopmentMode = 'normal',
		optionsOrHandler: SubagentExecutorOptions | SubagentApiCallHandler = {},
	) {
		this.toolManager = toolManager;
		this.parentClient = parentClient;
		this.projectRoot = projectRoot;
		this.parentMode = parentMode;
		const options =
			typeof optionsOrHandler === 'function'
				? {onApiCallComplete: optionsOrHandler}
				: optionsOrHandler;
		this.onApiCallComplete = options.onApiCallComplete;
		this.memoryFinder =
			options.memoryFinder ??
			new SemanticMemoryManager({cwd: this.projectRoot});
		this.projectContextOptions = options.projectContextOptions;
	}

	/**
	 * Update the parent development mode (called when mode changes).
	 */
	setParentMode(mode: DevelopmentMode): void {
		this.parentMode = mode;
	}

	/**
	 * Provide a live getter for the current development mode. Read per tool
	 * call, so mode changes take effect immediately - including while a
	 * subagent is already running.
	 */
	setModeResolver(resolver: () => DevelopmentMode): void {
		this.modeResolver = resolver;
	}

	/** The mode in effect right now: live resolver if set, else the snapshot. */
	private currentMode(): DevelopmentMode {
		return this.modeResolver ? this.modeResolver() : this.parentMode;
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
		executionContext?: Omit<ToolExecutionContext, 'abortSignal'>,
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

			const context = this.createSubagentContext(config, task);
			const filteredTools = this.filterTools(config);
			const recalled = await appendRelevantProjectContextWithCount(
				context.systemMessage,
				this.buildTaskPrompt(task),
				this.memoryFinder,
				{
					...getProjectContextPreferences(),
					...this.projectContextOptions,
				},
			);

			const messages: Message[] = [
				{role: 'system', content: recalled.systemPrompt},
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
			const pendingUsageWrites: Promise<void>[] = [];
			const recordUsage = (call: ApiCallRecord): void => {
				if (!this.onApiCallComplete) {
					return;
				}

				try {
					const result = this.onApiCallComplete(call);
					if (result) {
						pendingUsageWrites.push(Promise.resolve(result).catch(() => {}));
					}
				} catch {
					// Usage accounting must never affect subagent execution.
				}
			};

			try {
				const output = await this.runSubagentConversation(
					client,
					messages,
					filteredTools,
					config,
					signal,
					agentId,
					executionContext,
					recordUsage,
				);

				// Read the final estimated progress count. Provider-reported usage is
				// sent through recordUsage and is the source for lifetime accounting.
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
				await Promise.allSettled(pendingUsageWrites);
				if (agentId) {
					cleanupSubagentSession(agentId);
				}
				restoreParent();
			}
		} catch (error) {
			return {
				subagentName: task.subagent_type,
				// A loop stop still returns whatever the subagent produced before
				// it got stuck, so the parent can use the partial work instead of
				// being handed an empty result.
				output:
					error instanceof SubagentLoopStopError ? error.partialOutput : '',
				success: false,
				error: formatError(error),
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
		const allTools = Object.keys(
			this.toolManager.getAllTools({forSkill: config.ownerSkill}),
		);

		let available = allTools;

		if (config.tools && config.tools.length > 0) {
			available = available.filter(tool => config.tools?.includes(tool));
		}

		if (config.disallowedTools && config.disallowedTools.length > 0) {
			available = available.filter(
				tool => !config.disallowedTools?.includes(tool),
			);
		}

		// Honor the global disabledTools list — applies to subagents too.
		const globalDisabled = getAppConfig().disabledTools;
		if (globalDisabled && globalDisabled.length > 0) {
			const disabledSet = new Set(globalDisabled);
			available = available.filter(name => !disabledSet.has(name));
		}

		// Always exclude agent tool to prevent infinite recursion
		available = available.filter(name => name !== 'agent');

		// Always exclude the session-artifact tools. Subagents run with the
		// parent's session id, so `getAllTools()` (which applies no development
		// mode) would otherwise let a subagent overwrite the very plan, task
		// list, or walkthrough the user is about to act on.
		const artifactTools = new Set<string>(SESSION_ARTIFACT_TOOLS);
		available = available.filter(name => !artifactTools.has(name));

		return available;
	}

	/**
	 * Filter tools based on subagent configuration.
	 * Only includes tools in the allow list (or all if no list specified),
	 * minus any in the disallow list, and always excludes the agent tool.
	 */
	private filterTools(
		config: SubagentConfigWithSource,
	): Record<string, AISDKCoreTool> {
		const allTools = this.toolManager.getAllTools({
			forSkill: config.ownerSkill,
		});
		const availableNames = this.getAvailableToolNames(config);

		const filtered: Record<string, AISDKCoreTool> = {} as Record<
			string,
			AISDKCoreTool
		>;
		for (const name of availableNames) {
			if (!(name in allTools)) continue;
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
		const requestedContextWindow =
			typeof config.contextWindow === 'number'
				? config.contextWindow
				: undefined;
		const parentProviderConfig = this.parentClient.getProviderConfig();
		const targetProvider = config.provider ?? parentProviderConfig.name;
		const targetModel =
			config.model && config.model !== 'inherit'
				? config.model
				: targetProvider === parentProviderConfig.name
					? this.parentClient.getCurrentModel()
					: undefined;

		if (requestedContextWindow) {
			const {client} = await createLLMClient(targetProvider, targetModel, {
				contextWindow: requestedContextWindow,
			});
			return {client, restoreParent: () => {}};
		}

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
				const {client} = await createLLMClient(
					parentProviderConfig.name,
					config.model,
				);
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
		config: SubagentConfigWithSource,
		signal?: AbortSignal,
		agentId?: string,
		executionContext?: Omit<ToolExecutionContext, 'abortSignal'>,
		onApiCallComplete?: SubagentApiCallHandler,
	): Promise<string> {
		let iterations = 0;
		let totalToolCalls = 0;
		let totalTokens = 0;

		let streamingText = '';
		let streamingReasoning = '';

		// Repeated-call cap (`nanocoder.retries.maxRepeatedToolCalls`): the same
		// agent-loop guard the main runtimes apply. A subagent re-issuing the
		// identical tool call(s) on consecutive turns is stuck; there is no user
		// to ask inside a delegated run, so hitting the cap stops with an error.
		// The signature covers every emitted call, so a subagent stuck on an
		// unknown tool trips the cap too.
		//
		// Deliberately out of scope for #897: a hard turn ceiling (the plain and
		// ACP `maxTurns` equivalent) and alternating-pattern detection, so a
		// subagent cycling A, B, A, B... is still only bounded by the parent's
		// abort signal. Revisit as its own change.
		const {maxRepeatedToolCalls} = getRetryLimits();
		let lastToolSignature = '';
		let repeatedToolCallCount = 0;

		// Assistant text from every turn so far. The repeated-call stop hands
		// this to the parent instead of discarding the work already done.
		const assistantTranscript: string[] = [];

		if (agentId) {
			initSubagentSession(agentId, config.name, messages);
		}

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

		while (true) {
			// Check for cancellation before each turn
			if (signal?.aborted) {
				emitProgress('error');
				throw new Error('Aborted');
			}

			iterations++;

			// Yield to event loop so Ink can render current state
			emitProgress('running');
			await new Promise(resolve => setTimeout(resolve, 50));

			// Capture these before the request so a concurrent parent-model change
			// cannot misattribute the provider's usage to another model.
			const provider = client.getProviderConfig().name || 'unknown';
			const model = client.getCurrentModel() || 'unknown';
			const maxMessages = getAppConfig().sessions?.maxMessages ?? 1000;
			const systemMessage =
				messages[0]?.role === 'system' ? messages[0] : undefined;
			const history = systemMessage ? messages.slice(1) : messages;
			const cappedHistory = capMessagesForModel(history, maxMessages);
			const modelMessages = systemMessage
				? [systemMessage, ...cappedHistory]
				: cappedHistory;

			const response = await client.chat(
				modelMessages,
				tools,
				{
					onToken: token => {
						totalTokens++;
						if (agentId) {
							streamingText += token;
							updateSubagentSessionStreaming(
								agentId,
								streamingText,
								streamingReasoning,
							);
						}
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
					onReasoningToken: token => {
						totalTokens++;
						if (agentId) {
							streamingReasoning += token;
							updateSubagentSessionStreaming(
								agentId,
								streamingText,
								streamingReasoning,
							);
						}
						// Update the live token count directly on the mutable
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

			if (onApiCallComplete && hasReportedUsage(response.usage)) {
				onApiCallComplete({
					provider,
					model,
					inputTokens: response.usage.inputTokens,
					outputTokens: response.usage.outputTokens,
					totalTokens: response.usage.totalTokens,
					...(response.usage.cacheReadTokens !== undefined && {
						cacheReadTokens: response.usage.cacheReadTokens,
					}),
					...(response.usage.cacheWriteTokens !== undefined && {
						cacheWriteTokens: response.usage.cacheWriteTokens,
					}),
					timestamp: Date.now(),
				});
			}

			const responseContent = response.choices[0]?.message.content || '';
			if (responseContent.trim()) {
				assistantTranscript.push(responseContent);
			}

			const toolCalls = response.choices[0]?.message.tool_calls;
			if (!toolCalls || toolCalls.length === 0) {
				emitProgress('complete');
				return responseContent;
			}

			const currentToolSignature = computeToolCallSignature(toolCalls);
			const currentRepeatedCount =
				currentToolSignature && currentToolSignature === lastToolSignature
					? repeatedToolCallCount + 1
					: 1;
			if (currentRepeatedCount >= maxRepeatedToolCalls) {
				emitProgress('error');
				throw new SubagentLoopStopError(
					`Subagent repeated the same tool call ${currentRepeatedCount} times in a row without making progress — stopping to avoid a loop (nanocoder.retries.maxRepeatedToolCalls = ${maxRepeatedToolCalls}).`,
					assistantTranscript.join('\n\n'),
				);
			}
			lastToolSignature = currentToolSignature;
			repeatedToolCallCount = currentRepeatedCount;

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
			if (systemMessage) {
				// Gate on the same view the model receives, so the threshold is not
				// measured against rows the cap already dropped from the request.
				const gateInput = capMessagesForModel(messages.slice(1), maxMessages);
				const compacted = await maybeAutoCompact(
					gateInput,
					systemMessage,
					client,
					tools,
					{signal},
				);
				// Only adopt the result when compaction actually ran. Otherwise
				// maybeAutoCompact hands back the capped view it was given, and
				// writing that in would permanently discard history the cap only
				// ever meant to hide from a single request.
				if (compacted !== gateInput) {
					messages.splice(0, messages.length, systemMessage, ...compacted);
				}
			}
			if (agentId) {
				streamingText = '';
				streamingReasoning = '';
				updateSubagentSessionStreaming(
					agentId,
					streamingText,
					streamingReasoning,
				);
				updateSubagentSessionMessages(agentId, messages);
			}

			// Execute each tool call — yield between each so Ink can render
			for (const toolCall of toolCalls) {
				// Check for cancellation before each tool call
				if (signal?.aborted) {
					emitProgress('error');
					throw new Error('Aborted');
				}

				const toolName = toolCall.function.name;
				totalToolCalls++;
				appendSubagentTool(agentId, toolName);
				emitProgress('tool_call', toolName);
				await new Promise(resolve => setTimeout(resolve, 50));

				const toolResult = await this.executeToolCall(
					toolName,
					toolCall.function.arguments,
					toolCall.id,
					config,
					signal,
					executionContext,
				);

				// Count tokens from tool results
				totalTokens += estimateTokens(toolResult);

				messages.push({
					role: 'tool',
					content: toolResult,
					tool_call_id: toolCall.id,
					name: toolName,
				});
				if (agentId) {
					updateSubagentSessionMessages(agentId, messages);
				}

				emitProgress('running', toolName);
				await new Promise(resolve => setTimeout(resolve, 50));
			}
		}

		// Unreachable — loop exits via return when model stops calling tools
		return '';
	}

	/**
	 * Check if a tool needs user approval.
	 * Uses the same logic as the main conversation loop.
	 */
	private async needsApprovalForTool(
		toolName: string,
		rawArguments: unknown,
	): Promise<boolean> {
		const toolEntry = this.toolManager.getToolEntry(toolName);
		return resolveToolApproval(toolName, toolEntry, rawArguments, {
			mode: this.currentMode(),
		});
	}

	/**
	 * Execute a single tool call with permission enforcement, approval, and argument parsing.
	 */
	private async executeToolCall(
		toolName: string,
		rawArguments: unknown,
		toolCallId: string,
		config: SubagentConfigWithSource,
		signal?: AbortSignal,
		executionContext?: Omit<ToolExecutionContext, 'abortSignal'>,
	): Promise<string> {
		if (signal?.aborted) {
			return 'Error: Execution was cancelled';
		}

		// Enforce the allow-list at the execution boundary, not just when
		// choosing which tools to offer. `getToolHandler` resolves a handler for
		// every *registered* tool, so a subagent that names a filtered tool
		// anyway — hallucinated, or coaxed there by its own prompt — would
		// otherwise run it. That let a read-only agent like `explore` write
		// files, and let any subagent overwrite the parent session's plan, task
		// list, or walkthrough (subagents run with the parent's session id).
		if (!this.getAvailableToolNames(config).includes(toolName)) {
			return (
				`Error: Tool '${toolName}' is not available to this subagent. ` +
				'Use only the tools listed in your instructions.'
			);
		}

		const toolHandler = this.toolManager.getToolHandler(toolName);
		if (!toolHandler) {
			return `Error: Tool '${toolName}' not found`;
		}

		// One ToolCall object for this call, shared by the approval prompt and
		// the lifecycle gate so runPreToolUseGate can key its once-per-call
		// suppression on it.
		const parsedArgs =
			parseToolArguments<Record<string, unknown>>(rawArguments);
		const toolCall: ToolCall = {
			id: toolCallId,
			function: {
				name: toolName,
				arguments: parsedArgs,
			},
		};

		// Subagents run their own loop rather than going through processToolUse,
		// so the lifecycle gate has to be applied here too — a policy hook must
		// hold for delegated work as much as for the main conversation. It runs
		// before the approval prompt so a vetoed tool never asks the user to
		// approve something that is about to be refused anyway.
		const gate = await runPreToolUseGate(toolCall, parsedArgs);
		if (gate.blocked) {
			return `Error: ${gate.reason}`;
		}

		// Check if this tool needs user approval
		const needsApproval = await this.needsApprovalForTool(
			toolName,
			rawArguments,
		);
		if (needsApproval) {
			const approved = await signalToolApproval({
				toolCall,
				subagentName: config.name,
			});

			if (!approved) {
				return 'Tool execution was denied by the user.';
			}
		}

		try {
			const result = await toolHandler(parsedArgs, {
				...executionContext,
				abortSignal: signal,
			});
			// Subagents converse in text, so collapse structured output to its
			// text representation.
			const content =
				typeof result === 'string'
					? result
					: (result.llmContent ?? JSON.stringify(result));
			return appendPostToolUseOutput(
				toolName,
				parsedArgs,
				truncateToolResult(content),
			);
		} catch (error) {
			// Handler validation failures surface here too (the handler is
			// validated), formatted with any structured detail. post-tool-use
			// still fires: a failed delegated call is exactly what an audit-log
			// hook needs to see, and dropping it would make this surface disagree
			// with processToolUse.
			return appendPostToolUseOutput(
				toolName,
				parsedArgs,
				truncateToolResult(toolErrorToContent(error)),
			);
		}
	}
}
