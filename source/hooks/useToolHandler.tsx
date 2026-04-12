import React, {useRef} from 'react';
import BashProgress from '@/components/bash-progress';
import {ErrorMessage, InfoMessage} from '@/components/message-box';
import {setCurrentMode as setCurrentModeContext} from '@/context/mode-context';
import {ConversationContext} from '@/hooks/useAppState';
import {getToolManager, processToolUse} from '@/message-handler';
import {executeBashCommand, formatBashResultForLLM} from '@/tools/execute-bash';
import {
	DevelopmentMode,
	LLMClient,
	Message,
	ToolCall,
	ToolResult,
} from '@/types/core';
import {MessageBuilder} from '@/utils/message-builder';
import {parseToolArguments} from '@/utils/tool-args-parser';
import {createCancellationResults} from '@/utils/tool-cancellation';
import {displayToolResult} from '@/utils/tool-result-display';
import {getVSCodeServerSync} from '@/vscode/index';

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
	setLiveComponent: (component: React.ReactNode) => void;
	getNextComponentKey: () => number;
	resetToolConfirmationState: () => void;
	onProcessAssistantResponse: (
		systemMessage: Message,
		messages: Message[],
	) => Promise<void>;
	client?: LLMClient | null;
	currentProvider?: string;
	setDevelopmentMode?: (mode: DevelopmentMode) => void;
	compactToolDisplay?: boolean;
	abortController?: AbortController | null;
	setAbortController?: (controller: AbortController | null) => void;
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
	setLiveComponent,
	getNextComponentKey,
	resetToolConfirmationState,
	onProcessAssistantResponse,
	client: _client,
	currentProvider: _currentProvider,
	setDevelopmentMode,
	compactToolDisplay,
	abortController: _abortController,
	setAbortController,
}: UseToolHandlerProps) {
	// Ref to hold the abort controller for the current tool execution phase.
	// This survives across the setImmediate boundary where the prop would be stale.
	const toolAbortControllerRef = useRef<AbortController | null>(null);

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

		const {messagesBeforeToolExecution, systemMessage} =
			currentConversationContext;

		// Build updated messages with tool results
		const builder = new MessageBuilder(messagesBeforeToolExecution);
		builder.addToolResults(resultsToUse);
		const updatedMessagesWithTools = builder.build();
		setMessages(updatedMessagesWithTools);

		// Reset tool confirmation state since we're continuing the conversation
		resetToolConfirmationState();

		// Continue the main conversation loop with tool results as context
		await onProcessAssistantResponse(systemMessage, updatedMessagesWithTools);
	};

	// Handle tool confirmation
	const handleToolConfirmation = (confirmed: boolean) => {
		if (!confirmed) {
			// User cancelled - close all VS Code diffs
			const vscodeServer = getVSCodeServerSync();
			if (vscodeServer?.hasConnections()) {
				vscodeServer.closeAllDiffs();
			}

			// User cancelled - show message
			addToChatQueue(
				<InfoMessage
					key={`tool-cancelled-${getNextComponentKey()}`}
					message="Tool execution cancelled by user."
					hideBox={true}
				/>,
			);

			if (!currentConversationContext) {
				resetToolConfirmationState();
				return;
			}

			// Create cancellation results for all pending tools
			// This is critical to maintain conversation state integrity
			const cancellationResults = createCancellationResults(pendingToolCalls);

			const {messagesBeforeToolExecution} = currentConversationContext;

			// Build updated messages with cancellation results
			const builder = new MessageBuilder(messagesBeforeToolExecution);
			builder.addToolResults(cancellationResults);
			const updatedMessagesWithCancellation = builder.build();
			setMessages(updatedMessagesWithCancellation);

			// Reset state to allow user to type a new message
			// Do NOT continue the conversation - let the user provide instructions
			resetToolConfirmationState();
			return;
		}

		// Move to tool execution state - this allows UI to update immediately
		setIsToolConfirmationMode(false);
		setIsToolExecuting(true);

		// Create an abort controller for this tool execution phase so
		// the escape key can cancel running subagents/tools.
		const controller = new AbortController();
		toolAbortControllerRef.current = controller;
		setAbortController?.(controller);

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
						key={`mcp-tool-executing-${getNextComponentKey()}-${Date.now()}`}
						message={`Executing MCP tool "${currentTool.function.name}" from server "${mcpInfo.serverName}"`}
						hideBox={true}
					/>,
				);
			}

			// Run validator if available
			const validator = toolManager.getToolValidator(currentTool.function.name);
			if (validator) {
				try {
					const parsedArgs = parseToolArguments(currentTool.function.arguments);

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
								key={`tool-validation-error-${getNextComponentKey()}-${Date.now()}`}
								message={validationResult.error}
								hideBox={true}
							/>,
						);

						// Move to next tool or complete the process
						if (currentToolIndex + 1 < pendingToolCalls.length) {
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
							key={`tool-validation-error-${getNextComponentKey()}-${Date.now()}`}
							message={`Validation error: ${String(validationError)}`}
							hideBox={true}
						/>,
					);

					// Move to next tool or complete the process
					if (currentToolIndex + 1 < pendingToolCalls.length) {
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
				const parsedArgs = parseToolArguments(currentTool.function.arguments);

				// Actually switch the mode
				// Sync both React state AND global context synchronously
				// to prevent race conditions where tools check global context
				// before the useEffect in App.tsx has a chance to sync it
				const requestedMode = parsedArgs.mode as DevelopmentMode;
				setDevelopmentMode(requestedMode);
				setCurrentModeContext(requestedMode);

				addToChatQueue(
					<InfoMessage
						key={`mode-switched-${getNextComponentKey()}-${Date.now()}`}
						message={`Development mode switched to: ${requestedMode.toUpperCase()}`}
						hideBox={true}
					/>,
				);
			}

			// Check if tool has a streaming formatter (for real-time progress)
			const streamingFormatter = toolManager?.getStreamingFormatter(
				currentTool.function.name,
			);

			let result: ToolResult;

			if (streamingFormatter) {
				// Streaming tool (e.g., execute_bash) - handle specially
				const parsedArgs = parseToolArguments(currentTool.function.arguments);
				const commandStr = parsedArgs.command as string;

				// Start execution first to get execution ID
				const {executionId, promise} = executeBashCommand(commandStr);

				// Set as live component (renders outside Static for real-time updates)
				setLiveComponent(
					<BashProgress
						key={`streaming-tool-${currentTool.id}-${getNextComponentKey()}-${Date.now()}`}
						executionId={executionId}
						command={commandStr}
						isLive={true}
					/>,
				);

				// Wait for execution to complete
				const bashResult = await promise;
				const llmContent = formatBashResultForLLM(bashResult);

				result = {
					tool_call_id: currentTool.id,
					role: 'tool' as const,
					name: currentTool.function.name,
					content: llmContent,
				};

				// Clear live component and add static completed result to chat queue
				setLiveComponent(null);

				if (compactToolDisplay) {
					// In compact mode, use displayToolResult for consistent one-liner display
					await displayToolResult(
						currentTool,
						result,
						toolManager,
						addToChatQueue,
						getNextComponentKey,
						true,
					);
				} else {
					addToChatQueue(
						<BashProgress
							key={`streaming-tool-complete-${currentTool.id}-${getNextComponentKey()}-${Date.now()}`}
							executionId={executionId}
							command={commandStr}
							completedState={bashResult}
						/>,
					);
				}
			} else {
				// Regular tool - use standard flow
				result = await processToolUse(currentTool);

				// Display the tool result
				await displayToolResult(
					currentTool,
					result,
					toolManager,
					addToChatQueue,
					getNextComponentKey,
					compactToolDisplay,
				);
			}

			const newResults = [...completedToolResults, result];
			setCompletedToolResults(newResults);

			// Move to next tool or complete the process
			if (currentToolIndex + 1 < pendingToolCalls.length) {
				setCurrentToolIndex(currentToolIndex + 1);
				// Return to confirmation mode for next tool
				setIsToolExecuting(false);
				setIsToolConfirmationMode(true);
			} else {
				// All tools executed, continue conversation loop with the updated results
				setIsToolExecuting(false);
				await continueConversationWithToolResults(newResults);
			}
		} catch (error) {
			setIsToolExecuting(false);
			addToChatQueue(
				<ErrorMessage
					key={`tool-exec-error-${getNextComponentKey()}`}
					message={`Tool execution error: ${String(error)}`}
				/>,
			);
			resetToolConfirmationState();
			setLiveComponent(null);
		}
	};

	// Handle tool confirmation cancel
	const handleToolConfirmationCancel = () => {
		// Close all VS Code diffs when user cancels
		const vscodeServer = getVSCodeServerSync();
		if (vscodeServer?.hasConnections()) {
			vscodeServer.closeAllDiffs();
		}

		addToChatQueue(
			<InfoMessage
				key={`tool-cancelled-${getNextComponentKey()}`}
				message="Tool execution cancelled by user."
				hideBox={true}
			/>,
		);

		if (!currentConversationContext) {
			resetToolConfirmationState();
			return;
		}

		// Create cancellation results for all pending tools
		// This is critical to maintain conversation state integrity
		const cancellationResults = createCancellationResults(pendingToolCalls);

		const {messagesBeforeToolExecution} = currentConversationContext;

		// Build updated messages with cancellation results
		const builder = new MessageBuilder(messagesBeforeToolExecution);
		builder.addToolResults(cancellationResults);
		const updatedMessagesWithCancellation = builder.build();
		setMessages(updatedMessagesWithCancellation);

		// Reset state to allow user to type a new message
		// Do NOT continue the conversation - let the user provide instructions
		resetToolConfirmationState();
	};

	// Start tool confirmation flow
	const startToolConfirmationFlow = (
		toolCalls: ToolCall[],
		messagesBeforeToolExecution: Message[],
		assistantMsg: Message,
		systemMessage: Message,
	) => {
		setPendingToolCalls(toolCalls);
		setCurrentToolIndex(0);
		setCompletedToolResults([]);
		setCurrentConversationContext({
			messagesBeforeToolExecution,
			assistantMsg,
			systemMessage,
		});
		setIsToolConfirmationMode(true);
	};

	return {
		handleToolConfirmation,
		handleToolConfirmationCancel,
		startToolConfirmationFlow,
		continueConversationWithToolResults,
		executeCurrentTool,
	};
}
