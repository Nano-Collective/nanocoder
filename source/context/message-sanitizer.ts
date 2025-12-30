/**
 * Message sanitization utilities for ensuring valid message sequences.
 *
 * Prevents API errors like "Cannot have 2 or more assistant messages at the end of the list"
 * by combining consecutive assistant messages into a single message.
 */

import type {Message} from '@/types/core';
import {getLogger} from '@/utils/logging';

export interface SanitizationResult {
	messages: Message[];
	sanitized: boolean;
	combinedAssistantMessages: number;
	summary?: string;
}

/**
 * Combine consecutive assistant messages into a single message.
 * Preserves all tool calls and combines content from all messages.
 */
function combineConsecutiveAssistantMessages(messages: Message[]): Message[] {
	if (messages.length < 2) return messages;

	const result: Message[] = [];
	let i = 0;

	while (i < messages.length) {
		const current = messages[i];

		// Look ahead for consecutive assistant messages
		if (current.role === 'assistant') {
			const assistantSequence = [current];
			let j = i + 1;

			while (j < messages.length && messages[j].role === 'assistant') {
				assistantSequence.push(messages[j]);
				j++;
			}

			// If we found multiple consecutive assistant messages, combine them
			if (assistantSequence.length > 1) {
				const contentParts: string[] = [];

				// Include content and tool info from all messages (in order)
				for (const msg of assistantSequence) {
					if (msg.content?.trim()) {
						contentParts.push(msg.content);
					}
					// Include tool call information if present
					if (msg.tool_calls && msg.tool_calls.length > 0) {
						const toolNames = msg.tool_calls
							.map(tc => tc.function.name)
							.join(', ');
						contentParts.push(`[Tools called: ${toolNames}]`);
					}
				}

				const combinedContent = contentParts
					.filter(s => s.length > 0)
					.join('\n\n');

				// Collect all tool calls from all messages
				const allToolCalls = assistantSequence.flatMap(
					msg => msg.tool_calls || [],
				);

				const combinedMessage: Message = {
					role: 'assistant',
					content: combinedContent,
					...(allToolCalls.length > 0 && {tool_calls: allToolCalls}),
				};

				result.push(combinedMessage);
				i = j;
			} else {
				result.push(current);
				i++;
			}
		} else {
			result.push(current);
			i++;
		}
	}

	return result;
}

/**
 * Sanitize message list to ensure valid API compatibility.
 *
 * Rules enforced:
 * 1. No more than one assistant message at the end of the list
 * 2. Combines consecutive assistant messages into one
 * 3. Preserves all tool calls from combined messages
 * 4. Combines content from all messages to maintain context
 */
export function sanitizeMessageList(messages: Message[]): SanitizationResult {
	if (messages.length === 0) {
		return {
			messages,
			sanitized: false,
			combinedAssistantMessages: 0,
		};
	}

	// First, handle consecutive assistant messages anywhere in the list
	let sanitized = combineConsecutiveAssistantMessages(messages);
	const combinedCount = messages.length - sanitized.length;

	// Check if there are multiple assistant messages at the end
	let trailingAssistantCount = 0;
	for (let i = sanitized.length - 1; i >= 0; i--) {
		if (sanitized[i].role === 'assistant') {
			trailingAssistantCount++;
		} else {
			break;
		}
	}

	const wasSanitized = combinedCount > 0 || trailingAssistantCount > 1;

	if (wasSanitized) {
		getLogger().debug('Message list sanitized', {
			originalLength: messages.length,
			sanitizedLength: sanitized.length,
			combinedAssistantMessages: combinedCount,
			trailingAssistantCount,
		});
	}

	return {
		messages: sanitized,
		sanitized: wasSanitized,
		combinedAssistantMessages: combinedCount,
	};
}

/**
 * Validate that a message list meets API requirements.
 * Returns true if valid, false otherwise.
 */
export function validateMessageList(messages: Message[]): boolean {
	if (messages.length === 0) return true;

	// Check for multiple trailing assistant messages
	let trailingAssistantCount = 0;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'assistant') {
			trailingAssistantCount++;
		} else {
			break;
		}
	}

	if (trailingAssistantCount > 1) {
		return false;
	}

	// Check for valid role sequences
	for (let i = 0; i < messages.length - 1; i++) {
		const current = messages[i];
		const next = messages[i + 1];

		// Tool messages must follow assistant messages
		if (next.role === 'tool' && current.role !== 'assistant') {
			return false;
		}

		// Multiple consecutive user messages are invalid
		if (current.role === 'user' && next.role === 'user') {
			return false;
		}
	}

	return true;
}
