import type {ToolCall, ToolResult} from '@/types/index';

/**
 * Create cancellation results for tool calls
 * Used when user cancels tool execution to maintain conversation state integrity
 *
 * This utility eliminates duplication of cancellation result creation logic
 *
 * @param toolCalls - Array of tool calls that were cancelled
 * @returns Array of tool results indicating cancellation
 *
 * @example
 * const cancellationResults = createCancellationResults(pendingToolCalls);
 * const toolMessages = cancellationResults.map(result => ({
 *   role: 'tool' as const,
 *   content: result.content,
 *   tool_call_id: result.tool_call_id,
 *   name: result.name,
 * }));
 */
export function createCancellationResults(toolCalls: ToolCall[]): ToolResult[] {
	return toolCalls.map(toolCall => ({
		tool_call_id: toolCall.id,
		role: 'tool' as const,
		name: toolCall.function.name,
		content: 'Tool execution was cancelled by the user.',
	}));
}
