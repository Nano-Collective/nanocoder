import type React from 'react';
import type {ConversationStateManager} from '@/app/utils/conversation-state';
import {ErrorMessage} from '@/components/message-box';
import type {ToolManager} from '@/tools/tool-manager';
import type {ToolCall, ToolResult} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {parseToolArguments} from '@/utils/tool-args-parser';
import {displayToolResult} from '@/utils/tool-result-display';

/**
 * Executes tools directly without confirmation.
 * Handles validation, execution, and error display.
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
	const directResults: ToolResult[] = [];

	for (const toolCall of toolsToExecuteDirectly) {
		try {
			// Run validator if available
			const validator = toolManager?.getToolValidator(toolCall.function.name);
			if (validator) {
				const parsedArgs = parseToolArguments(toolCall.function.arguments);

				const validationResult = await validator(parsedArgs);
				if (!validationResult.valid) {
					// Validation failed - create error result and skip execution
					const errorResult: ToolResult = {
						tool_call_id: toolCall.id,
						role: 'tool' as const,
						name: toolCall.function.name,
						content: `Validation failed: ${formatError(validationResult.error)}`,
					};
					directResults.push(errorResult);

					// Update conversation state with error
					conversationStateManager.current.updateAfterToolExecution(
						toolCall,
						errorResult.content,
					);

					// Display the validation error to the user
					addToChatQueue(
						<ErrorMessage
							key={`validation-error-${toolCall.id}-${Date.now()}`}
							message={validationResult.error}
							hideBox={true}
						/>,
					);

					continue; // Skip to next tool
				}
			}

			const result = await processToolUse(toolCall);
			directResults.push(result);

			// Update conversation state with tool execution
			conversationStateManager.current.updateAfterToolExecution(
				toolCall,
				result.content,
			);

			// Display the tool result immediately
			await displayToolResult(
				toolCall,
				result,
				toolManager,
				addToChatQueue,
				getNextComponentKey,
			);
		} catch (error) {
			// Handle tool execution errors
			const errorResult: ToolResult = {
				tool_call_id: toolCall.id,
				role: 'tool' as const,
				name: toolCall.function.name,
				content: `Error: ${formatError(error)}`,
			};
			directResults.push(errorResult);

			// Update conversation state with error
			conversationStateManager.current.updateAfterToolExecution(
				toolCall,
				errorResult.content,
			);

			// Display the error result
			await displayToolResult(
				toolCall,
				errorResult,
				toolManager,
				addToChatQueue,
				getNextComponentKey,
			);
		}
	}

	return directResults;
};
