import {DEFAULT_HEADLESS_MAX_TURNS, getAppConfig} from '@/config/index';
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
	arguments: Record<string, any>;
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

export type PlainConversationOutcome =
	| {
			kind: 'success';
			finalText: string;
			reasoning: string | null;
			toolCalls: ToolCallLog[];
	  }
	| {
			kind: 'tool-approval-required';
			toolNames: string[];
			finalText: string;
			reasoning: string | null;
			toolCalls: ToolCallLog[];
	  }
	| {
			kind: 'error';
			message: string;
			finalText: string;
			reasoning: string | null;
			toolCalls: ToolCallLog[];
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

	const maxTurns =
		getAppConfig().headless?.maxTurns ?? DEFAULT_HEADLESS_MAX_TURNS;

	for (let turn = 0; turn < maxTurns; turn++) {
		if (abortSignal.aborted) {
			return {
				kind: 'error',
				message: 'Aborted',
				finalText: accumulatedFinalText,
				reasoning: accumulatedReasoning || null,
				toolCalls: toolCallsLog,
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
			if (!isJson) {
				writeError(`Malformed tool call: ${xmlParse.error}`);
			}
			return {
				kind: 'error',
				message: xmlParse.error,
				finalText: accumulatedFinalText,
				reasoning: accumulatedReasoning || null,
				toolCalls: toolCallsLog,
			};
		}

		const allToolCalls: ToolCall[] = [
			...nativeToolCalls,
			...xmlParse.toolCalls,
		];
		const cleanedContent = xmlParse.cleanedContent;

		const validToolCalls: ToolCall[] = [];
		const errorResults: ToolResult[] = [];
		for (const toolCall of allToolCalls) {
			if (
				toolCall.function.name === '__xml_validation_error__' ||
				!toolManager.hasTool(toolCall.function.name)
			) {
				const errorMsg = `Unknown tool: ${toolCall.function.name}`;
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

		messages = [
			...messages,
			{
				role: 'assistant',
				content: cleanedContent,
				tool_calls: validToolCalls.length > 0 ? validToolCalls : undefined,
				reasoning: streamedReasoning || undefined,
			},
		];

		if (errorResults.length > 0) {
			messages = [...messages, ...errorResults];
			continue;
		}

		if (validToolCalls.length === 0) {
			if (!cleanedContent.trim()) {
				return {
					kind: 'error',
					message: 'Model returned an empty response with no tool calls',
					finalText: accumulatedFinalText,
					reasoning: accumulatedReasoning || null,
					toolCalls: toolCallsLog,
				};
			}
			return {
				kind: 'success',
				finalText: accumulatedFinalText,
				reasoning: accumulatedReasoning || null,
				toolCalls: toolCallsLog,
			};
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
