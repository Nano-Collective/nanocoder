import {
	Message,
	LLMClient,
	DevelopmentMode,
	ToolCall,
	ToolResult,
} from '@/types/core';
import {processToolUse, getToolManager} from '@/message-handler';
import {ConversationContext} from '@/hooks/useAppState';
import InfoMessage from '@/components/info-message';
import ErrorMessage from '@/components/error-message';
import ToolMessage from '@/components/tool-message';
import React from 'react';
import {fileReadTracker} from '@/utils/file-read-tracker';

interface UseToolHandlerProps {
	pendingToolCalls: ToolCall[];
	currentToolIndex: number;
	completedToolResults: ToolResult[];
	currentConversationContext: ConversationContext | null;
	setPendingToolCalls: (calls: ToolCall[]) => void;
	setCurrentToolIndex: (index: number) => void;
	setCompletedToolResults: (results: ToolResult[]) => void;
	setCurrentConversationContext: (context: ConversationContext | null) => void;
	setIsToolConfirmationMode: (mode: boolean) => void;
	setIsToolExecuting: (executing: boolean) => void;
	setMessages: (messages: Message[]) => void;
	addToChatQueue: (component: React.ReactNode) => void;
	componentKeyCounter: number;
	resetToolConfirmationState: () => void;
	onProcessAssistantResponse: (
		systemMessage: Message,
		messages: Message[],
	) => Promise<void>;
	client?: LLMClient | null;
	currentProvider?: string;
	setDevelopmentMode?: (mode: DevelopmentMode) => void;
}

export function useToolHandler({
	pendingToolCalls,
	currentToolIndex,
	completedToolResults,
	currentConversationContext,
	setPendingToolCalls,
	setCurrentToolIndex,
	setCompletedToolResults,
	setCurrentConversationContext,
	setIsToolConfirmationMode,
	setIsToolExecuting,
	setMessages,
	addToChatQueue,
	componentKeyCounter,
	resetToolConfirmationState,
	onProcessAssistantResponse,
	client: _client,
	currentProvider: _currentProvider,
	setDevelopmentMode,
}: UseToolHandlerProps) {
	// Display tool result with proper formatting
	const displayToolResult = async (toolCall: ToolCall, result: ToolResult) => {
		const toolManager = getToolManager();
		if (toolManager) {
			const formatter = toolManager.getToolFormatter(result.name);
			if (formatter) {
				try {
					// Parse arguments if they're a JSON string
					let parsedArgs: unknown = toolCall.function.arguments;
					if (typeof parsedArgs === 'string') {
						try {
							parsedArgs = JSON.parse(parsedArgs) as Record<string, unknown>;
						} catch {
							// If parsing fails, use as-is
						}
					}
					const formattedResult = await formatter(parsedArgs, result.content);

					if (React.isValidElement(formattedResult)) {
						addToChatQueue(
							React.cloneElement(formattedResult, {
								key: `tool-result-${
									result.tool_call_id
								}-${componentKeyCounter}-${Date.now()}`,
							}),
						);
					} else {
						addToChatQueue(
							<ToolMessage
								key={`tool-result-${
									result.tool_call_id
								}-${componentKeyCounter}-${Date.now()}`}
								title={`⚒ ${result.name}`}
								message={String(formattedResult)}
								hideBox={true}
							/>,
						);
					}
				} catch {
					// If formatter fails, show raw result
					addToChatQueue(
						<ToolMessage
							key={`tool-result-${result.tool_call_id}-${componentKeyCounter}`}
							title={`⚒ ${result.name}`}
							message={result.content}
							hideBox={true}
						/>,
					);
				}
			} else {
				// No formatter, show raw result
				addToChatQueue(
					<ToolMessage
						key={`tool-result-${result.tool_call_id}-${componentKeyCounter}`}
						title={`⚒ ${result.name}`}
						message={result.content}
						hideBox={true}
					/>,
				);
			}
		}
	};

	// Continue conversation with tool results - maintains the proper loop
	const continueConversationWithToolResults = async (
		toolResults?: ToolResult[],
	) => {
		if (!currentConversationContext) {
			resetToolConfirmationState();
			return;
		}

		// Use passed results or fallback to state (for backwards compatibility)
		const resultsToUse = toolResults || completedToolResults;

		const {updatedMessages, assistantMsg, systemMessage} =
			currentConversationContext;

		// Format tool results as standard tool messages
		const toolMessages = resultsToUse.map(result => ({
			role: 'tool' as const,
			content: result.content || '',
			tool_call_id: result.tool_call_id,
			name: result.name,
		}));

		// Update conversation history with tool results
		// The assistantMsg is NOT included in updatedMessages (updatedMessages is the state before adding assistantMsg)
		// We need to add both the assistant message and the tool results
		const updatedMessagesWithTools = [
			...updatedMessages,
			assistantMsg, // Add the assistant message with tool_calls intact for proper tool_call_id matching
			...toolMessages,
		];
		setMessages(updatedMessagesWithTools);

		// Reset tool confirmation state since we're continuing the conversation
		resetToolConfirmationState();

		// Continue the main conversation loop with tool results as context
		await onProcessAssistantResponse(systemMessage, updatedMessagesWithTools);
	};

	// Handle tool confirmation
	const handleToolConfirmation = (confirmed: boolean) => {
		if (!confirmed) {
			// User cancelled - show message
			addToChatQueue(
				<InfoMessage
					key={`tool-cancelled-${componentKeyCounter}`}
					message="Tool execution cancelled by user"
					hideBox={true}
				/>,
			);

			if (!currentConversationContext) {
				resetToolConfirmationState();
				return;
			}

			// Create cancellation results for all pending tools
			// This is critical to maintain conversation state integrity
			const cancellationResults = pendingToolCalls.map(toolCall => ({
				tool_call_id: toolCall.id,
				role: 'tool' as const,
				name: toolCall.function.name,
				content: 'Tool execution was cancelled by the user.',
			}));

			const {updatedMessages, assistantMsg} = currentConversationContext;

			// Format tool results as standard tool messages
			const toolMessages = cancellationResults.map(result => ({
				role: 'tool' as const,
				content: result.content || '',
				tool_call_id: result.tool_call_id,
				name: result.name,
			}));

			// Update conversation history with the assistant message + cancellation results
			// This prevents the "mismatch" error on the next user message
			const updatedMessagesWithCancellation = [
				...updatedMessages,
				assistantMsg, // Add the assistant message with tool_calls
				...toolMessages, // Add cancellation results
			];
			setMessages(updatedMessagesWithCancellation);

			// Reset state to allow user to type a new message
			// Do NOT continue the conversation - let the user provide instructions
			resetToolConfirmationState();
			return;
		}

		// Move to tool execution state - this allows UI to update immediately
		setIsToolConfirmationMode(false);
		setIsToolExecuting(true);

		// Execute tools asynchronously
		setImmediate(() => {
			void executeCurrentTool();
		});
	};

	// Execute the current tool asynchronously
	const executeCurrentTool = async () => {
		const currentTool = pendingToolCalls[currentToolIndex];

		// Check if this is an MCP tool and show appropriate messaging
		const toolManager = getToolManager();
		if (toolManager) {
			const mcpInfo = toolManager.getMCPToolInfo(currentTool.function.name);
			if (mcpInfo.isMCPTool) {
				addToChatQueue(
					<InfoMessage
						key={`mcp-tool-executing-${componentKeyCounter}-${Date.now()}`}
						message={`Executing MCP tool "${currentTool.function.name}" from server "${mcpInfo.serverName}"`}
						hideBox={true}
					/>,
				);
			}

			// Run validator if available
			const validator = toolManager.getToolValidator(currentTool.function.name);
			if (validator) {
				try {
					// Parse arguments if they're a JSON string
					let parsedArgs: unknown = currentTool.function.arguments;
					if (typeof parsedArgs === 'string') {
						try {
							parsedArgs = JSON.parse(parsedArgs) as Record<string, unknown>;
						} catch {
							// If parsing fails, use as-is
						}
					}

					const validationResult = await validator(parsedArgs);
					if (!validationResult.valid) {
						// Validation failed - show error and skip execution
						const errorResult = {
							tool_call_id: currentTool.id,
							role: 'tool' as const,
							name: currentTool.function.name,
							content: validationResult.error,
						};

						const newResults = [...completedToolResults, errorResult];
						setCompletedToolResults(newResults);

						// Display the error
						addToChatQueue(
							<ErrorMessage
								key={`tool-validation-error-${componentKeyCounter}-${Date.now()}`}
								message={validationResult.error}
								hideBox={true}
							/>,
						);

						// Move to next tool or complete the process
						if (currentToolIndex + 1 < pendingToolCalls.length) {
							// Clear the file read tracker if this tool was not a read tool
							const isReadTool =
								currentTool.function.name === 'read_file' ||
								currentTool.function.name === 'read_many_files';
							if (!isReadTool) {
								fileReadTracker.clearLastToolCall();
							}

							setCurrentToolIndex(currentToolIndex + 1);
							// Return to confirmation mode for next tool
							setIsToolExecuting(false);
							setIsToolConfirmationMode(true);
						} else {
							// All tools processed, continue conversation loop with the results
							setIsToolExecuting(false);
							await continueConversationWithToolResults(newResults);
						}
						return;
					}
				} catch (validationError) {
					// Validation threw an error - treat as validation failure
					const errorResult = {
						tool_call_id: currentTool.id,
						role: 'tool' as const,
						name: currentTool.function.name,
						content: `Validation error: ${
							validationError instanceof Error
								? validationError.message
								: String(validationError)
						}`,
					};

					const newResults = [...completedToolResults, errorResult];
					setCompletedToolResults(newResults);

					addToChatQueue(
						<ErrorMessage
							key={`tool-validation-error-${componentKeyCounter}-${Date.now()}`}
							message={`Validation error: ${String(validationError)}`}
							hideBox={true}
						/>,
					);

					// Move to next tool or complete the process
					if (currentToolIndex + 1 < pendingToolCalls.length) {
						// Clear the file read tracker if this tool was not a read tool
						const isReadTool =
							currentTool.function.name === 'read_file' ||
							currentTool.function.name === 'read_many_files';
						if (!isReadTool) {
							fileReadTracker.clearLastToolCall();
						}

						setCurrentToolIndex(currentToolIndex + 1);
						setIsToolExecuting(false);
						setIsToolConfirmationMode(true);
					} else {
						setIsToolExecuting(false);
						await continueConversationWithToolResults(newResults);
					}
					return;
				}
			}
		}

		try {
			// Special handling for switch_mode tool
			if (currentTool.function.name === 'switch_mode' && setDevelopmentMode) {
				let parsedArgs: unknown = currentTool.function.arguments;
				if (typeof parsedArgs === 'string') {
					try {
						parsedArgs = JSON.parse(parsedArgs) as Record<string, unknown>;
					} catch {
						// If parsing fails, use as-is
					}
				}

				// Actually switch the mode
				const requestedMode = (parsedArgs as Record<string, unknown>)
					.mode as DevelopmentMode;
				setDevelopmentMode(requestedMode);

				addToChatQueue(
					<InfoMessage
						key={`mode-switched-${componentKeyCounter}-${Date.now()}`}
						message={`Development mode switched to: ${requestedMode.toUpperCase()}`}
						hideBox={true}
					/>,
				);
			}

			const result = await processToolUse(currentTool);

			const newResults = [...completedToolResults, result];
			setCompletedToolResults(newResults);

			// Display the tool result
			await displayToolResult(currentTool, result);

			// Clear the file read tracker after ANY tool that is NOT a read tool
			// This ensures only files read in the immediately previous tool call are tracked
			const isReadTool =
				currentTool.function.name === 'read_file' ||
				currentTool.function.name === 'read_many_files';

			// Move to next tool or complete the process
			if (currentToolIndex + 1 < pendingToolCalls.length) {
				// After executing a tool, clear tracker unless it was a read tool
				// This means: read_file leaves files marked, but any other tool clears them
				if (!isReadTool) {
					fileReadTracker.clearLastToolCall();
				}

				setCurrentToolIndex(currentToolIndex + 1);
				// Return to confirmation mode for next tool
				setIsToolExecuting(false);
				setIsToolConfirmationMode(true);
			} else {
				// All tools in this batch executed
				// Clear tracker unless the last tool was a read (for next batch)
				if (!isReadTool) {
					fileReadTracker.clearLastToolCall();
				}

				setIsToolExecuting(false);
				await continueConversationWithToolResults(newResults);
			}
		} catch (error) {
			setIsToolExecuting(false);
			addToChatQueue(
				<ErrorMessage
					key={`tool-exec-error-${componentKeyCounter}`}
					message={`Tool execution error: ${String(error)}`}
				/>,
			);
			resetToolConfirmationState();
		}
	};

	// Handle tool confirmation cancel
	const handleToolConfirmationCancel = () => {
		addToChatQueue(
			<InfoMessage
				key={`tool-cancelled-${componentKeyCounter}`}
				message="Tool execution cancelled by user"
				hideBox={true}
			/>,
		);

		if (!currentConversationContext) {
			resetToolConfirmationState();
			return;
		}

		// Create cancellation results for all pending tools
		// This is critical to maintain conversation state integrity
		const cancellationResults = pendingToolCalls.map(toolCall => ({
			tool_call_id: toolCall.id,
			role: 'tool' as const,
			name: toolCall.function.name,
			content: 'Tool execution was cancelled by the user.',
		}));

		const {updatedMessages, assistantMsg} = currentConversationContext;

		// Format tool results as standard tool messages
		const toolMessages = cancellationResults.map(result => ({
			role: 'tool' as const,
			content: result.content || '',
			tool_call_id: result.tool_call_id,
			name: result.name,
		}));

		// Update conversation history with the assistant message + cancellation results
		// This prevents the "mismatch" error on the next user message
		const updatedMessagesWithCancellation = [
			...updatedMessages,
			assistantMsg, // Add the assistant message with tool_calls
			...toolMessages, // Add cancellation results
		];
		setMessages(updatedMessagesWithCancellation);

		// Reset state to allow user to type a new message
		// Do NOT continue the conversation - let the user provide instructions
		resetToolConfirmationState();
	};

	// Start tool confirmation flow
	const startToolConfirmationFlow = (
		toolCalls: ToolCall[],
		updatedMessages: Message[],
		assistantMsg: Message,
		systemMessage: Message,
	) => {
		setPendingToolCalls(toolCalls);
		setCurrentToolIndex(0);
		setCompletedToolResults([]);
		setCurrentConversationContext({
			updatedMessages,
			assistantMsg,
			systemMessage,
		});
		setIsToolConfirmationMode(true);
	};

	return {
		handleToolConfirmation,
		handleToolConfirmationCancel,
		startToolConfirmationFlow,
		displayToolResult,
		continueConversationWithToolResults,
		executeCurrentTool,
	};
}
