import type {ToolManager} from '@/tools/tool-manager';
import type {ToolCall, ToolResult} from '@/types/core';

/**
 * Filters out invalid tool calls.
 * Returns valid tool calls and error results for invalid ones.
 *
 * Handles:
 * - Empty tool calls (missing id or function name)
 * - Tools that don't exist in the tool manager
 *
 * `unknownToolCalls` holds the calls that produced `errorResults`, paired 1:1
 * and in the same order. Callers must put them in the assistant message's
 * tool_calls: a tool result whose call is absent from history is orphaned and
 * dropped before it reaches the model, so the self-correction hint would never
 * arrive and the model would just repeat the nonexistent call.
 */
export type PartitionedToolCalls = {
	validToolCalls: ToolCall[];
	unknownToolCalls: ToolCall[];
	errorResults: ToolResult[];
};

export const filterValidToolCalls = (
	toolCalls: ToolCall[],
	toolManager: ToolManager | null,
): PartitionedToolCalls => {
	const validToolCalls: ToolCall[] = [];
	const unknownToolCalls: ToolCall[] = [];
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
			unknownToolCalls.push(toolCall);
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

	return {validToolCalls, unknownToolCalls, errorResults};
};

/** Marker name the XML tool-call parser emits for a call it could not validate. */
const XML_VALIDATION_ERROR_TOOL = '__xml_validation_error__';

/**
 * Same partition as `filterValidToolCalls`, with the compact
 * `Unknown tool: <name>` feedback the non-interactive loops send instead of
 * the interactive loop's longer recovery hint.
 */
export const partitionUnknownToolCalls = (
	toolCalls: ToolCall[],
	toolManager: ToolManager,
): PartitionedToolCalls => {
	const validToolCalls: ToolCall[] = [];
	const unknownToolCalls: ToolCall[] = [];
	const errorResults: ToolResult[] = [];

	for (const toolCall of toolCalls) {
		if (
			toolCall.function.name === XML_VALIDATION_ERROR_TOOL ||
			!toolManager.hasTool(toolCall.function.name)
		) {
			unknownToolCalls.push(toolCall);
			errorResults.push({
				tool_call_id: toolCall.id,
				role: 'tool' as const,
				name: toolCall.function.name,
				content: `Unknown tool: ${toolCall.function.name}`,
				isError: true,
			});
			continue;
		}
		validToolCalls.push(toolCall);
	}

	return {validToolCalls, unknownToolCalls, errorResults};
};

/**
 * Builds the message payload for a turn that carried an unknown tool call.
 *
 * Two pairing rules keep the provider's 1:1 tool-call/result mapping intact,
 * and both are easy to break independently:
 *
 * - Unknown calls stay in the assistant message. A tool result whose call is
 *   missing from history is orphaned and dropped by `dropOrphanedToolResults`
 *   before the request goes out, so the self-correction hint would never reach
 *   the model and it would keep re-emitting the same ghost call.
 * - The turn is abandoned for self-correction, so its valid calls never run.
 *   Each gets a cancellation result so no emitted call is left unmatched.
 *
 * `resultsForAbandonedTurn` is empty when nothing was unknown — that turn
 * executes normally and produces its own results.
 */
export const buildAbandonedTurnMessages = (
	partition: PartitionedToolCalls,
): {emittedToolCalls: ToolCall[]; resultsForAbandonedTurn: ToolResult[]} => {
	const {validToolCalls, unknownToolCalls, errorResults} = partition;
	const emittedToolCalls = [...validToolCalls, ...unknownToolCalls];

	if (errorResults.length === 0) {
		return {emittedToolCalls, resultsForAbandonedTurn: []};
	}

	return {
		emittedToolCalls,
		resultsForAbandonedTurn: [
			...errorResults,
			...validToolCalls.map(toolCall => ({
				tool_call_id: toolCall.id,
				role: 'tool' as const,
				name: toolCall.function.name,
				content:
					'Execution aborted because another tool call in this request was invalid. Please fix the invalid tool call and try again.',
			})),
		],
	};
};
