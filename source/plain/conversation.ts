import {processToolUse} from '@/message-handler';
import {color, write, writeError, writeLine, writeStatus} from '@/plain/writer';
import {parseToolCalls} from '@/tool-calling/index';
import {resolveToolApproval} from '@/tools/approval-policy';
import type {ToolManager} from '@/tools/tool-manager';
import type {
	DevelopmentMode,
	LLMClient,
	Message,
	ModeOverrides,
	ToolCall,
	ToolResult,
} from '@/types/core';

export interface RunPlainConversationOptions {
	client: LLMClient;
	toolManager: ToolManager;
	systemMessage: Message;
	initialMessages: Message[];
	developmentMode: DevelopmentMode;
	nonInteractiveAlwaysAllow: string[];
	abortSignal: AbortSignal;
}

export type PlainConversationOutcome =
	| {kind: 'success'}
	| {kind: 'tool-approval-required'; toolNames: string[]}
	| {kind: 'error'; message: string};

const MAX_TURNS = 50;

/**
 * Headless conversation loop. Streams assistant text to stdout, runs tools
 * via processToolUse, and recurses until the model produces a content-only
 * response or hits a tool that needs human approval (which exits early in
 * plain mode — there's no interactive prompt).
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
	} = options;

	let messages = initialMessages;

	for (let turn = 0; turn < MAX_TURNS; turn++) {
		if (abortSignal.aborted) {
			return {kind: 'error', message: 'Aborted'};
		}

		const availableNames = toolManager.getAvailableToolNames(
			undefined,
			developmentMode,
		);
		const tools = toolManager.getFilteredTools(availableNames);

		const modeOverrides: ModeOverrides = {
			nonInteractiveMode: true,
			nonInteractiveAlwaysAllow,
		};

		let streamedReasoning = '';
		let reasoningPrinted = false;
		let contentStarted = false;

		const result = await client.chat(
			[systemMessage, ...messages],
			tools,
			{
				onReasoningToken: (token: string) => {
					streamedReasoning += token;
					if (!reasoningPrinted) {
						reasoningPrinted = true;
						write(color('gray', '> '));
					}
					write(color('gray', token));
				},
				onToken: (token: string) => {
					if (reasoningPrinted && !contentStarted) {
						writeLine();
					}
					if (!contentStarted) {
						contentStarted = true;
					}
					write(token);
				},
			},
			abortSignal,
			modeOverrides,
		);

		if (reasoningPrinted || contentStarted) {
			writeLine();
		}

		if (!result || !result.choices || result.choices.length === 0) {
			return {kind: 'error', message: 'No response received from model'};
		}

		const message = result.choices[0].message;
		const nativeToolCalls = message.tool_calls || [];
		const fullContent = message.content || '';

		const xmlParse = result.toolsDisabled
			? parseToolCalls(fullContent)
			: {success: true as const, toolCalls: [], cleanedContent: fullContent};

		if (!xmlParse.success) {
			writeError(`Malformed tool call: ${xmlParse.error}`);
			return {kind: 'error', message: xmlParse.error};
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
				errorResults.push({
					tool_call_id: toolCall.id,
					role: 'tool',
					name: toolCall.function.name,
					content: `Unknown tool: ${toolCall.function.name}`,
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
				};
			}
			return {kind: 'success'};
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
			};
		}

		const toolResults: ToolResult[] = [];
		for (const toolCall of toolsToExecute) {
			writeStatus(`tool: ${toolCall.function.name}`);
			const toolResult = await processToolUse(toolCall);
			toolResults.push(toolResult);
		}
		messages = [...messages, ...toolResults];
	}

	return {
		kind: 'error',
		message: `Conversation exceeded ${MAX_TURNS} turns`,
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
