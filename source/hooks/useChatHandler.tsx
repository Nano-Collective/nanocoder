import {LLMClient, Message, ToolCall, ToolResult} from '@/types/core';
import {ToolManager} from '@/tools/tool-manager';
import {toolDefinitions} from '@/tools/index';
import {processPromptTemplate} from '@/utils/prompt-processor';
import {
	parseToolCallsFromContent,
	cleanContentFromToolCalls,
} from '@/tool-calling/index';
import {ConversationStateManager} from '@/app/utils/conversationState';
import {promptHistory} from '@/prompt-history';
import UserMessage from '@/components/user-message';
import AssistantMessage from '@/components/assistant-message';
import ErrorMessage from '@/components/error-message';
import ToolMessage from '@/components/tool-message';
import React from 'react';
import {SessionManager, Session} from '@/session/session-manager';

// Helper function to filter out invalid tool calls and deduplicate by ID and function
const filterValidToolCalls = (toolCalls: ToolCall[]): ToolCall[] => {
	const seenIds = new Set<string>();
	const seenFunctionCalls = new Set<string>();

	return toolCalls.filter(toolCall => {
		// Filter out completely empty tool calls
		if (!toolCall.id || !toolCall.function?.name) {
			return false;
		}

		// Filter out tool calls with empty names
		if (toolCall.function.name.trim() === '') {
			return false;
		}

		// Filter out tool calls for tools that don't exist

		// Filter out duplicate tool call IDs (GPT-5 issue)
		if (seenIds.has(toolCall.id)) {
			return false;
		}

		// Filter out functionally identical tool calls (same tool + args)
		const functionSignature = `${toolCall.function.name}:${JSON.stringify(
			toolCall.function.arguments,
		)}`;
		if (seenFunctionCalls.has(functionSignature)) {
			return false;
		}

		seenIds.add(toolCall.id);
		seenFunctionCalls.add(functionSignature);
		return true;
	});
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
	// Session management
	currentSession: Session | null;
	sessionManager: SessionManager | null;
	saveSessionDebounced: (session: Session) => void;
	convertMessageToSessionFormat: (message: Message) => {
	  role: 'user' | 'assistant' | 'system' | 'tool';
	  content: string;
	  timestamp: number;
	  tool_calls?: Array<{
	    id: string;
	    function: {
	      name: string;
	      arguments: Record<string, unknown>;
	    };
	  }>;
	  tool_call_id?: string;
	  name?: string;
	};
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
	currentSession,
	sessionManager,
	saveSessionDebounced,
	convertMessageToSessionFormat,
}: UseChatHandlerProps) {
	// Conversation state manager for enhanced context
	const conversationStateManager = React.useRef(new ConversationStateManager());

	// Reset conversation state when messages are cleared
	React.useEffect(() => {
		if (messages.length === 0) {
			conversationStateManager.current.reset();
		}
	}, [messages.length]);
	// Display tool result with proper formatting (similar to useToolHandler)
	const displayToolResult = async (toolCall: ToolCall, result: ToolResult) => {
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

			const result = await client.chat(
				[systemMessage, ...messages],
				toolManager?.getAllTools() || [],
				controller.signal,
			);

			if (!result || !result.choices || result.choices.length === 0) {
				throw new Error('No response received from model');
			}

			const message = result.choices[0].message;
			const toolCalls = message.tool_calls || null;
			const fullContent = message.content || '';

			// Parse any tool calls from content for non-tool-calling models
			const parsedToolCalls = parseToolCallsFromContent(fullContent);
			const cleanedContent = cleanContentFromToolCalls(
				fullContent,
				parsedToolCalls,
			);

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

			// Merge structured tool calls from LangGraph with content-parsed tool calls
			const allToolCalls = [...(toolCalls || []), ...parsedToolCalls];
			const validToolCalls = filterValidToolCalls(allToolCalls);

			// Add assistant message to conversation history
			const assistantMsg: Message = {
				role: 'assistant',
				content: cleanedContent,
				tool_calls: validToolCalls.length > 0 ? validToolCalls : undefined,
			};
			const updatedMessages = [...messages, assistantMsg];
			setMessages(updatedMessages);

			// Update conversation state with assistant message
			conversationStateManager.current.updateAssistantMessage(assistantMsg);

			// Save session after assistant response if session management is available
			if (currentSession && sessionManager) {
				const sessionMessages = updatedMessages.map(convertMessageToSessionFormat);
				const sessionToSave = {
					...currentSession,
					messages: sessionMessages,
					metadata: {
						...(currentSession.metadata || {}),
						lastAccessedAt: Date.now(),
						messageCount: updatedMessages.length,
					},
				};
				saveSessionDebounced(sessionToSave);
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
					const toolDef = toolDefinitions.find(
						def => def.config.function.name === toolCall.function.name,
					);

					// Check if tool has a validator
					let validationFailed = false;
					if (toolManager) {
						const validator = toolManager.getToolValidator(
							toolCall.function.name,
						);
						if (validator) {
							try {
								// Parse arguments if they're a JSON string
								let parsedArgs: unknown = toolCall.function.arguments;
								if (typeof parsedArgs === 'string') {
									try {
										parsedArgs = JSON.parse(parsedArgs) as Record<
											string,
											unknown
										>;
									} catch {
										// If parsing fails, use as-is
									}
								}

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

					// If validation failed OR tool doesn't require confirmation OR in auto-accept mode, execute directly
					// EXCEPT: execute_bash always requires confirmation for security
					const isBashTool = toolCall.function.name === 'execute_bash';
					if (
						validationFailed ||
						(toolDef && toolDef.requiresConfirmation === false) ||
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
								// Parse arguments if they're a JSON string
								let parsedArgs: unknown = toolCall.function.arguments;
								if (typeof parsedArgs === 'string') {
									try {
										parsedArgs = JSON.parse(parsedArgs) as Record<
											string,
											unknown
										>;
									} catch {
										// If parsing fails, use as-is
									}
								}

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

							const result = await processToolUse(toolCall);
							directResults.push(result);

							// Update conversation state with tool execution
							conversationStateManager.current.updateAfterToolExecution(
								toolCall,
								result.content,
							);

							// Display the tool result immediately
							await displayToolResult(toolCall, result);
						} catch (error) {
							// Handle tool execution errors
							const errorResult: ToolResult = {
								tool_call_id: toolCall.id,
								role: 'tool' as const,
								name: toolCall.function.name,
								content: `Error: ${
									error instanceof Error ? error.message : String(error)
								}`,
							};
							directResults.push(errorResult);

							// Update conversation state with error
							conversationStateManager.current.updateAfterToolExecution(
								toolCall,
								errorResult.content,
							);

							// Display the error result
							await displayToolResult(toolCall, errorResult);
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

						// Update conversation state with tool results
						for (const toolMessage of toolMessages) {
							conversationStateManager.current.updateAfterToolExecution(
								{
									id: toolMessage.tool_call_id || '',
									function: {
										name: toolMessage.name || '',
										arguments: {},
									},
								},
								toolMessage.content,
							);
						}

						// Save session after tool execution if session management is available
						if (currentSession && sessionManager) {
							const sessionMessages = updatedMessagesWithTools.map(convertMessageToSessionFormat);
							const sessionToSave = {
								...currentSession,
								messages: sessionMessages,
								metadata: {
									...(currentSession.metadata || {}),
									lastAccessedAt: Date.now(),
									messageCount: updatedMessagesWithTools.length,
								},
							};
							saveSessionDebounced(sessionToSave);
						}

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
				const errorMsg = error instanceof Error ? error.message : String(error);
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
			const availableTools = toolManager ? toolManager.getAllTools() : [];
			const systemPrompt = processPromptTemplate(availableTools);

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
				const errorMsg = error instanceof Error ? error.message : String(error);
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
		}
	};

	return {
		handleChatMessage,
		processAssistantResponse,
	};
}
