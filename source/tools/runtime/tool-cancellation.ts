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
	return createUnexecutedResults(
		toolCalls,
		'Tool execution was cancelled by the user.',
	);
}

/**
 * Create results for tool calls that could not be approved because the run has
 * no one to ask (non-interactive mode).
 *
 * Deliberately distinct from the cancellation wording: nobody declined these
 * tools, so a resumed interactive session must not read the saved history as a
 * user refusal and stop retrying them.
 *
 * @param toolCalls - Array of tool calls left unapproved
 * @returns Array of tool results explaining why they did not run
 */
export function createApprovalUnavailableResults(
	toolCalls: ToolCall[],
): ToolResult[] {
	return createUnexecutedResults(
		toolCalls,
		'Tool was not executed: approval unavailable in non-interactive mode.',
	);
}

function createUnexecutedResults(
	toolCalls: ToolCall[],
	content: string,
): ToolResult[] {
	return toolCalls.map(toolCall => ({
		tool_call_id: toolCall.id,
		role: 'tool' as const,
		name: toolCall.function.name,
		content,
	}));
}
