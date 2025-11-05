import React from 'react';
import {commandRegistry} from '@/commands';
import {parseInput} from '@/command-parser';
import {toolRegistry} from '@/tools/index';
import InfoMessage from '@/components/info-message';
import ToolMessage from '@/components/tool-message';
import ErrorMessage from '@/components/error-message';
import UserMessage from '@/components/user-message';
import AssistantMessage from '@/components/assistant-message';
import type {MessageSubmissionOptions, Message} from '@/types/index';
import type {LLMClient} from '@/types/core';

// Helper function to render historical messages when a session is restored
function renderHistoricalMessages(
	messages: Message[],
	addToChatQueue: (component: React.ReactNode) => void,
	currentModel: string,
): void {
	messages.forEach((message, index) => {
		let component: React.ReactNode = null;
		
		switch (message.role) {
			case 'user':
				component = React.createElement(UserMessage, {
					key: `historical-user-${index}-${Date.now()}`,
					message: message.content,
				});
				break;
			case 'assistant':
				component = React.createElement(AssistantMessage, {
					key: `historical-assistant-${index}-${Date.now()}`,
					message: message.content,
					model: currentModel,
				});
				break;
			case 'tool':
				// For tool messages, we need to check if it's a tool result or tool call
				if (message.tool_call_id && message.content) {
					component = React.createElement(ToolMessage, {
						key: `historical-tool-${index}-${Date.now()}`,
						title: `⚒ ${message.name || 'Tool Result'}`,
						message: message.content,
						hideBox: true,
					});
				}
				break;
			default:
				// For system messages or unknown roles, render as assistant message
				component = React.createElement(AssistantMessage, {
					key: `historical-system-${index}-${Date.now()}`,
					message: message.content,
					model: currentModel,
				});
				break;
		}
		
		if (component) {
			addToChatQueue(component);
		}
	});
}

export async function handleMessageSubmission(
	message: string,
	options: MessageSubmissionOptions,
): Promise<void> {
	const {
			customCommandCache,
			customCommandLoader,
			customCommandExecutor,
			onClearMessages,
			onEnterModelSelectionMode,
			onEnterProviderSelectionMode,
			onEnterThemeSelectionMode,
			onEnterRecommendationsMode,
			onEnterConfigWizardMode,
		onEnterSessionSelectionMode,
			onShowStatus,
			onHandleChatMessage,
			onAddToChatQueue,
			componentKeyCounter,
			setMessages,
			messages,
			setIsBashExecuting,
			setCurrentBashCommand,
		} = options;

	// Parse the input to determine its type
	const parsedInput = parseInput(message);

	// Handle bash commands (prefixed with !)
	if (parsedInput.isBashCommand && parsedInput.bashCommand) {
		const bashCommand = parsedInput.bashCommand;

		// Set bash execution state to show spinner
		setCurrentBashCommand(bashCommand);
		setIsBashExecuting(true);

		try {
			// Execute the bash command
			const resultString = await toolRegistry.execute_bash({
				command: bashCommand,
			});

			// Parse the result
			let result: {fullOutput: string; llmContext: string};
			try {
				result = JSON.parse(resultString) as {
					fullOutput: string;
					llmContext: string;
				};
			} catch {
				// If parsing fails, treat as plain string
				result = {
					fullOutput: resultString,
					llmContext:
						resultString.length > 4000
							? resultString.substring(0, 4000)
							: resultString,
				};
			}

			// Create a proper display of the command and its full output
			const commandOutput = `$ ${bashCommand}
${result.fullOutput || '(No output)'}`;

			// Add the command and its output to the chat queue
			onAddToChatQueue(
				React.createElement(ToolMessage, {
					key: `bash-result-${componentKeyCounter}`,
					message: commandOutput,
					hideBox: true,
					isBashMode: true,
				}),
			);

			// Add the truncated output to the LLM context for future interactions
			if (result.llmContext) {
				const userMessage: Message = {
					role: 'user',
					content: `Bash command output:\n\`\`\`\n$ ${bashCommand}\n${result.llmContext}\n\`\`\``,
				};
				setMessages([...messages, userMessage]);
			}

			// Clear bash execution state
			setIsBashExecuting(false);
			setCurrentBashCommand('');
			return;
		} catch (error: unknown) {
			// Show error message if command fails
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			onAddToChatQueue(
				React.createElement(ErrorMessage, {
					key: `bash-error-${componentKeyCounter}`,
					message: `Error executing command: ${errorMessage}`,
				}),
			);

			// Clear bash execution state
			setIsBashExecuting(false);
			setCurrentBashCommand('');

			// Don't send to LLM - just return here
			return;
		}
	}

	// Handle regular commands (prefixed with /)
	if (message.startsWith('/')) {
		const commandName = message.slice(1).split(' ')[0];

		// Check for custom command first
		const customCommand =
			customCommandCache.get(commandName) ||
			customCommandLoader?.getCommand(commandName);

		if (customCommand) {
			// Execute custom command with any arguments
			const args = message
				.slice(commandName.length + 1)
				.trim()
				.split(/\s+/)
				.filter(arg => arg);
			const processedPrompt = customCommandExecutor?.execute(
				customCommand,
				args,
			);

			// Send the processed prompt to the AI
			if (processedPrompt) {
				await onHandleChatMessage(processedPrompt);
			}
		} else {
			// Handle special commands that need app state access
				if (commandName === 'clear') {
					await onClearMessages();
					// Still show the clear command result
				} else if (commandName === 'model') {
					onEnterModelSelectionMode();
					return;
				} else if (commandName === 'provider') {
					onEnterProviderSelectionMode();
					return;
				} else if (commandName === 'theme') {
					onEnterThemeSelectionMode();
					return;
				} else if (commandName === 'recommendations') {
					onEnterRecommendationsMode();
					return;
				} else if (commandName === 'setup-config') {
					onEnterConfigWizardMode();
					return;
				} else if (commandName === 'resume') {
					// Handle resume command with arguments
					const args = message
						.slice(commandName.length + 1)
						.trim()
						.split(/\s+/)
						.filter(arg => arg);
					
					if (args.length === 0) {
						// No arguments - enter session selection mode
							onEnterSessionSelectionMode();
							return;
						} else if (args.length === 1) {
							const arg = args[0].toLowerCase();
							
							if (arg === 'last') {
								// Resume most recent session
								if (options.sessionManager) {
								  try {
								    const sessions = await options.sessionManager.listSessions();
								    if (sessions.length > 0) {
								      // Find the most recently updated session
								      const mostRecentSession = sessions.reduce((latest: any, session: any) =>
								        session.updatedAt > latest.updatedAt ? session : latest,
								        sessions[0]
								      );
								      
								      const session = await options.sessionManager.loadSession(mostRecentSession.id);
											if (session) {
												// Convert session messages to app format
												const appMessages = session.messages.map(options.convertSessionMessageToAppFormat);
											
												// Restore provider/model from session metadata if available
												if (session.metadata?.provider) {
													options.setCurrentProvider(session.metadata.provider);
												}
												if (session.metadata?.model) {
													options.setCurrentModel(session.metadata.model);
												}
											
												// Update messages with the session's messages
												options.setMessages(appMessages);
												
												// Render historical messages in the chat queue
												renderHistoricalMessages(appMessages, onAddToChatQueue, options.model);
											
												// Set current session
												options.setCurrentSession(session);
											
												onAddToChatQueue(
													React.createElement(InfoMessage, {
														key: `session-resumed-${componentKeyCounter}`,
														message: `Session "${session.title}" resumed.`,
														hideBox: true,
													}),
												);
											} else {
												onAddToChatQueue(
													React.createElement(InfoMessage, {
														key: `session-not-found-${componentKeyCounter}`,
														message: 'Most recent session not found.',
														hideBox: true,
													}),
												);
											}
										} else {
											onAddToChatQueue(
												React.createElement(InfoMessage, {
													key: `no-sessions-${componentKeyCounter}`,
													message: 'No sessions found.',
													hideBox: true,
												}),
											);
										}
									} catch (error) {
										onAddToChatQueue(
											React.createElement(ErrorMessage, {
												key: `session-error-${componentKeyCounter}`,
												message: `Error loading session: ${String(error)}`,
											}),
										);
									}
								}
								return;
							} else {
								// Check if argument is a number (for list index)
								const sessionIndex = parseInt(arg, 10);
								if (!isNaN(sessionIndex)) {
									// Resume by list index
									if (options.sessionManager) {
									  try {
									    const sessions = await options.sessionManager.listSessions();
									    if (sessionIndex < 1 || sessionIndex > sessions.length) {
									      onAddToChatQueue(
									        React.createElement(InfoMessage, {
									          key: `invalid-index-${componentKeyCounter}`,
									          message: `Invalid session index. Please choose between 1 and ${sessions.length}.`,
									          hideBox: true,
									        }),
									      );
									    } else {
									      const sessionInfo = sessions[sessionIndex - 1]; // Convert to 0-based index
									      const session = await options.sessionManager.loadSession(sessionInfo.id);
												if (session) {
													// Convert session messages to app format
													const appMessages = session.messages.map(options.convertSessionMessageToAppFormat);
												
													// Restore provider/model from session metadata if available
													if (session.metadata?.provider) {
														options.setCurrentProvider(session.metadata.provider);
													}
													if (session.metadata?.model) {
														options.setCurrentModel(session.metadata.model);
													}
												
													// Update messages with the session's messages
													options.setMessages(appMessages);
													
													// Render historical messages in the chat queue
													renderHistoricalMessages(appMessages, onAddToChatQueue, options.model);
												
													// Set current session
													options.setCurrentSession(session);
												
													onAddToChatQueue(
														React.createElement(InfoMessage, {
															key: `session-resumed-${componentKeyCounter}`,
															message: `Session "${session.title}" resumed.`,
															hideBox: true,
														}),
													);
												} else {
													onAddToChatQueue(
														React.createElement(InfoMessage, {
															key: `session-not-found-${componentKeyCounter}`,
															message: 'Session not found.',
															hideBox: true,
														}),
													);
												}
											}
										} catch (error) {
											onAddToChatQueue(
												React.createElement(ErrorMessage, {
													key: `session-error-${componentKeyCounter}`,
													message: `Error loading session: ${String(error)}`,
												}),
											);
										}
									}
									return;
								} else {
									// Resume by session ID
									if (options.sessionManager) {
									  try {
									    const session = await options.sessionManager.loadSession(arg);
											if (session) {
												// Convert session messages to app format
												const appMessages = session.messages.map(options.convertSessionMessageToAppFormat);
											
												// Restore provider/model from session metadata if available
												if (session.metadata?.provider) {
													options.setCurrentProvider(session.metadata.provider);
												}
												if (session.metadata?.model) {
													options.setCurrentModel(session.metadata.model);
												}
											
												// Update messages with the session's messages
												options.setMessages(appMessages);
												
												// Render historical messages in the chat queue
												renderHistoricalMessages(appMessages, onAddToChatQueue, options.model);
											
												// Set current session
												options.setCurrentSession(session);
											
												onAddToChatQueue(
													React.createElement(InfoMessage, {
														key: `session-resumed-${componentKeyCounter}`,
														message: `Session "${session.title}" resumed.`,
														hideBox: true,
													}),
												);
											} else {
												onAddToChatQueue(
													React.createElement(InfoMessage, {
														key: `session-not-found-${componentKeyCounter}`,
														message: 'Session not found.',
														hideBox: true,
													}),
												);
											}
										} catch (error) {
											onAddToChatQueue(
												React.createElement(ErrorMessage, {
													key: `session-error-${componentKeyCounter}`,
													message: `Error loading session: ${String(error)}`,
												}),
											);
										}
									}
									return;
								}
							}
						} else {
							onAddToChatQueue(
								React.createElement(InfoMessage, {
									key: `invalid-args-${componentKeyCounter}`,
									message: 'Invalid arguments. Usage: /resume, /resume {id}, /resume {number}, or /resume last',
									hideBox: true,
								}),
							);
							return;
						}
				} else if (commandName === 'status') {
					onShowStatus();
					return;
				}

			// Execute built-in command
			const totalTokens = messages.reduce(
				(sum, msg) => sum + options.getMessageTokens(msg),
				0,
			);
			const result = await commandRegistry.execute(message.slice(1), messages, {
				provider: options.provider,
				model: options.model,
				tokens: totalTokens,
			});
			if (result) {
				// Check if result is JSX (React element)
				if (React.isValidElement(result)) {
					onAddToChatQueue(result);
				} else if (typeof result === 'string' && result.trim()) {
					onAddToChatQueue(
						React.createElement(InfoMessage, {
							key: `command-result-${componentKeyCounter}`,
							message: result,
							hideBox: true,
						}),
					);
				}
			}
		}

		// Return here to avoid sending to LLM
		return;
	}

	// Regular chat message - process with AI
	await onHandleChatMessage(message);
}

export function createClearMessagesHandler(
	setMessages: (messages: Message[]) => void,
	client: LLMClient | null,
) {
	return async () => {
		// Clear message history and client context
		setMessages([]);
		if (client) {
			await client.clearContext();
		}
	};
}
