import type {
	AssistantContent,
	ImagePart,
	ModelMessage,
	TextPart,
	ToolCallPart,
	UserContent,
} from 'ai';
import type {Message} from '@/types/index';
import type {TestableMessage} from '../types.js';

/**
 * Checks if an assistant message is empty (no content and no tool calls).
 * Empty assistant messages cause API errors:
 * "400 Bad Request: Assistant message must have either content or tool_calls, but not none."
 *
 * Exported for testing purposes.
 */
export function isEmptyAssistantMessage(message: TestableMessage): boolean {
	if (message.role !== 'assistant') {
		return false;
	}
	// Check for content - handle both string and array content formats
	const hasContent = Array.isArray(message.content)
		? message.content.length > 0
		: typeof message.content === 'string' && message.content.trim().length > 0;
	// Tool calls are in a separate property for AI SDK messages
	const hasToolCalls =
		'toolCalls' in message &&
		Array.isArray(message.toolCalls) &&
		message.toolCalls.length > 0;
	return !hasContent && !hasToolCalls;
}

/**
 * Drop tool-result messages whose tool_call_id matches no tool_call in a
 * preceding assistant message. Orphaned tool results arise when history
 * compaction summarises an assistant(tool_calls) turn but keeps its tool
 * results verbatim; OpenAI-compatible providers reject the dangling result
 * (or return an empty completion). This is a defensive net for any path that
 * can orphan a result — the primary fix lives in the compaction slicer.
 *
 * Exported for testing.
 */
export function dropOrphanedToolResults(messages: Message[]): Message[] {
	const seenToolCallIds = new Set<string>();
	const result: Message[] = [];
	for (const msg of messages) {
		if (msg.role === 'tool') {
			if (msg.tool_call_id && seenToolCallIds.has(msg.tool_call_id)) {
				result.push(msg);
			}
			// else: orphaned tool result with no matching prior tool_call — drop.
			continue;
		}
		if (msg.role === 'assistant' && msg.tool_calls) {
			for (const toolCall of msg.tool_calls) {
				if (toolCall.id) seenToolCallIds.add(toolCall.id);
			}
		}
		result.push(msg);
	}
	return result;
}

/**
 * Convert our Message format to AI SDK v6 ModelMessage format
 *
 * Tool messages: Converted to AI SDK tool-result format with proper structure.
 * Orphaned tool results are dropped first (see dropOrphanedToolResults).
 */
export function convertToModelMessages(messages: Message[]): ModelMessage[] {
	return dropOrphanedToolResults(messages).map((msg): ModelMessage => {
		if (msg.role === 'tool') {
			// Convert to AI SDK tool-result format
			// AI SDK expects: { role: 'tool', content: [{ type: 'tool-result', toolCallId, toolName, output }] }
			// where output is { type: 'text', value: string } or { type: 'json', value: JSONValue }.
			// Structured tool results travel as JSON so the model can reason over
			// the typed shape; everything else falls back to the text content.
			const output =
				msg.structuredContent !== undefined
					? ({type: 'json', value: msg.structuredContent} as const)
					: ({type: 'text', value: msg.content} as const);
			return {
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: msg.tool_call_id || '',
						toolName: msg.name || '',
						output,
					},
				],
			};
		}

		if (msg.role === 'system') {
			return {
				role: 'system',
				content: msg.content,
			};
		}

		if (msg.role === 'user') {
			// Multimodal turn: emit the text alongside one image part per
			// attachment. Image bytes travel as a data URL, which the Anthropic,
			// Google, and OpenAI-compatible providers all accept.
			if (msg.images && msg.images.length > 0) {
				const content: UserContent = [];
				if (msg.content) {
					content.push({type: 'text', text: msg.content} as TextPart);
				}
				for (const image of msg.images) {
					content.push({
						type: 'image',
						image: `data:${image.mediaType};base64,${image.data}`,
						mediaType: image.mediaType,
					} as ImagePart);
				}
				return {
					role: 'user',
					content,
				};
			}

			return {
				role: 'user',
				content: msg.content,
			};
		}

		if (msg.role === 'assistant') {
			// Build content array
			const content: AssistantContent = [];

			// Add text content if present
			if (msg.content) {
				content.push({
					type: 'text',
					text: msg.content,
				} as TextPart);
			}

			// Add tool calls if present (for auto-executed messages)
			if (msg.tool_calls && msg.tool_calls.length > 0) {
				for (const toolCall of msg.tool_calls) {
					content.push({
						type: 'tool-call',
						toolCallId: toolCall.id,
						toolName: toolCall.function.name,
						input: toolCall.function.arguments,
					} as ToolCallPart);
				}
			}

			// If no content at all, add empty text to avoid empty message
			if (content.length === 0) {
				content.push({
					type: 'text',
					text: '',
				} as TextPart);
			}

			return {
				role: 'assistant',
				content,
			};
		}

		// Fallback - should never happen
		return {
			role: 'user',
			content: msg.content,
		};
	});
}
