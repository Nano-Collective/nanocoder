import {
	DEFAULT_HEADLESS_MAX_TURNS,
	getAppConfig,
	getRetryLimits,
} from '@/config/index';
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
}

export interface PlainConversationUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
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
	const {
		client,
		toolManager,
		systemMessage,
		initialMessages,
		developmentMode,
		nonInteractiveAlwaysAllow,
		abortSignal,
		tune,
		model,
		outputFormat = 'text',
	} = options;

	const isJson = outputFormat === 'json';

	let messages = initialMessages;
	let accumulatedFinalText = '';
	let accumulatedReasoning = '';
	const toolCallsLog: ToolCallLog[] = [];

	let hasReportedUsage = false;
	let accumulatedInputTokens = 0;
	let accumulatedOutputTokens = 0;
	let accumulatedTotalTokens = 0;

	const getUsage = (): PlainConversationUsage | undefined => {
		if (!hasReportedUsage) return undefined;
		return {
			inputTokens: accumulatedInputTokens,
			outputTokens: accumulatedOutputTokens,
			totalTokens: accumulatedTotalTokens,
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
			const message = `Model repeated the same tool call ${currentRepeatedCount} times in a row without making progress — stopping to avoid a loop (nanocoder.retries.maxRepeatedToolCalls = ${maxRepeatedToolCalls}).`;
			if (!isJson) {
				writeError(message);
			}
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

		if (inputTokens !== null || outputTokens !== null || totalTokens !== null) {
			hasReportedUsage = true;
			accumulatedInputTokens += inputTokens ?? 0;
			accumulatedOutputTokens += outputTokens ?? 0;
			// Fall back to input+output so a missing total never reads as zero spend.
			accumulatedTotalTokens +=
				totalTokens ?? (inputTokens ?? 0) + (outputTokens ?? 0);
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
				const message = `Model produced malformed tool calls ${maxMalformedRetries + 1} times in a row and cannot self-correct — stopping (nanocoder.retries.maxMalformedRetries = ${maxMalformedRetries}).`;
				if (!isJson) {
					writeError(message);
				}
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

		const validToolCalls: ToolCall[] = [];
		const unknownToolCalls: ToolCall[] = [];
		const errorResults: ToolResult[] = [];
		for (const toolCall of allToolCalls) {
			if (
				toolCall.function.name === '__xml_validation_error__' ||
				!toolManager.hasTool(toolCall.function.name)
			) {
				const errorMsg = `Unknown tool: ${toolCall.function.name}`;
				unknownToolCalls.push(toolCall);
				errorResults.push({
					tool_call_id: toolCall.id,
					role: 'tool',
					name: toolCall.function.name,
					content: errorMsg,
					isError: true,
				});
				toolCallsLog.push({
					name: toolCall.function.name,
					arguments: toolCall.function.arguments || {},
					result: null,
					error: errorMsg,
				});
				continue;
			}
			validToolCalls.push(toolCall);
		}

		// The assistant message carries every call the model emitted, unknown
		// tools included. Their error results only reach the model if a matching
		// tool_call sits in history (`dropOrphanedToolResults` strips any result
		// with no preceding call), and without that feedback the model re-emits
		// the same ghost call until the repeated-call cap stops the run.
		const emittedToolCalls = [...validToolCalls, ...unknownToolCalls];

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

		if (errorResults.length > 0) {
			// Unknown-tool turns count toward the repeated-call streak, so a model
			// stuck calling a nonexistent tool trips the same cap instead of
			// draining tokens until maxTurns. The signature covers every call the
			// model emitted this turn, valid and unknown alike.
			const stopped = trackRepeatedToolCalls(allToolCalls);
			if (stopped) {
				return stopped;
			}
			// The turn is abandoned for self-correction, so the valid calls never
			// execute. Pair each with a cancellation result so every tool_call in
			// the assistant message above still has a matching result.
			const abortedResults: ToolResult[] = validToolCalls.map(toolCall => ({
				tool_call_id: toolCall.id,
				role: 'tool',
				name: toolCall.function.name,
				content:
					'Execution aborted because another tool call in this request was invalid. Please fix the invalid tool call and try again.',
			}));
			messages = [...messages, ...errorResults, ...abortedResults];
			continue;
		}

		if (validToolCalls.length === 0) {
			if (!cleanedContent.trim()) {
				// Nudge through consecutive empty turns up to the cap, mirroring
				// the interactive loop, then stop so a silent model cannot spin.
				if (emptyTurnCount >= maxEmptyTurns) {
					const message = `Model produced no output after ${maxEmptyTurns + 1} attempts — stopping (nanocoder.retries.maxEmptyTurns = ${maxEmptyTurns}).`;
					if (!isJson) {
						writeError(message);
					}
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
					writeStatus(
						`empty response — retry ${emptyTurnCount}/${maxEmptyTurns}`,
					);
				}
				messages = [
					...messages,
					{role: 'user', content: 'Please continue with the task.'},
				];
				continue;
			}
			return {
				kind: 'success',
				finalText: accumulatedFinalText,
				reasoning: accumulatedReasoning || null,
				toolCalls: toolCallsLog,
				usage: getUsage(),
			};
		}

		// Loop detection: a model re-issuing the identical tool call(s) on
		// consecutive turns is almost certainly stuck. In the interactive
		// runtime this pauses and asks; here it hard-stops before executing
		// the repeat that hits the cap.
		const stopped = trackRepeatedToolCalls(validToolCalls);
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
				kind: 'tool-approval-required',
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

			const toolResult = await processToolUse(toolCall);
			toolResults.push(toolResult);

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
