import type {ScrubOptions} from '@nanocollective/prompt-scrub';
import type {Message, ToolCall} from '@/types/index';
import {getLogger} from '@/utils/logging';
import {truncateToolResult} from '@/utils/truncate-tool-result';

/**
 * Paths and URLs are deliberately left in the clear. The agent has to act on
 * the files and endpoints a prompt names, and a placeholder there breaks the
 * next tool call — the same tradeoff the scrubber has always made.
 */
const SCRUB_OPTIONS: ScrubOptions = {
	disabledDetectors: ['PathDetector', 'UrlDetector'],
};

type SessionMap = Record<string, string>;
type StringTransform = (value: string) => string;

/**
 * Apply `transform` to every string leaf of a JSON value, leaving the
 * structure — and object keys, which are schema field names rather than
 * user data — untouched. Working over leaves rather than the serialised
 * JSON keeps a replacement from spanning a quote boundary and corrupting
 * the document.
 */
function mapStringLeaves<T>(value: T, transform: StringTransform): T {
	if (typeof value === 'string') {
		return transform(value) as T;
	}
	if (Array.isArray(value)) {
		return value.map(item => mapStringLeaves(item, transform)) as T;
	}
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, item]) => [
				key,
				mapStringLeaves(item, transform),
			]),
		) as T;
	}
	return value;
}

function scrubMessage(message: Message, scrubText: StringTransform): Message {
	if (message.role === 'tool') {
		// Truncate before scrubbing. The converter caps tool output at
		// MAX_TOOL_RESULT_CHARS anyway; scrubbing first would let that cut land
		// mid-placeholder, and would run every detector over text the provider
		// never sees.
		return {
			...message,
			content: scrubText(truncateToolResult(message.content)),
			...(message.structuredContent === undefined
				? {}
				: {
						structuredContent: mapStringLeaves(
							message.structuredContent,
							scrubText,
						),
					}),
		};
	}

	const scrubbed: Message = {...message, content: scrubText(message.content)};

	// Assistant tool_calls are replayed verbatim on every later turn, and their
	// arguments were rehydrated to real values before they entered history — so
	// a secret the model echoed back out of a tool result leaks here unless it
	// is scrubbed again on the way out.
	if (scrubbed.tool_calls && scrubbed.tool_calls.length > 0) {
		scrubbed.tool_calls = scrubbed.tool_calls.map(toolCall => ({
			...toolCall,
			function: {
				...toolCall.function,
				arguments: mapStringLeaves(toolCall.function.arguments, scrubText),
			},
		}));
	}
	return scrubbed;
}

/**
 * Replace sensitive identifiers with placeholders across everything bound for
 * the provider: the system prompt, message content (user, assistant and tool),
 * structured tool output, and assistant tool-call arguments.
 *
 * `sessionMap` is mutated in place by the scrubber as new placeholders are
 * minted; the caller's messages are not — each scrubbed message is a copy, so
 * committed history keeps the real values.
 */
export async function scrubOutgoing(
	systemContent: string,
	messages: Message[],
	sessionMap: SessionMap,
): Promise<{
	systemContent: string;
	messages: Message[];
	newPlaceholders: number;
}> {
	const {scrub} = await import('@nanocollective/prompt-scrub');
	const before = Object.keys(sessionMap).length;

	const scrubText: StringTransform = content =>
		content
			? (scrub({content, sessionMap, options: SCRUB_OPTIONS})
					.scrubbedContent as string)
			: content;

	return {
		systemContent: scrubText(systemContent),
		messages: messages.map(message => scrubMessage(message, scrubText)),
		newPlaceholders: Object.keys(sessionMap).length - before,
	};
}

/**
 * Restore original values in the model's reply before it is committed to
 * history, so the placeholders never surface in the UI or in a tool call the
 * harness is about to execute.
 */
export async function rehydrateResponse(
	response: {content: string; reasoning?: string; toolCalls: ToolCall[]},
	sessionMap: SessionMap,
): Promise<{content: string; reasoning?: string; toolCalls: ToolCall[]}> {
	const {rehydrate} = await import('@nanocollective/prompt-scrub');
	const logger = getLogger();

	const restore = (content: string, section: string): string => {
		if (!content) return content;
		const result = rehydrate({content, sessionMap});
		if (result.warnings && result.warnings.length > 0) {
			logger.warn('Prompt-scrub rehydration warnings', {
				section,
				warnings: result.warnings,
			});
		}
		return result.content as string;
	};

	return {
		content: restore(response.content, 'content'),
		reasoning: response.reasoning
			? restore(response.reasoning, 'reasoning')
			: response.reasoning,
		toolCalls: response.toolCalls.map(toolCall => ({
			...toolCall,
			function: {
				...toolCall.function,
				arguments: mapStringLeaves(toolCall.function.arguments, value =>
					restore(value, `tool args (${toolCall.function.name})`),
				),
			},
		})),
	};
}
