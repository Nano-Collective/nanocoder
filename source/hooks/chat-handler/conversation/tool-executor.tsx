import type React from 'react';
import type {ConversationStateManager} from '@/app/utils/conversation-state';
import {ErrorMessage} from '@/components/message-box';
import type {ToolManager} from '@/tools/tool-manager';
import type {ToolCall, ToolResult} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {parseToolArguments} from '@/utils/tool-args-parser';
import {
	ALWAYS_EXPANDED_TOOLS,
	displayToolResult,
	LIVE_TASK_TOOLS,
} from '@/utils/tool-result-display';

/**
 * Validates and executes a single tool call.
 * Returns the tool call paired with its result for sequential post-processing.
 */
const executeOne = async (
	toolCall: ToolCall,
	toolManager: ToolManager | null,
	processToolUse: (toolCall: ToolCall) => Promise<ToolResult>,
): Promise<{
	toolCall: ToolCall;
	result: ToolResult;
	validationError?: string;
}> => {
	try {
		// Run validator if available
		const validator = toolManager?.getToolValidator(toolCall.function.name);
		if (validator) {
			const parsedArgs = parseToolArguments(toolCall.function.arguments);
			const validationResult = await validator(parsedArgs);
			if (!validationResult.valid) {
				return {
					toolCall,
					result: {
						tool_call_id: toolCall.id,
						role: 'tool' as const,
						name: toolCall.function.name,
						content: `Validation failed: ${formatError(validationResult.error)}`,
					},
					validationError: validationResult.error,
				};
			}
		}

		const result = await processToolUse(toolCall);
		return {toolCall, result};
	} catch (error) {
		return {
			toolCall,
			result: {
				tool_call_id: toolCall.id,
				role: 'tool' as const,
				name: toolCall.function.name,
				content: `Error: ${formatError(error)}`,
			},
		};
	}
};

/**
 * Groups consecutive read-only tools for parallel execution.
 * Non-read-only tools form single-item groups to preserve ordering.
 *
 * Example: [read, read, write, read, read] → [[read, read], [write], [read, read]]
 */
const groupByReadOnly = (
	tools: ToolCall[],
	toolManager: ToolManager | null,
): ToolCall[][] => {
	const groups: ToolCall[][] = [];
	let currentGroup: ToolCall[] = [];
	let currentIsReadOnly: boolean | null = null;

	for (const toolCall of tools) {
		const isReadOnly = toolManager?.isReadOnly(toolCall.function.name) ?? false;

		if (isReadOnly && currentIsReadOnly === true) {
			// Continue the current read-only group
			currentGroup.push(toolCall);
		} else {
			// Start a new group
			if (currentGroup.length > 0) {
				groups.push(currentGroup);
			}
			currentGroup = [toolCall];
			currentIsReadOnly = isReadOnly;
		}
	}

	if (currentGroup.length > 0) {
		groups.push(currentGroup);
	}

	return groups;
};

/**
 * Executes tools directly without confirmation.
 * Read-only tools in consecutive groups are executed in parallel.
 * Non-read-only tools are executed sequentially to preserve ordering.
 * Results are displayed in the original input order.
 *
 * @returns Array of tool results from executed tools
 */
export const executeToolsDirectly = async (
	toolsToExecuteDirectly: ToolCall[],
	toolManager: ToolManager | null,
	conversationStateManager: React.MutableRefObject<ConversationStateManager>,
	addToChatQueue: (component: React.ReactNode) => void,
	getNextComponentKey: () => number,
	options?: {
		compactDisplay?: boolean;
		onCompactToolCount?: (toolName: string) => void;
		onLiveTaskUpdate?: () => void;
	},
): Promise<ToolResult[]> => {
	// Import processToolUse here to avoid circular dependencies
	const {processToolUse} = await import('@/message-handler');

	// Group consecutive read-only tools for parallel execution
	const groups = groupByReadOnly(toolsToExecuteDirectly, toolManager);

	const directResults: ToolResult[] = [];

	for (const group of groups) {
		const isReadOnlyGroup =
			toolManager?.isReadOnly(group[0].function.name) ?? false;

		let executions: Array<{
			toolCall: ToolCall;
			result: ToolResult;
			validationError?: string;
		}>;

		if (isReadOnlyGroup && group.length > 1) {
			// Parallel execution for consecutive read-only tools
			executions = await Promise.all(
				group.map(toolCall =>
					executeOne(toolCall, toolManager, processToolUse),
				),
			);
		} else {
			// Sequential execution for non-read-only tools (or single-item groups)
			executions = [];
			for (const toolCall of group) {
				executions.push(
					await executeOne(toolCall, toolManager, processToolUse),
				);
			}
		}

		// Display results in order
		for (const {toolCall, result, validationError} of executions) {
			directResults.push(result);

			// Update conversation state
			conversationStateManager.current.updateAfterToolExecution(
				toolCall,
				result.content,
			);

			if (validationError) {
				// Display validation error (always shown in full)
				addToChatQueue(
					<ErrorMessage
						key={`validation-error-${toolCall.id}-${Date.now()}`}
						message={validationError}
						hideBox={true}
					/>,
				);
			} else if (
				LIVE_TASK_TOOLS.has(result.name) &&
				!result.content.startsWith('Error: ')
			) {
				// Task tools render in the live area (updating in-place)
				options?.onLiveTaskUpdate?.();
			} else if (
				options?.compactDisplay &&
				!ALWAYS_EXPANDED_TOOLS.has(result.name)
			) {
				// In compact mode, signal the count callback for live display
				// (skip for tools that should always show expanded output)
				const isError = result.content.startsWith('Error: ');
				if (isError) {
					// Errors always shown in full
					await displayToolResult(
						toolCall,
						result,
						toolManager,
						addToChatQueue,
						getNextComponentKey,
					);
				} else {
					options.onCompactToolCount?.(result.name);
				}
			} else {
				// Full display mode
				await displayToolResult(
					toolCall,
					result,
					toolManager,
					addToChatQueue,
					getNextComponentKey,
				);
			}
		}
	}

	return directResults;
};
