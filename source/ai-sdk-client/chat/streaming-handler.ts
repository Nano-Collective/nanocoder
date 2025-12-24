import type {ModelMessage} from 'ai';
import type {StreamCallbacks, ToolCall} from '@/types/index';
import {getLogger} from '@/utils/logging';
import {isEmptyAssistantMessage} from '../converters/message-converter.js';
import {
	convertAISDKToolCall,
	getToolResultOutput,
} from '../converters/tool-converter.js';
import type {TestableMessage} from '../types.js';

/**
 * Creates the onStepFinish callback for AI SDK generateText
 * This handles logging and displaying tool execution results
 */
export function createOnStepFinishHandler(
	callbacks: StreamCallbacks,
): (step: {
	toolCalls?: Array<{toolCallId?: string; toolName: string; input: unknown}>;
	toolResults?: Array<{output: unknown}>;
	text?: string;
}) => void {
	const logger = getLogger();

	return step => {
		// Log tool execution steps
		if (step.toolCalls && step.toolCalls.length > 0) {
			logger.trace('AI SDK tool step', {
				stepType: 'tool_execution',
				toolCount: step.toolCalls.length,
				hasResults: !!step.toolResults,
			});
		}

		// Display formatters for auto-executed tools (after execution with results)
		if (
			step.toolCalls &&
			step.toolResults &&
			step.toolCalls.length === step.toolResults.length
		) {
			step.toolCalls.forEach((toolCall, idx) => {
				const toolResult = step.toolResults?.[idx];
				if (!toolResult) return;
				const tc: ToolCall = convertAISDKToolCall(toolCall);
				const resultStr = getToolResultOutput(toolResult.output);

				logger.debug('Tool executed', {
					toolName: tc.function.name,
					resultLength: resultStr.length,
				});

				callbacks.onToolExecuted?.(tc, resultStr);
			});
		}
	};
}

/**
 * Creates the prepareStep callback for AI SDK generateText
 * This filters out empty assistant messages and orphaned tool results,
 * and enforces role alternation for strict chat templates (e.g., Mistral models)
 */
export function createPrepareStepHandler(): (params: {
	messages: ModelMessage[];
}) => {messages?: ModelMessage[]} | Record<string, never> {
	const logger = getLogger();

	return ({messages}) => {
		// Filter out empty assistant messages that would cause API errors
		// "Assistant message must have either content or tool_calls"
		// Also filter out orphaned tool messages that follow empty assistant messages
		const filteredMessages: ModelMessage[] = [];
		const indicesToSkip = new Set<number>();

		// First pass: identify empty assistant messages and their orphaned tool results
		for (let i = 0; i < messages.length; i++) {
			if (isEmptyAssistantMessage(messages[i] as unknown as TestableMessage)) {
				indicesToSkip.add(i);

				// Mark any immediately following tool messages as orphaned
				let j = i + 1;
				while (j < messages.length && messages[j].role === 'tool') {
					indicesToSkip.add(j);
					j++;
				}
			}
		}

		// Second pass: build filtered array
		for (let i = 0; i < messages.length; i++) {
			if (!indicesToSkip.has(i)) {
				filteredMessages.push(messages[i]);
			}
		}

		// Log message filtering
		if (filteredMessages.length !== messages.length) {
			logger.debug(
				'Filtered empty assistant messages and orphaned tool results',
				{
					originalCount: messages.length,
					filteredCount: filteredMessages.length,
					removedCount: messages.length - filteredMessages.length,
				},
			);
		}

		// Third pass: Merge consecutive messages of the same role
		// Some models (e.g., Mistral) require strict user/assistant alternation
		// Instead of removing messages, merge consecutive ones to preserve information
		const mergedMessages: ModelMessage[] = [];

		for (let i = 0; i < filteredMessages.length; i++) {
			const msg = filteredMessages[i];

			// System and tool messages don't need merging
			if (msg.role === 'system' || msg.role === 'tool') {
				mergedMessages.push(msg);
				continue;
			}

			// Check if we need to merge with the previous message
			const lastMsg = mergedMessages[mergedMessages.length - 1];
			if (
				lastMsg &&
				lastMsg.role === msg.role &&
				(msg.role === 'user' || msg.role === 'assistant')
			) {
				// Merge consecutive messages of the same role
				// Combine content strings with newline separator
				const lastContent =
					typeof lastMsg.content === 'string'
						? lastMsg.content
						: Array.isArray(lastMsg.content)
							? lastMsg.content.map(c => ('text' in c ? c.text : '')).join('')
							: '';

				const currentContent =
					typeof msg.content === 'string'
						? msg.content
						: Array.isArray(msg.content)
							? msg.content.map(c => ('text' in c ? c.text : '')).join('')
							: '';

				// Update the last message with merged content
				if (typeof lastMsg.content === 'string') {
					lastMsg.content = lastContent + '\n\n' + currentContent;
				}

				logger.debug('Merged consecutive messages for role alternation', {
					role: msg.role,
					messageIndex: i,
				});
			} else {
				// No merge needed, add the message
				mergedMessages.push(msg);
			}
		}

		// Log if merging was applied
		if (mergedMessages.length !== filteredMessages.length) {
			logger.debug('Merged consecutive messages for strict chat template', {
				originalCount: filteredMessages.length,
				mergedCount: mergedMessages.length,
				reducedBy: filteredMessages.length - mergedMessages.length,
			});
		}

		// Return modified messages if any changes were made
		const totalChanges =
			mergedMessages.length !== messages.length ||
			filteredMessages.length !== messages.length;

		if (totalChanges) {
			return {messages: mergedMessages};
		}
		return {}; // No modifications needed
	};
}
