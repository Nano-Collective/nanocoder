import {
	LLMClient,
	LLMChatResponse,
	Message,
	ToolCall,
	ToolResult,
} from '@/types/core';
import {ToolManager} from '@/tools/tool-manager';
import {processPromptTemplate} from '@/utils/prompt-processor';
import {parseToolCalls} from '@/tool-calling/index';
import {ConversationStateManager} from '@/app/utils/conversationState';
import {promptHistory} from '@/prompt-history';
import {isStreamingEnabled} from '@/config/preferences';
import {displayToolResult} from '@/utils/tool-result-display';
import {parseToolArguments} from '@/utils/tool-args-parser';
import {formatError} from '@/utils/error-formatter';
import UserMessage from '@/components/user-message';
import AssistantMessage from '@/components/assistant-message';
import ErrorMessage from '@/components/error-message';
import ToolMessage from '@/components/tool-message';
import React from 'react';

// Helper function to filter out invalid tool calls and deduplicate by ID and function
// Returns valid tool calls and error results for invalid ones
const filterValidToolCalls = (
	toolCalls: ToolCall[],
	toolManager: ToolManager | null,
): {validToolCalls: ToolCall[]; errorResults: ToolResult[]} => {
	const seenIds = new Set<string>();
	const seenFunctionCalls = new Set<string>();
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
			errorResults.push({
				tool_call_id: toolCall.id,
				role: 'tool' as const,
				name: toolCall.function.name,
				content: `Error: Unknown tool: ${toolCall.function.name}. This tool does not exist. Please use only the tools that are available in the system.`,
			});
			continue;
		}

		// Filter out duplicate tool call IDs (GPT-5 issue)
		if (seenIds.has(toolCall.id)) {
			continue;
		}

		// Filter out functionally identical tool calls (same tool + args)
		const functionSignature = `${toolCall.function.name}:${JSON.stringify(
			toolCall.function.arguments,
		)}`;
		if (seenFunctionCalls.has(functionSignature)) {
			continue;
		}

		seenIds.add(toolCall.id);
		seenFunctionCalls.add(functionSignature);
		validToolCalls.push(toolCall);
	}

	return {validToolCalls, errorResults};
};

interface UseChatHandlerProps {
	client: LLMClient | null;
	toolManager: ToolManager | null;
	messages: Message[];
	setMessages: (messages: Message[]) => void;
	currentModel: string;
	setIsThinking: (thinking: boolean) => void;
	setIsCancelling: (cancelling: boolean) => void;

	addToChatQueue: (component: React.ReactNode) => void;
	componentKeyCounter: number;
	abortController: AbortController | null;
	setAbortController: (controller: AbortController | null) => void;
	developmentMode?: 'normal' | 'auto-accept' | 'plan';
	onStartToolConfirmationFlow: (
		toolCalls: ToolCall[],
		updatedMessages: Message[],
		assistantMsg: Message,
		systemMessage: Message,
	) => void;
}

export function useChatHandler({
	client,
	toolManager,
	messages,
	setMessages,
	currentModel,
	setIsThinking,
	setIsCancelling,
	addToChatQueue,
	componentKeyCounter,
	abortController,
	setAbortController,
	developmentMode = 'normal',
	onStartToolConfirmationFlow,
}: UseChatHandlerProps) {
	// Conversation state manager for enhanced context
	const conversationStateManager = React.useRef(new ConversationStateManager());

	// State for streaming message content
	const [streamingContent, setStreamingContent] = React.useState<string>('');
	const [isStreaming, setIsStreaming] = React.useState<boolean>(false);

	// Reset conversation state when messages are cleared
	React.useEffect(() => {
		if (messages.length === 0) {
			conversationStateManager.current.reset();
		}
	}, [messages.length]);

	// Process assistant response - handles the conversation loop with potential tool calls (for follow-ups)
	const processAssistantResponse = async (
		systemMessage: Message,
		messages: Message[],
	) => {
		if (!client) return;

		// Ensure we have an abort controller for this request
		let controller = abortController;
		if (!controller) {
			controller = new AbortController();
			setAbortController(controller);
		}

		try {
			setIsThinking(true);

			// Try to use streaming if available and enabled, otherwise fallback to non-streaming
			let result: LLMChatResponse;

			if (client.chatStream && isStreamingEnabled()) {
				// Use streaming with callbacks
				let accumulatedContent = '';

				setIsStreaming(true);
				setStreamingContent('');

				result = await client.chatStream(
					[systemMessage, ...messages],
					toolManager?.getAllTools() || {},
					{
						onToken: (token: string) => {
							accumulatedContent += token;
							setStreamingContent(accumulatedContent);
						},
						onToolCall: (toolCall: ToolCall) => {
							// Display tool formatter immediately when tool call is detected
							if (toolManager) {
								const formatter = toolManager.getToolFormatter(
									toolCall.function.name,
								);
								if (formatter) {
									// Execute async formatter without blocking
									void (async () => {
										try {
											const parsedArgs = parseToolArguments(
												toolCall.function.arguments,
											);
											const preview = await formatter(parsedArgs);

											// Add to chat queue with the tool formatter preview
											if (React.isValidElement(preview)) {
												addToChatQueue(
													React.cloneElement(preview, {
														key: `tool-preview-${toolCall.id}-${componentKeyCounter}`,
													}),
												);
											} else {
												addToChatQueue(
													<ToolMessage
														key={`tool-preview-${toolCall.id}-${componentKeyCounter}`}
														title={`⚒ ${toolCall.function.name}`}
														message={String(preview)}
														hideBox={true}
													/>,
												);
											}
										} catch (error) {
											// Silently fail - formatter is optional
											console.error('Error displaying tool formatter:', error);
										}
									})();
								}
							}
						},
						onFinish: () => {
							setIsStreaming(false);
						},
					},
					controller.signal,
				);
			} else {
				// Fallback to non-streaming (either client doesn't support it or user disabled it)
				result = await client.chat(
					[systemMessage, ...messages],
					toolManager?.getAllTools() || {},
					controller.signal,
				);
			}

			if (!result || !result.choices || result.choices.length === 0) {
				throw new Error('No response received from model');
			}

			const message = result.choices[0].message;
			const toolCalls = message.tool_calls || null;
			const fullContent = message.content || '';

			// Parse any tool calls from content for non-tool-calling models
			const parseResult = parseToolCalls(fullContent);

			// Check for malformed tool calls and throw error to let model retry
			if (!parseResult.success) {
				throw new Error(`${parseResult.error}\n\n${parseResult.examples}`);
			}

			const parsedToolCalls = parseResult.toolCalls;
			const cleanedContent = parseResult.cleanedContent;

			// Display the assistant response (cleaned of any tool calls)
			if (cleanedContent.trim()) {
				addToChatQueue(
					<AssistantMessage
						key={`assistant-${componentKeyCounter}`}
						message={cleanedContent}
						model={currentModel}
					/>,
				);
			}

			// Merge structured tool calls from AI SDK with content-parsed tool calls
			const allToolCalls = [...(toolCalls || []), ...parsedToolCalls];

			const {validToolCalls, errorResults} = filterValidToolCalls(
				allToolCalls,
				toolManager,
			);

			// Add assistant message to conversation history
			const assistantMsg: Message = {
				role: 'assistant',
				content: cleanedContent,
				tool_calls: validToolCalls.length > 0 ? validToolCalls : undefined,
			};
			setMessages([...messages, assistantMsg]);

			// Update conversation state with assistant message
			conversationStateManager.current.updateAssistantMessage(assistantMsg);

			// Clear streaming state after response is complete
			setIsStreaming(false);
			setStreamingContent('');

			// Handle error results for non-existent tools
			if (errorResults.length > 0) {
				// Display error messages to user
				for (const error of errorResults) {
					addToChatQueue(
						<ErrorMessage
							key={`unknown-tool-${error.tool_call_id}-${Date.now()}`}
							message={error.content}
							hideBox={true}
						/>,
					);
				}

				// Send error results back to model for self-correction
				const toolMessages = errorResults.map(result => ({
					role: 'tool' as const,
					content: result.content || '',
					tool_call_id: result.tool_call_id,
					name: result.name,
				}));

				const updatedMessagesWithError = [
					...messages,
					assistantMsg,
					...toolMessages,
				];
				setMessages(updatedMessagesWithError);

				// Continue the main conversation loop with error messages as context
				await processAssistantResponse(systemMessage, updatedMessagesWithError);
				return;
			}

			// Handle tool calls if present - this continues the loop
			if (validToolCalls && validToolCalls.length > 0) {
				// In Plan Mode, block file modification tools
				if (developmentMode === 'plan') {
					const fileModificationTools = [
						'create_file',
						'delete_lines',
						'insert_lines',
						'replace_lines',
					];
					const blockedTools = validToolCalls.filter(tc =>
						fileModificationTools.includes(tc.function.name),
					);

					if (blockedTools.length > 0) {
						// Create error results for blocked tools
						const blockedToolErrors: ToolResult[] = blockedTools.map(
							toolCall => ({
								tool_call_id: toolCall.id,
								role: 'tool' as const,
								name: toolCall.function.name,
								content: `⚠ Tool "${toolCall.function.name}" is not allowed in Plan Mode. File modification tools are restricted in this mode. Switch to Normal Mode or Auto-accept Mode to execute file modifications.`,
							}),
						);

						// Display error messages
						for (const error of blockedToolErrors) {
							addToChatQueue(
								<ErrorMessage
									key={`plan-mode-blocked-${error.tool_call_id}-${Date.now()}`}
									message={error.content}
									hideBox={true}
								/>,
							);
						}

						// Continue conversation with error messages
						const toolMessages = blockedToolErrors.map(result => ({
							role: 'tool' as const,
							content: result.content || '',
							tool_call_id: result.tool_call_id,
							name: result.name,
						}));

						const updatedMessagesWithError = [
							...messages,
							assistantMsg,
							...toolMessages,
						];
						setMessages(updatedMessagesWithError);

						// Continue the main conversation loop with error messages as context
						await processAssistantResponse(
							systemMessage,
							updatedMessagesWithError,
						);
						return;
					}
				}

				// Separate tools that need confirmation vs those that don't
				// BUT: if a tool fails validation, execute directly (skip confirmation)
				const toolsNeedingConfirmation: ToolCall[] = [];
				const toolsToExecuteDirectly: ToolCall[] = [];

				for (const toolCall of validToolCalls) {
					// Check if tool has a validator
					let validationFailed = false;

					// XML validation errors are treated as validation failures
					if (toolCall.function.name === '__xml_validation_error__') {
						validationFailed = true;
					} else if (toolManager) {
						const validator = toolManager.getToolValidator(
							toolCall.function.name,
						);
						if (validator) {
							try {
								const parsedArgs = parseToolArguments(
									toolCall.function.arguments,
								);

								const validationResult = await validator(parsedArgs);
								if (!validationResult.valid) {
									validationFailed = true;
								}
							} catch {
								// Validation threw an error - treat as validation failure
								validationFailed = true;
							}
						}
					}

					// If validation failed OR in auto-accept mode (except bash), execute directly
					// EXCEPT: execute_bash always requires confirmation for security
					// Note: Tool approval is now handled by AI SDK's needsApproval property
					const isBashTool = toolCall.function.name === 'execute_bash';
					if (
						validationFailed ||
						(developmentMode === 'auto-accept' && !isBashTool)
					) {
						toolsToExecuteDirectly.push(toolCall);
					} else {
						toolsNeedingConfirmation.push(toolCall);
					}
				}

				// Execute non-confirmation tools directly
				if (toolsToExecuteDirectly.length > 0) {
					// Import processToolUse here to avoid circular dependencies
					const {processToolUse} = await import('@/message-handler');
					const directResults: ToolResult[] = [];

					for (const toolCall of toolsToExecuteDirectly) {
						try {
							// Run validator if available
							const validator = toolManager?.getToolValidator(
								toolCall.function.name,
							);
							if (validator) {
								const parsedArgs = parseToolArguments(
									toolCall.function.arguments,
								);

								const validationResult = await validator(parsedArgs);
								if (!validationResult.valid) {
									// Validation failed - create error result and skip execution
									const errorResult: ToolResult = {
										tool_call_id: toolCall.id,
										role: 'tool' as const,
										name: toolCall.function.name,
										content: validationResult.error,
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

							// Display tool formatter before execution (for auto-accepted tools)
							if (toolManager) {
								const formatter = toolManager.getToolFormatter(
									toolCall.function.name,
								);
								if (formatter) {
									try {
										const parsedArgs = parseToolArguments(
											toolCall.function.arguments,
										);
										const preview = await formatter(parsedArgs);

										// Display the formatter preview
										if (React.isValidElement(preview)) {
											addToChatQueue(
												React.cloneElement(preview, {
													key: `tool-preview-${toolCall.id}-${componentKeyCounter}`,
												}),
											);
										} else {
											addToChatQueue(
												<ToolMessage
													key={`tool-preview-${toolCall.id}-${componentKeyCounter}`}
													title={`⚒ ${toolCall.function.name}`}
													message={String(preview)}
													hideBox={true}
												/>,
											);
										}
									} catch (error) {
										// Silently fail - formatter is optional
										console.error('Error displaying tool formatter:', error);
									}
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
								componentKeyCounter,
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
								componentKeyCounter,
							);
						}
					}

					// If we have results, continue the conversation with them
					if (directResults.length > 0) {
						// Format tool results as standard tool messages
						const toolMessages = directResults.map(result => ({
							role: 'tool' as const,
							content: result.content || '',
							tool_call_id: result.tool_call_id,
							name: result.name,
						}));

						const updatedMessagesWithTools = [
							...messages,
							assistantMsg,
							...toolMessages,
						];
						setMessages(updatedMessagesWithTools);

						// Continue the main conversation loop with tool results as context
						await processAssistantResponse(
							systemMessage,
							updatedMessagesWithTools,
						);
						return;
					}
				}

				// Start confirmation flow only for tools that need it
				if (toolsNeedingConfirmation.length > 0) {
					onStartToolConfirmationFlow(
						toolsNeedingConfirmation,
						messages,
						assistantMsg,
						systemMessage,
					);
				}
			}

			// If no tool calls, the conversation naturally ends here
			// BUT: if there's ALSO no content, that's likely an error - the model should have said something
			// Auto-reprompt to help the model continue
			if (validToolCalls.length === 0 && !cleanedContent.trim()) {
				// Check if we just executed tools (messages should have tool results)
				const lastMessage = messages[messages.length - 1];
				const hasRecentToolResults = lastMessage?.role === 'tool';

				if (hasRecentToolResults) {
					// Add a system-like nudge message to help model continue
					const nudgeMessage: Message = {
						role: 'user',
						content:
							'Please provide a summary or response based on the tool results above.',
					};

					const updatedMessagesWithNudge = [
						...messages,
						assistantMsg,
						nudgeMessage,
					];
					setMessages(updatedMessagesWithNudge);

					// Continue the conversation loop with the nudge
					await processAssistantResponse(
						systemMessage,
						updatedMessagesWithNudge,
					);
					return;
				} else {
					addToChatQueue(
						<ErrorMessage
							key={`empty-response-${componentKeyCounter}`}
							message="The model returned an empty response. This may happen if the model is having issues or has finished processing. Try asking a follow-up question or saying 'continue' if you expected more output."
							hideBox={true}
						/>,
					);
				}
			}
		} catch (error) {
			if (
				error instanceof Error &&
				error.message === 'Operation was cancelled'
			) {
				addToChatQueue(
					<ErrorMessage
						key={`cancelled-${componentKeyCounter}`}
						message="Interrupted by user."
						hideBox={true}
					/>,
				);
			} else {
				// Extract clean error message
				const errorMsg = formatError(error);
				addToChatQueue(
					<ErrorMessage
						hideBox={true}
						key={`error-${componentKeyCounter}`}
						message={errorMsg}
					/>,
				);
			}
		} finally {
			setIsThinking(false);
			setIsCancelling(false);
			setAbortController(null);
			setIsStreaming(false);
			setStreamingContent('');
		}
	};

	// Handle chat message processing
	const handleChatMessage = async (message: string) => {
		if (!client || !toolManager) return;

		// For display purposes, try to get the placeholder version from history
		// This preserves the nice placeholder display in chat history
		const history = promptHistory.getHistory();
		const lastEntry = history[history.length - 1];
		const displayMessage = lastEntry?.displayValue || message;

		// Add user message to chat using display version (with placeholders)
		addToChatQueue(
			<UserMessage
				key={`user-${componentKeyCounter}`}
				message={displayMessage}
			/>,
		);

		// Add user message to conversation history
		const userMessage: Message = {role: 'user', content: message};
		const updatedMessages = [...messages, userMessage];
		setMessages(updatedMessages);

		// Initialize conversation state if this is a new conversation
		if (messages.length === 0) {
			conversationStateManager.current.initializeState(message);
		}

		// Create abort controller for cancellation
		const controller = new AbortController();
		setAbortController(controller);

		// Start thinking indicator and streaming
		setIsThinking(true);

		try {
			// Load and process system prompt with dynamic tool documentation
			// Note: We still need tool definitions (not just native tools) for documentation
			const systemPrompt = processPromptTemplate(
				toolManager ? toolManager.getAllTools() : {},
			);

			// Create stream request
			const systemMessage: Message = {
				role: 'system',
				content: systemPrompt,
			};

			// Use the new conversation loop
			await processAssistantResponse(systemMessage, updatedMessages);
		} catch (error) {
			if (
				error instanceof Error &&
				error.message === 'Operation was cancelled'
			) {
				addToChatQueue(
					<ErrorMessage
						key={`cancelled-${componentKeyCounter}`}
						message="Operation was cancelled by user"
						hideBox={true}
					/>,
				);
			} else {
				// Extract clean error message
				const errorMsg = formatError(error);
				addToChatQueue(
					<ErrorMessage
						key={`error-${componentKeyCounter}`}
						message={errorMsg}
					/>,
				);
			}
		} finally {
			setIsThinking(false);
			setIsCancelling(false);
			setAbortController(null);
			setIsStreaming(false);
			setStreamingContent('');
		}
	};

	return {
		handleChatMessage,
		processAssistantResponse,
		isStreaming,
		streamingContent,
	};
}
