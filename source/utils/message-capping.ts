import type {Message} from '@/types/core';

/**
 * Caps the message history sent to the model to at most `maxMessages` messages.
 * Avoids orphaning tool calls/results by snapping the slice boundary to complete turns.
 *
 * Specifically:
 * - If the boundary lands on or within a sequence of tool results, we walk the start
 *   index backwards to include the initiating `assistant` message and all its associated
 *   tool results.
 */
export function capMessagesForModel(
	messages: Message[],
	maxMessages: number,
): Message[] {
	if (messages.length <= maxMessages) {
		return messages;
	}

	let start = messages.length - maxMessages;

	// Walk back to avoid starting in the middle of a tool-call sequence.
	// If the boundary lands on a 'tool' role message, walk backward to find the
	// initiating assistant message.
	while (start > 0 && messages[start]?.role === 'tool') {
		start--;
	}

	return messages.slice(start);
}
