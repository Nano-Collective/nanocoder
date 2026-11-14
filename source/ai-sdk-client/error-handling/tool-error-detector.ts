import {extractRootError} from './error-extractor.js';

/**
 * Errors about the shape of the conversation history rather than about the
 * request carrying tools. They mention tools because the history holds tool
 * calls and results, but the model supports tools fine: retrying without them
 * would hide the real problem and drop the session onto the text fallback.
 *
 * - OpenAI: "messages with role 'tool' must be a response to a preceeding
 *   message with 'tool_calls'", "An assistant message with 'tool_calls' must
 *   be followed by tool messages responding to each 'tool_call_id'"
 * - Anthropic: "tool_use ids were found without tool_result blocks
 *   immediately after", "unexpected tool_use_id found in tool_result blocks"
 * - Errors that point at one message: "Invalid 'messages[3].tool_calls'",
 *   "messages.1.content.0.tool_result"
 * - Context overflows, which can count tool definitions in their wording.
 */
const HISTORY_ERROR_PATTERNS = [
	/role\s*['"`]?tool\b/i,
	/tool_call_id/i,
	/tool_use_id/i,
	/tool_use\b.*\btool_result|tool_result\b.*\btool_use/i,
	/must be (?:a )?(?:response|followed)/i,
	/messages\s*(?:\[\d+\]|\.\d+)/i,
	/context (?:length|window)|too many tokens|maximum context/i,
];

function messageIndicatesToolSupport(message: string): boolean {
	if (HISTORY_ERROR_PATTERNS.some(pattern => pattern.test(message))) {
		return false;
	}

	// Pattern 2: Direct mentions of tool/function not supported
	const directPatterns = [
		/tool.*not.*support/i,
		/function.*not.*support/i,
		/tool.*unsupported/i,
		/function.*unsupported/i,
		/(?:not|n't) support (?:native )?(?:tools|tool calling|function calling|functions)\b/i,
	];

	for (const pattern of directPatterns) {
		if (pattern.test(message)) {
			return true;
		}
	}

	// Pattern 3: Ollama-specific error messages
	// Ollama may return errors like: "invalid character 't' looking for beginning of value"
	// when it encounters the 'tools' field in JSON
	if (
		message.includes('invalid character') &&
		message.includes('after top-level value')
	) {
		return true;
	}

	return false;
}

/**
 * Detects if an error indicates the model doesn't support tool calling
 *
 * This is used to automatically retry requests without tools when a model
 * rejects tool definitions (common with some local models like deepseek-r1 via Ollama)
 *
 * A streamed request that the server refuses surfaces as a bare
 * AI_NoOutputGeneratedError ("No output generated"); the server's message is
 * only on the errors the stream reported, so those are checked too, along
 * with the thrown error's root cause.
 */
export function isToolSupportError(
	error: unknown,
	streamingErrors: readonly Error[] = [],
): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	const candidates = [error, extractRootError(error), ...streamingErrors];
	return candidates.some(
		candidate =>
			candidate instanceof Error &&
			messageIndicatesToolSupport(candidate.message.toLowerCase()),
	);
}
