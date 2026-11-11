import {runTurnEngine} from '@/agent-loop/turn-engine';
import {
	createWalkthroughLifecycle,
	observeSuccessfulLifecycleTool,
	takeWalkthroughFallback,
} from '@/artifacts/walkthrough-lifecycle';
import {
	DEFAULT_HEADLESS_MAX_TURNS,
	getAppConfig,
	getRetryLimits,
} from '@/config/index';
import {TOOL_APPROVAL_REQUIRED_KIND} from '@/constants';
import {partitionUnknownToolCalls} from '@/hooks/chat-handler/utils/tool-filters';
import {processToolUse} from '@/message-handler';
import {color, write, writeError, writeLine, writeStatus} from '@/plain/writer';
import {resolveToolApproval} from '@/tools/approval-policy';
import type {ToolManager} from '@/tools/tool-manager';
import type {TuneConfig} from '@/types/config';
import type {
	DevelopmentMode,
	LLMChatResponse,
	LLMClient,
	Message,
	ToolCall,
	ToolResult,
} from '@/types/core';
import {formatError} from '@/utils/error-formatter';

export interface ToolCallLog {
	name: string;
	arguments: Record<string, unknown>;
	result: string | null;
	error: string | null;
}

export interface RunPlainConversationOptions {
	client: LLMClient;
	toolManager: ToolManager;
	systemMessage: Message;
	initialMessages: Message[];
	developmentMode: DevelopmentMode;
	nonInteractiveAlwaysAllow: string[];
	abortSignal: AbortSignal;
	tune?: TuneConfig;
	model?: string;
	outputFormat?: 'text' | 'json';
	sessionId?: string;
	workingDirectory?: string;
	/**
	 * Force a walkthrough after approved-plan work. Off by default: the plain
	 * shell's artifact directory is ephemeral, so a forced walkthrough there
	 * would cost a model turn and then be deleted unread.
	 */
	enforceWalkthrough?: boolean;
}

export interface PlainConversationUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
}

// `steps` counts model round-trips, including retried turns. It is not
// `toolCalls.length`: one step can issue zero or several tool calls.
export type PlainConversationOutcome =
	| {
			kind: 'success';
			finalText: string;
			reasoning: string | null;
			toolCalls: ToolCallLog[];
			steps: number;
			usage?: PlainConversationUsage;
	  }
	| {
			kind: 'tool-approval-required';
			toolNames: string[];
			/**
			 * Whether `--mode auto-accept` would have run every blocked call
			 * without asking. Always false when the run is already in auto-accept.
			 */
			autoAcceptWouldRun: boolean;
			finalText: string;
			reasoning: string | null;
			toolCalls: ToolCallLog[];
			steps: number;
			usage?: PlainConversationUsage;
	  }
	| {
			kind: 'error';
			message: string;
			finalText: string;
			reasoning: string | null;
			toolCalls: ToolCallLog[];
			steps: number;
			usage?: PlainConversationUsage;
	  };

// What a run that stopped on a call needing approval reports, on top of the
// fields every outcome carries.
interface ApprovalRequired {
	toolNames: string[];
	autoAcceptWouldRun: boolean;
}

/**
 * Headless conversation loop. Streams assistant text to stdout, runs tools
 * via processToolUse, and runs the shared turn engine until the model produces a content-only
 * response or hits a tool that needs human approval (which exits early in
 * plain mode — there's no interactive prompt).
 *
 * The turn ceiling guards against a wedged model looping unbounded in an
 * unattended run. It defaults to DEFAULT_HEADLESS_MAX_TURNS and is overridable
 * via the NANOCODER_MAX_TURNS env var or `nanocoder.headless.maxTurns` config.
 *
 * Within that ceiling the `nanocoder.retries` limits also apply, mirroring the
 * interactive loop: consecutive identical tool calls, consecutive empty turns,
 * and malformed tool-call retries each hard-stop with a clear error once their
 * cap is hit (there is no user to ask in a plain run).
 */
export async function runPlainConversation(
	options: RunPlainConversationOptions,
): Promise<PlainConversationOutcome> {
	const {client, initialMessages, model} = options;

	// Lifetime /stats: count each initial user prompt in this headless run.
	try {
		const {recordUserPrompt} = await import('@/stats/record');
		const provider = client.getProviderConfig().name;
		const modelName = model ?? client.getCurrentModel();
		for (const msg of initialMessages) {
			if (msg.role === 'user') {
				recordUserPrompt(provider, modelName);
			}
		}
	} catch {
		// Stats must never fail the plain loop.
	}

	try {
		return await runPlainConversationBody(options, initialMessages, model);
	} finally {
		// Debounced stats writes use an unref'd timer — flush before exit so
		// --plain / headless runs don't lose the ledger.
		try {
			const {finalizeStatsForExit} = await import('@/stats/record');
			finalizeStatsForExit();
		} catch {
			// Stats must never fail the plain loop.
		}
	}
}

async function runPlainConversationBody(
	options: RunPlainConversationOptions,
	initialMessages: Message[],
	model: string | undefined,
): Promise<PlainConversationOutcome> {
	const {
		client,
		toolManager,
		systemMessage,
		developmentMode,
		nonInteractiveAlwaysAllow,
		abortSignal,
		tune,
		outputFormat = 'text',
		sessionId,
		workingDirectory = process.cwd(),
		enforceWalkthrough = false,
	} = options;

	const isJson = outputFormat === 'json';

	let messages = initialMessages;
	const walkthroughLifecycle = createWalkthroughLifecycle(initialMessages);
	let accumulatedFinalText = '';
	let finalTextBeforeWalkthroughNudge: string | undefined;
	let accumulatedReasoning = '';
	const toolCallsLog: ToolCallLog[] = [];

	let hasReportedUsage = false;
	let accumulatedInputTokens = 0;
	let accumulatedOutputTokens = 0;
	let accumulatedTotalTokens = 0;
	let accumulatedCacheReadTokens = 0;
	let accumulatedCacheWriteTokens = 0;

	const getUsage = (): PlainConversationUsage | undefined => {
		if (!hasReportedUsage) return undefined;
		return {
			inputTokens: accumulatedInputTokens,
			outputTokens: accumulatedOutputTokens,
			totalTokens: accumulatedTotalTokens,
			...(accumulatedCacheReadTokens > 0
				? {cacheReadTokens: accumulatedCacheReadTokens}
				: {}),
			...(accumulatedCacheWriteTokens > 0
				? {cacheWriteTokens: accumulatedCacheWriteTokens}
				: {}),
		};
	};

	// The client always returns a `usage` object, but every field inside it is
	// optional — providers that report nothing leave all three undefined, and
	// OpenAI-compatible local servers commonly report input/output without a
	// total. Only count a turn as reporting usage when at least one field is a
	// real number, so the block stays absent (rather than an all-zero block
	// indistinguishable from a genuine zero) for providers with no telemetry.
	const recordUsage = async (result: LLMChatResponse) => {
		const turnUsage = result?.usage;
		const inputTokens =
			typeof turnUsage?.inputTokens === 'number' ? turnUsage.inputTokens : null;
		const outputTokens =
			typeof turnUsage?.outputTokens === 'number'
				? turnUsage.outputTokens
				: null;
		const totalTokens =
			typeof turnUsage?.totalTokens === 'number' ? turnUsage.totalTokens : null;
		const cacheReadTokens =
			typeof turnUsage?.cacheReadTokens === 'number'
				? turnUsage.cacheReadTokens
				: null;
		const cacheWriteTokens =
			typeof turnUsage?.cacheWriteTokens === 'number'
				? turnUsage.cacheWriteTokens
				: null;

		if (
			inputTokens === null &&
			outputTokens === null &&
			totalTokens === null &&
			cacheReadTokens === null &&
			cacheWriteTokens === null
		) {
			return;
		}
		hasReportedUsage = true;
		accumulatedInputTokens += inputTokens ?? 0;
		accumulatedOutputTokens += outputTokens ?? 0;
		accumulatedCacheReadTokens += cacheReadTokens ?? 0;
		accumulatedCacheWriteTokens += cacheWriteTokens ?? 0;
		// Fall back to input+output so a missing total never reads as zero spend.
		const turnTotal = totalTokens ?? (inputTokens ?? 0) + (outputTokens ?? 0);
		accumulatedTotalTokens += turnTotal;
		// Lifetime /stats (headless / --plain paths) with estimated cost.
		try {
			const {recordApiCallForStats} = await import('@/stats/record');
			await recordApiCallForStats({
				provider: client.getProviderConfig().name,
				model: options.model ?? client.getCurrentModel(),
				inputTokens: inputTokens ?? undefined,
				outputTokens: outputTokens ?? undefined,
				totalTokens: turnTotal,
				cacheReadTokens: cacheReadTokens ?? undefined,
				cacheWriteTokens: cacheWriteTokens ?? undefined,
			});
		} catch {
			// Stats must never fail the plain loop.
		}
	};

	const maxTurns =
		getAppConfig().headless?.maxTurns ?? DEFAULT_HEADLESS_MAX_TURNS;

	// Agent-loop retry limits (`nanocoder.retries`): the same caps the
	// interactive loop applies. There is nobody to ask in a plain run, so
	// hitting any of them hard-stops with a clear error instead of pausing.
	const retryLimits = getRetryLimits();
	const {maxEmptyTurns, maxMalformedRetries, maxTruncatedTurns} = retryLimits;

	// Snapshot taken before each model call. Streamed text lands in the
	// accumulators as it arrives, before we know whether the turn is usable. A
	// turn rejected as malformed is discarded and retried, so it rolls back to
	// this. Otherwise the rejected tool-call blob stays glued to the front of
	// the finalText a later successful turn returns (visible to --json
	// consumers).
	let finalTextBeforeTurn = '';
	let reasoningBeforeTurn = '';

	const result = await runTurnEngine<ApprovalRequired>({
		client,
		signal: abortSignal,
		maxTurns,
		retryLimits,
		adapter: {
			history: {
				get: () => messages,
				set: next => {
					messages = next;
				},
			},
			getSystemMessage: () => systemMessage,
			prepareTurn: () => {
				const availableNames = toolManager.getAvailableToolNames(
					tune,
					developmentMode,
					undefined,
					model,
				);
				return {
					tools: toolManager.getFilteredTools(availableNames),
					availableNames,
					modeOverrides: {
						nonInteractiveMode: true,
						nonInteractiveAlwaysAllow,
					},
				};
			},
			beginModelCall: () => {
				let streamedReasoning = '';
				let reasoningPrinted = false;
				let contentStarted = false;
				finalTextBeforeTurn = accumulatedFinalText;
				reasoningBeforeTurn = accumulatedReasoning;
				return {
					callbacks: {
						onReasoningToken: (token: string) => {
							streamedReasoning += token;
							accumulatedReasoning += token;
							if (!isJson) {
								if (!reasoningPrinted) {
									reasoningPrinted = true;
									write(color('gray', '> '));
								}
								write(color('gray', token));
							}
						},
						onToken: (token: string) => {
							accumulatedFinalText += token;
							if (!isJson) {
								if (reasoningPrinted && !contentStarted) {
									writeLine();
								}
								if (!contentStarted) {
									contentStarted = true;
								}
								write(token);
							}
						},
					},
					reasoning: () => streamedReasoning || undefined,
					end: () => {
						if (!isJson && (reasoningPrinted || contentStarted)) {
							writeLine();
						}
					},
				};
			},
			onModelResponse: recordUsage,
			partitionToolCalls: (toolCalls, prepared) =>
				partitionUnknownToolCalls(
					toolCalls,
					toolManager,
					prepared.availableNames,
				),
			onRejectedToolCalls: ({rejectedToolCalls, errorResults}) => {
				// errorResults is paired 1:1 with rejectedToolCalls, in order.
				for (const [index, toolCall] of rejectedToolCalls.entries()) {
					toolCallsLog.push({
						name: toolCall.function.name,
						arguments: toolCall.function.arguments || {},
						result: null,
						error: errorResults[index].content,
					});
				}
			},
			compactOptions: () => ({
				onNotify: isJson
					? undefined
					: message => writeStatus(message.split('\n')[0] ?? message),
			}),
			onMalformedRetry: ({error, attempt}) => {
				accumulatedFinalText = finalTextBeforeTurn;
				accumulatedReasoning = reasoningBeforeTurn;
				if (!isJson) {
					writeError(
						`Malformed tool call: ${error} — asking the model to retry (${attempt}/${maxMalformedRetries}).`,
					);
				}
			},
			onEmptyRetry: attempt => {
				if (!isJson) {
					// Count attempts, not nudges, so the denominator matches the
					// "no output after N attempts" stop message.
					writeStatus(`empty response — retry ${attempt}/${maxEmptyTurns + 1}`);
				}
			},
			onTruncatedRetry: attempt => {
				if (!isJson) {
					writeStatus(
						`response truncated at the output limit — continuing ${attempt}/${maxTruncatedTurns}`,
					);
				}
			},
			onTruncatedGiveUp: message => {
				if (!isJson) {
					writeStatus(message);
				}
			},
			onFinalAnswer: ({finalTurn, prepared}) => {
				// Only nudge when the walkthrough will actually outlive the run.
				// `nanocoder --plain` deletes its ephemeral artifact directory on
				// exit and reports nothing about the walkthrough, so forcing one
				// there buys an extra model round trip for a file nobody reads.
				const walkthroughFallback =
					finalTurn || !enforceWalkthrough
						? null
						: takeWalkthroughFallback(
								walkthroughLifecycle,
								prepared.availableNames.includes('write_walkthrough'),
							);
				if (walkthroughFallback) {
					finalTextBeforeWalkthroughNudge ??= accumulatedFinalText;
					return {kind: 'continue', messages: [walkthroughFallback]};
				}
				return {kind: 'finish'};
			},
			executeTools: async toolCalls => {
				const toolsNeedingApproval: ToolCall[] = [];
				const toolsToExecute: ToolCall[] = [];
				for (const toolCall of toolCalls) {
					// Approval (including the yolo bypass) is resolved centrally.
					const needsApproval = await evaluateNeedsApproval(
						toolCall,
						toolManager,
						nonInteractiveAlwaysAllow,
						developmentMode,
					);
					if (needsApproval) {
						toolsNeedingApproval.push(toolCall);
					} else {
						toolsToExecute.push(toolCall);
					}
				}

				// Plain mode has no interactive prompt, so a call that needs
				// approval ends the run before anything executes.
				if (toolsNeedingApproval.length > 0) {
					return {
						kind: 'stop',
						payload: {
							toolNames: toolsNeedingApproval.map(tc => tc.function.name),
							autoAcceptWouldRun: await evaluateAutoAcceptWouldRun(
								toolsNeedingApproval,
								toolManager,
								nonInteractiveAlwaysAllow,
								developmentMode,
							),
						},
					};
				}

				const toolResults: ToolResult[] = [];
				for (const toolCall of toolsToExecute) {
					if (!isJson) {
						writeStatus(`tool: ${toolCall.function.name}`);
					}

					const toolResult = await processToolUse(toolCall, {
						abortSignal,
						sessionId,
						workingDirectory,
					});
					toolResults.push(toolResult);
					if (!toolResult.isError) {
						observeSuccessfulLifecycleTool(walkthroughLifecycle, toolCall);
					}

					const contentStr = toolResult.content
						? typeof toolResult.content === 'string'
							? toolResult.content
							: JSON.stringify(toolResult.content)
						: null;

					// processToolUse signals failure via `isError`, not a separate
					// `.error` field — the failure message itself still lives in
					// `content` (it has to, since that's what gets sent back to the
					// model as the tool message). `isError` just tells us how to
					// bucket it for the JSON telemetry report.
					toolCallsLog.push({
						name: toolCall.function.name,
						arguments: toolCall.function.arguments || {},
						result: toolResult.isError ? null : contentStr,
						error: toolResult.isError ? contentStr : null,
					});
				}
				return {kind: 'continue', results: toolResults};
			},
		},
	});

	// The report fields every outcome carries.
	const snapshot = () => ({
		finalText: accumulatedFinalText,
		reasoning: accumulatedReasoning || null,
		toolCalls: toolCallsLog,
		steps: result.modelCalls,
		usage: getUsage(),
	});

	// No writeError for `error` outcomes: the caller prints every one's
	// message once (source/plain/shell.ts), and --json reports it instead.
	const error = (message: string): PlainConversationOutcome => ({
		kind: 'error',
		message,
		...snapshot(),
	});

	switch (result.kind) {
		case 'completed':
			return {
				kind: 'success',
				...snapshot(),
				finalText: finalTextBeforeWalkthroughNudge ?? accumulatedFinalText,
			};
		case 'adapter-stop':
			return {
				kind: TOOL_APPROVAL_REQUIRED_KIND,
				...result.payload,
				...snapshot(),
			};
		case 'aborted':
			return error('Aborted');
		case 'model-error':
			// An HTTP error or dropped connection. Returned as an outcome so the
			// caller still prints its report (with the tool calls that already
			// ran) and exits through graceful shutdown.
			return error(formatError(result.error));
		case 'no-response':
		case 'no-system-message':
			return error('No response received from model');
		case 'guard-stop':
			return error(result.message);
		case 'max-turns':
			// Defensive: the final turn forces a tool-free answer, so the engine
			// normally finishes inside the loop. Reaching here means even that
			// produced no usable result.
			return error(
				`Conversation exceeded ${result.maxTurns} turns without a final answer`,
			);
	}
}

async function evaluateNeedsApproval(
	toolCall: ToolCall,
	toolManager: ToolManager,
	nonInteractiveAlwaysAllow: string[],
	mode: DevelopmentMode,
): Promise<boolean> {
	const toolEntry = toolManager.getToolEntry(toolCall.function.name);
	return resolveToolApproval(
		toolCall.function.name,
		toolEntry,
		toolCall.function.arguments,
		{mode, alwaysAllow: nonInteractiveAlwaysAllow},
	);
}

// Decided per call rather than per tool name because auto-accept still asks
// for some calls of tools it otherwise waives (a file_op delete, for one), so
// the name alone can't say whether suggesting it would change the result.
async function evaluateAutoAcceptWouldRun(
	blockedToolCalls: ToolCall[],
	toolManager: ToolManager,
	nonInteractiveAlwaysAllow: string[],
	mode: DevelopmentMode,
): Promise<boolean> {
	if (mode === 'auto-accept') return false;
	for (const toolCall of blockedToolCalls) {
		const needsApproval = await evaluateNeedsApproval(
			toolCall,
			toolManager,
			nonInteractiveAlwaysAllow,
			'auto-accept',
		);
		if (needsApproval) return false;
	}
	return true;
}
