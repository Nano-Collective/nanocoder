import type {ToolCall} from '@/types/index';
import {generateToolCallId} from '@/utils/tool-call-id';

/**
 * Converts AI SDK tool call format to our ToolCall format
 */
export function convertAISDKToolCall(toolCall: {
	toolCallId?: string;
	toolName: string;
	input: unknown;
}): ToolCall {
	return {
		id: toolCall.toolCallId || generateToolCallId(),
		function: {
			name: toolCall.toolName,
			arguments: toolCall.input as Record<string, unknown>,
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
