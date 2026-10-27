import type {ToolCall} from '@/types/index';
import {generateToolCallId} from '@/utils/tool-call-id';
import {isPlainObject} from '@/utils/type-helpers';

/**
 * Why arguments that are not a JSON object were rejected. The SDK hands back
 * the raw text when it cannot parse it, so report the parse error rather than
 * the text itself: a call cut off mid-file can be very long.
 */
function describeInvalidArguments(input: unknown): string {
	if (typeof input === 'string') {
		try {
			JSON.parse(input);
		} catch (error) {
			return `not valid JSON: ${(error as Error).message}`;
		}
	}
	return 'not a JSON object';
}

/**
 * Converts AI SDK tool call format to our ToolCall format.
 *
 * Arguments that are not a JSON object become `{}` with `argumentsError`
 * set. Passed on as they were, the SDK's raw text for an unparsable call was
 * run as the arguments and replayed to the provider double-encoded.
 */
export function convertAISDKToolCall(toolCall: {
	toolCallId?: string;
	toolName: string;
	input: unknown;
}): ToolCall {
	const id = toolCall.toolCallId || generateToolCallId();
	if (!isPlainObject(toolCall.input)) {
		return {
			id,
			function: {name: toolCall.toolName, arguments: {}},
			argumentsError: describeInvalidArguments(toolCall.input),
		};
	}
	return {
		id,
		function: {
			name: toolCall.toolName,
			arguments: toolCall.input,
		},
	};
}

/**
 * Converts multiple AI SDK tool calls to our ToolCall format
 */
export function convertAISDKToolCalls(
	toolCalls: Array<{
		toolCallId?: string;
		toolName: string;
		input: unknown;
	}>,
): ToolCall[] {
	return toolCalls.map(convertAISDKToolCall);
}

/**
 * Gets the tool result output as a string
 */
export function getToolResultOutput(output: unknown): string {
	return typeof output === 'string' ? output : JSON.stringify(output);
}
