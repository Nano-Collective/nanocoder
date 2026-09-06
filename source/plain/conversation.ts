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
import {
	buildAbandonedTurnMessages,
	partitionUnknownToolCalls,
} from '@/hooks/chat-handler/utils/tool-filters';
import {computeToolCallSignature} from '@/hooks/chat-handler/utils/tool-signature';
import {processToolUse} from '@/message-handler';
import {color, write, writeError, writeLine, writeStatus} from '@/plain/writer';
import {parseToolCalls} from '@/tool-calling/index';
import {resolveToolApproval} from '@/tools/approval-policy';
import type {ToolManager} from '@/tools/tool-manager';
import type {TuneConfig} from '@/types/config';
import type {
	DevelopmentMode,
	LLMClient,
	Message,
	ModeOverrides,
	ToolCall,
	ToolResult,
} from '@/types/core';
import {maybeAutoCompact} from '@/utils/auto-compact';
import {capMessagesForModel} from '@/utils/message-capping';

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

export type PlainConversationOutcome =
	| {
			kind: 'success';
			finalText: string;
			reasoning: string | null;
			toolCalls: ToolCallLog[];
			usage?: PlainConversationUsage;
	  }
	| {
			kind: 'tool-approval-required';
			toolNames: string[];
			finalText: string;
			reasoning: string | null;
			toolCalls: ToolCallLog[];
			usage?: PlainConversationUsage;
	  }
	| {
			kind: 'error';
			message: string;
			finalText: string;
			reasoning: string | null;
			toolCalls: ToolCallLog[];
			usage?: PlainConversationUsage;
	  };

// On the last allowed turn we strip tools and inject this so the model
// finalizes cleanly instead of the loop bailing out with a hard error and
// discarding the work it has already done.
const FINAL_TURN_INSTRUCTION =
	'You have reached the maximum number of tool-execution turns for this run. ' +
	'Do not call any more tools. Produce your final answer now using only the ' +
	'information you already have.';

/**
 * Headless conversation loop. Streams assistant text to stdout, runs tools
 * via processToolUse, and recurses until the model produces a content-only
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

	const maxTurns =
		getAppConfig().headless?.maxTurns ?? DEFAULT_HEADLESS_MAX_TURNS;

	// Agent-loop retry limits (`nanocoder.retries`): the same caps the
	// interactive loop applies. There is nobody to ask in a plain run, so
	// hitting any of them hard-stops with a clear error instead of pausing.
	const {maxRepeatedToolCalls, maxEmptyTurns, maxMalformedRetries} =
		getRetryLimits();

	// Consecutive-failure streaks. Each kind of failing turn increments its own
	// counter and resets the others; any healthy turn resets all of them.
	let emptyTurnCount = 0;
	let malformedRetryCount = 0;
	let lastToolSignature = '';
	let repeatedToolCallCount = 0;

	// Count this turn's tool-call signature against the repeated-call streak.
	// Returns the hard-stop outcome when the cap is hit, null otherwise. Called
	// for unknown-tool turns too: a model stuck re-emitting the same
	// nonexistent tool is looping just as surely as one re-running a real call.
	const trackRepeatedToolCalls = (
		turnToolCalls: ToolCall[],
	): PlainConversationOutcome | null => {
		const currentToolSignature = computeToolCallSignature(turnToolCalls);
		const currentRepeatedCount =
			currentToolSignature && currentToolSignature === lastToolSignature
				? repeatedToolCallCount + 1
				: 1;
		if (currentRepeatedCount >= maxRepeatedToolCalls) {
			// No writeError here: the caller prints every `error` outcome's
			// message once (source/plain/shell.ts), and --json reports it in the
			// report instead.
			const message = `Model repeated the same tool call ${currentRepeatedCount} times in a row without making progress — stopping to avoid a loop (nanocoder.retries.maxRepeatedToolCalls = ${maxRepeatedToolCalls}).`;
			return {
				kind: 'error',
				message,
				finalText: accumulatedFinalText,
				reasoning: accumulatedReasoning || null,
				toolCalls: toolCallsLog,
				usage: getUsage(),
			};
		}
		lastToolSignature = currentToolSignature;
		repeatedToolCallCount = currentRepeatedCount;
		emptyTurnCount = 0;
		malformedRetryCount = 0;
		return null;
	};

	for (let turn = 0; turn < maxTurns; turn++) {
		if (abortSignal.aborted) {
			return {
				kind: 'error',
				message: 'Aborted',
				finalText: accumulatedFinalText,
				reasoning: accumulatedReasoning || null,
				toolCalls: toolCallsLog,
				usage: getUsage(),
			};
		}

		// On the final turn, force a tool-free wrap-up so we end with a usable
		// answer rather than the post-loop error.
		const finalTurn = turn === maxTurns - 1;

		const availableNames = toolManager.getAvailableToolNames(
			tune,
			developmentMode,
			undefined,
			model,
		);
		const tools = finalTurn ? {} : toolManager.getFilteredTools(availableNames);

		const modeOverrides: ModeOverrides = {
			nonInteractiveMode: true,
			nonInteractiveAlwaysAllow,
		};

		let streamedReasoning = '';
		let reasoningPrinted = false;
		let contentStarted = false;

		// Streamed text lands in the accumulators as it arrives, before we know
		// whether the turn is usable. A turn rejected as malformed is discarded
		// and retried, so keep a pre-turn snapshot to roll back to. Otherwise
		// the rejected tool-call blob stays glued to the front of the finalText
		// a later successful turn returns (visible to --json consumers).
		const finalTextBeforeTurn = accumulatedFinalText;
		const reasoningBeforeTurn = accumulatedReasoning;

		const sessionConfig = getAppConfig().sessions;
		const maxMessages = sessionConfig?.maxMessages ?? 1000;
		const cappedMessages = capMessagesForModel(messages, maxMessages);

		const finalTurnNotice: Message[] = finalTurn
			? [{role: 'user', content: FINAL_TURN_INSTRUCTION}]
			: [];

		const result = await client.chat(
			[systemMessage, ...cappedMessages, ...finalTurnNotice],
			tools,
			{
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
			abortSignal,
			modeOverrides,
		);

		// The client always returns a `usage` object, but every field inside it is
		// optional — providers that report nothing leave all three undefined, and
		// OpenAI-compatible local servers commonly report input/output without a
		// total. Only count a turn as reporting usage when at least one field is a
		// real number, so the block stays absent (rather than an all-zero block
		// indistinguishable from a genuine zero) for providers with no telemetry.
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
			inputTokens !== null ||
			outputTokens !== null ||
			totalTokens !== null ||
			cacheReadTokens !== null ||
			cacheWriteTokens !== null
		) {
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
		}

		if (!isJson && (reasoningPrinted || contentStarted)) {
			writeLine();
		}

		if (!result || !result.choices || result.choices.length === 0) {
			return {
				kind: 'error',
				message: 'No response received from model',
				finalText: accumulatedFinalText,
				reasoning: accumulatedReasoning || null,
				toolCalls: toolCallsLog,
				usage: getUsage(),
			};
		}

		const message = result.choices[0].message;
		const nativeToolCalls = message.tool_calls || [];
		const fullContent = message.content || '';

		const xmlParse =
			result.toolsDisabled && !finalTurn
				? parseToolCalls(fullContent)
				: {
						success: true as const,
						toolCalls: [],
						cleanedContent: fullContent,
					};

		if (!xmlParse.success) {
			// Same self-correction loop the interactive runtime runs: feed the
			// parse error back to the model, capped so a model stuck producing
			// bad tool calls cannot drain tokens unbounded.
			if (malformedRetryCount >= maxMalformedRetries) {
				// The caller prints the `error` outcome message; see above.
				const message = `Model produced malformed tool calls ${maxMalformedRetries + 1} times in a row and cannot self-correct — stopping (nanocoder.retries.maxMalformedRetries = ${maxMalformedRetries}).`;
				return {
					kind: 'error',
					message,
					finalText: accumulatedFinalText,
					reasoning: accumulatedReasoning || null,
					toolCalls: toolCallsLog,
					usage: getUsage(),
				};
			}
			malformedRetryCount += 1;
			emptyTurnCount = 0;
			lastToolSignature = '';
			repeatedToolCallCount = 0;
			accumulatedFinalText = finalTextBeforeTurn;
			accumulatedReasoning = reasoningBeforeTurn;
			if (!isJson) {
				writeError(
					`Malformed tool call: ${xmlParse.error} — asking the model to retry (${malformedRetryCount}/${maxMalformedRetries}).`,
				);
			}
			messages = [
				...messages,
				{role: 'assistant', content: fullContent},
				{
					role: 'user',
					content: `Your previous response contained a malformed tool call. ${xmlParse.error}\n\n${xmlParse.examples}\n\nPlease try again using the correct format.`,
				},
			];
			continue;
		}

		const allToolCalls: ToolCall[] = [
			...nativeToolCalls,
			...xmlParse.toolCalls,
		];
		const cleanedContent = xmlParse.cleanedContent;

		const partition = partitionUnknownToolCalls(allToolCalls, toolManager);
		const {validToolCalls, unknownToolCalls, errorResults} = partition;
		// errorResults is paired 1:1 with unknownToolCalls, in the same order.
		for (const [index, toolCall] of unknownToolCalls.entries()) {
			toolCallsLog.push({
				name: toolCall.function.name,
				arguments: toolCall.function.arguments || {},
				result: null,
				error: errorResults[index].content,
			});
		}

		const {emittedToolCalls, resultsForAbandonedTurn} =
			buildAbandonedTurnMessages(partition);

		// Skip appending a fully-empty assistant message (no content, no tool
		// calls): providers reject them, and the empty-turn nudge below re-asks
		// without one — same rule the interactive loop applies.
		const hasAssistantPayload =
			cleanedContent.trim() || emittedToolCalls.length > 0;
		if (hasAssistantPayload) {
			messages = [
				...messages,
				{
					role: 'assistant',
					content: cleanedContent,
					tool_calls:
						emittedToolCalls.length > 0 ? emittedToolCalls : undefined,
					reasoning: streamedReasoning || undefined,
				},
			];
		}
		// Gate on the same view the next turn will send, so the threshold is not
		// measured against rows the cap already drops from the request.
		const compactGateInput = capMessagesForModel(messages, maxMessages);
		const compacted = await maybeAutoCompact(
			compactGateInput,
			systemMessage,
			client,
			result.toolsDisabled ? undefined : tools,
			{
				signal: abortSignal,
				onNotify: isJson
					? undefined
					: message => writeStatus(message.split('\n')[0] ?? message),
			},
		);
		// Only adopt the result when compaction actually ran — otherwise
		// maybeAutoCompact returns the capped view it was handed, and taking it
		// would discard history the cap only meant to hide from one request.
		if (compacted !== compactGateInput) {
			messages = compacted;
		}
		if (abortSignal.aborted) {
			return {
				kind: 'error',
				message: 'Aborted',
				finalText: accumulatedFinalText,
				reasoning: accumulatedReasoning || null,
				toolCalls: toolCallsLog,
				usage: getUsage(),
			};
		}

		if (errorResults.length > 0) {
			// Unknown-tool turns count toward the repeated-call streak, so a model
			// stuck calling a nonexistent tool trips the same cap instead of
			// draining tokens until maxTurns. The signature covers every call the
			// model emitted this turn, valid and unknown alike.
			const stopped = trackRepeatedToolCalls(allToolCalls);
			if (stopped) {
				return stopped;
			}
			messages = [...messages, ...resultsForAbandonedTurn];
			continue;
		}

		if (validToolCalls.length === 0) {
			if (!cleanedContent.trim()) {
				// Nudge through consecutive empty turns up to the cap, mirroring
				// the interactive loop, then stop so a silent model cannot spin.
				if (emptyTurnCount >= maxEmptyTurns) {
					const attempts = maxEmptyTurns + 1;
					// The caller prints the `error` outcome message; see above.
					const message = `Model produced no output after ${attempts} attempt${attempts === 1 ? '' : 's'} — stopping (nanocoder.retries.maxEmptyTurns = ${maxEmptyTurns}).`;
					return {
						kind: 'error',
						message,
						finalText: accumulatedFinalText,
						reasoning: accumulatedReasoning || null,
						toolCalls: toolCallsLog,
						usage: getUsage(),
					};
				}
				emptyTurnCount += 1;
				malformedRetryCount = 0;
				lastToolSignature = '';
				repeatedToolCallCount = 0;
				if (!isJson) {
					// Count attempts, not nudges, so the denominator matches the
					// "no output after N attempts" stop message below.
					writeStatus(
						`empty response — retry ${emptyTurnCount}/${maxEmptyTurns + 1}`,
					);
				}
				messages = [
					...messages,
					{role: 'user', content: 'Please continue with the task.'},
				];
				continue;
			}
			// Only nudge when the walkthrough will actually outlive the run.
			// `nanocoder --plain` deletes its ephemeral artifact directory on
			// exit and reports nothing about the walkthrough, so forcing one
			// there buys an extra model round trip for a file nobody ever reads.
			const walkthroughFallback =
				finalTurn || !enforceWalkthrough
					? null
					: takeWalkthroughFallback(
							walkthroughLifecycle,
							availableNames.includes('write_walkthrough'),
						);
			if (walkthroughFallback) {
				finalTextBeforeWalkthroughNudge ??= accumulatedFinalText;
				messages = [...messages, walkthroughFallback];
				continue;
			}
			return {
				kind: 'success',
				finalText: finalTextBeforeWalkthroughNudge ?? accumulatedFinalText,
				reasoning: accumulatedReasoning || null,
				toolCalls: toolCallsLog,
				usage: getUsage(),
			};
		}

		// Loop detection: a model re-issuing the identical tool call(s) on
		// consecutive turns is almost certainly stuck. In the interactive
		// runtime this pauses and asks; here it hard-stops before executing
		// the repeat that hits the cap.
		//
		// Keyed on allToolCalls, matching the unknown-tool branch above and the
		// interactive loop. Keying this site on validToolCalls instead would
		// break the streak whenever a turn mixed a valid call with an unknown
		// one, since the two sites would compute different signatures for what
		// is really the same repetition.
		const stopped = trackRepeatedToolCalls(allToolCalls);
		if (stopped) {
			return stopped;
		}

		const toolsNeedingApproval: string[] = [];
		const toolsToExecute: ToolCall[] = [];
		for (const toolCall of validToolCalls) {
			// Approval (including the yolo bypass) is resolved centrally.
			const needsApproval = await evaluateNeedsApproval(
				toolCall,
				toolManager,
				nonInteractiveAlwaysAllow,
				developmentMode,
			);
			if (needsApproval) {
				toolsNeedingApproval.push(toolCall.function.name);
			} else {
				toolsToExecute.push(toolCall);
			}
		}

		if (toolsNeedingApproval.length > 0) {
			return {
				kind: TOOL_APPROVAL_REQUIRED_KIND,
				toolNames: toolsNeedingApproval,
				finalText: accumulatedFinalText,
				reasoning: accumulatedReasoning || null,
				toolCalls: toolCallsLog,
				usage: getUsage(),
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
			let resultStr: string | null = null;
			let errorStr: string | null = null;
			if (toolResult.isError) {
				errorStr = contentStr;
			} else {
				resultStr = contentStr;
			}

			toolCallsLog.push({
				name: toolCall.function.name,
				arguments: toolCall.function.arguments || {},
				result: resultStr,
				error: errorStr,
			});
		}
		messages = [...messages, ...toolResults];
	}

	// Defensive fallback: the final turn forces a tool-free answer above, so the
	// loop normally returns from inside. Reaching here means even that produced
	// no usable result.
	return {
		kind: 'error',
		message: `Conversation exceeded ${maxTurns} turns without a final answer`,
		finalText: accumulatedFinalText,
		reasoning: accumulatedReasoning || null,
		toolCalls: toolCallsLog,
		usage: getUsage(),
	};
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
