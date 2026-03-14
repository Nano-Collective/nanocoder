import type {ModelMessage} from 'ai';
import type {StreamCallbacks} from '@/types/index';
import {getLogger} from '@/utils/logging';
import {isEmptyAssistantMessage} from '../converters/message-converter.js';
import type {TestableMessage} from '../types.js';

/**
 * Creates the onStepFinish callback for AI SDK generateText
 * Since tools have no execute functions, this only handles logging.
 */
export function createOnStepFinishHandler(
	_callbacks: StreamCallbacks,
): (step: {
	toolCalls?: Array<{toolCallId?: string; toolName: string; input: unknown}>;
	toolResults?: Array<{output: unknown}>;
	text?: string;
}) => void {
	const logger = getLogger();

	return step => {
		// Log tool call steps (no results since execute is stripped)
		if (step.toolCalls && step.toolCalls.length > 0) {
			logger.trace('AI SDK tool step', {
				stepType: 'tool_call',
				toolCount: step.toolCalls.length,
			});
		}
	};
}

/**
 * Creates the prepareStep callback for AI SDK generateText
 * This filters out empty assistant messages and orphaned tool results
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

		// Return filtered messages if any were removed, otherwise no changes
		if (filteredMessages.length !== messages.length) {
			return {messages: filteredMessages};
		}
		return {}; // No modifications needed
	};
}
