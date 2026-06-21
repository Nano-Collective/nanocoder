import type {ToolManager} from '@/tools/tool-manager';
import type {ToolCall, ToolResult} from '@/types/core';

/**
 * Filters out invalid tool calls.
 * Returns valid tool calls and error results for invalid ones.
 *
 * Handles:
 * - Empty tool calls (missing id or function name)
 * - Tools that don't exist in the tool manager
 */
export const filterValidToolCalls = (
	toolCalls: ToolCall[],
	toolManager: ToolManager | null,
): {validToolCalls: ToolCall[]; errorResults: ToolResult[]} => {
	const validToolCalls: ToolCall[] = [];
	const errorResults: ToolResult[] = [];

	for (const toolCall of toolCalls) {
		// Filter out completely empty tool calls
		if (!toolCall.id || !toolCall.function?.name) {
			continue;
		}

		// Filter out tool calls with empty names
		if (toolCall.function.name.trim() === '') {
			continue;
		}

		// Filter out tool calls for tools that don't exist
		if (toolManager && !toolManager.hasTool(toolCall.function.name)) {
			// Listing the valid tool names gives small models a concrete recovery
			// target instead of leaving them to re-guess the same wrong name.
			const available = toolManager.getToolNames?.() ?? [];
			const availableHint =
				available.length > 0
					? ` Available tools are: ${available.join(', ')}.`
					: '';
			errorResults.push({
				tool_call_id: toolCall.id,
				role: 'tool' as const,
				name: toolCall.function.name,
				content: `The tool "${toolCall.function.name}" does not exist. Use only the tools that are available in the system.${availableHint}`,
			});
			continue;
		}

		validToolCalls.push(toolCall);
	}

	return {validToolCalls, errorResults};
};
