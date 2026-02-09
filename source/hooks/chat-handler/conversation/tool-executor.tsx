import type React from 'react';
import type {ConversationStateManager} from '@/app/utils/conversation-state';
import {ErrorMessage} from '@/components/message-box';
import type {ToolManager} from '@/tools/tool-manager';
import type {ToolCall, ToolResult} from '@/types/core';
import {parseToolArguments} from '@/utils/tool-args-parser';
import {displayToolResult} from '@/utils/tool-result-display';

/**
 * Executes tools directly without confirmation.
 * Handles validation, execution, and error display.
 *
 * Parallel execution: All non-confirmation tools are executed simultaneously
 * using Promise.all, which significantly improves performance when multiple
 * independent tools are called (e.g., git_status, git_log, git_diff).
 *
 * @returns Array of tool results from executed tools
 */
export const executeToolsDirectly = async (
	toolsToExecuteDirectly: ToolCall[],
	toolManager: ToolManager | null,
	conversationStateManager: React.MutableRefObject<ConversationStateManager>,
	addToChatQueue: (component: React.ReactNode) => void,
	getNextComponentKey: () => number,
): Promise<ToolResult[]> => {
	// Import processToolUse here to avoid circular dependencies
	const {processToolUse} = await import('@/message-handler');

	// Validate all tools first (parallel validation)
	const validationPromises = toolsToExecuteDirectly.map(async toolCall => {
		const validator = toolManager?.getToolValidator(toolCall.function.name);
		if (!validator) {
			return {toolCall, isValid: true, error: undefined};
		}

		const parsedArgs = parseToolArguments(toolCall.function.arguments);
		const validationResult = await validator(parsedArgs);

		if (!validationResult.valid) {
			return {
				toolCall,
				isValid: false,
				error: validationResult.error,
			};
		}

		return {toolCall, isValid: true, error: undefined};
	});

	const validationResults = await Promise.all(validationPromises);

	// Separate valid and invalid tool calls (keep error info for invalid ones)
	const validToolCalls = validationResults
		.filter(r => r.isValid)
		.map(r => r.toolCall);

	const invalidToolCalls = validationResults
		.filter(r => !r.isValid)
		.map(r => ({toolCall: r.toolCall, error: r.error}));

	// Execute all valid tool calls in parallel
	const executionPromises = validToolCalls.map(async toolCall => {
		try {
			const result = await processToolUse(toolCall);
			return {toolCall, result, error: undefined};
		} catch (error) {
			return {
				toolCall,
				result: undefined,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	const executionResults = await Promise.all(executionPromises);

	// Combine validation errors and execution results
	const directResults: ToolResult[] = [];

	// Process invalid tool calls (validation failures)
	for (const invalidCall of invalidToolCalls) {
		const errorResult: ToolResult = {
			tool_call_id: invalidCall.toolCall.id,
			role: 'tool' as const,
			name: invalidCall.toolCall.function.name,
			content: `Validation failed: ${invalidCall.error || 'Unknown error'}`,
		};
		directResults.push(errorResult);

		// Update conversation state with error
		conversationStateManager.current.updateAfterToolExecution(
			invalidCall.toolCall,
			errorResult.content,
		);

		// Display the validation error to the user
		addToChatQueue(
			<ErrorMessage
				key={`validation-error-${invalidCall.toolCall.id}-${Date.now()}`}
				message={errorResult.content}
				hideBox={true}
			/>,
		);
	}

	// Process execution results (successful and failed executions)
	for (const execResult of executionResults) {
		const {toolCall, result, error} = execResult;

		if (error) {
			// Execution failed
			const errorResult: ToolResult = {
				tool_call_id: toolCall.id,
				role: 'tool' as const,
				name: toolCall.function.name,
				content: `Error: ${error}`,
			};
			directResults.push(errorResult);

			// Update conversation state with error
			conversationStateManager.current.updateAfterToolExecution(
				toolCall,
				errorResult.content,
			);

			// Display the error result
			void displayToolResult(
				toolCall,
				errorResult,
				toolManager,
				addToChatQueue,
				getNextComponentKey,
			);
		} else if (result) {
			// Execution successful
			directResults.push(result);

			// Update conversation state with tool execution
			conversationStateManager.current.updateAfterToolExecution(
				toolCall,
				result.content,
			);

			// Display the tool result immediately
			void displayToolResult(
				toolCall,
				result,
				toolManager,
				addToChatQueue,
				getNextComponentKey,
			);
		}
	}

	return directResults;
};
