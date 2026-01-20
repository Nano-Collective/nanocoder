import React from 'react';
import type {ConversationStateManager} from '@/app/utils/conversation-state';
import AssistantMessage from '@/components/assistant-message';
import {ErrorMessage, InfoMessage} from '@/components/message-box';
import UserMessage from '@/components/user-message';
import {appConfig, getAppConfig} from '@/config/index';
import {getCurrentMode} from '@/context/mode-context';
import {parseToolCalls} from '@/tool-calling/index';
import type {ToolManager} from '@/tools/tool-manager';
import type {LLMClient, Message, ToolCall, ToolResult} from '@/types/core';
import {performAutoCompact} from '@/utils/auto-compact';
import {MessageBuilder} from '@/utils/message-builder';
import {processPhaseTransition} from '@/utils/plan/phase-transition-detector';
import {parseToolArguments} from '@/utils/tool-args-parser';
import {displayToolResult} from '@/utils/tool-result-display';
import {filterValidToolCalls} from '../utils/tool-filters';
import {executeToolsDirectly} from './tool-executor';

interface ProcessAssistantResponseParams {
	systemMessage: Message;
	messages: Message[];
	client: LLMClient;
	toolManager: ToolManager | null;
	abortController: AbortController | null;
	setAbortController: (controller: AbortController | null) => void;
	setIsGenerating: (generating: boolean) => void;
	setStreamingContent: (content: string) => void;
	setTokenCount: (count: number) => void;
	setMessages: (messages: Message[]) => void;
	addToChatQueue: (component: React.ReactNode) => void;
	getNextComponentKey: () => number;
	currentProvider: string;
	currentModel: string;
	developmentMode: 'normal' | 'auto-accept' | 'plan';
	nonInteractiveMode: boolean;
	conversationStateManager: React.MutableRefObject<ConversationStateManager>;
	onStartToolConfirmationFlow: (
		toolCalls: ToolCall[],
		updatedMessages: Message[],
		assistantMsg: Message,
		systemMessage: Message,
	) => void;
	onConversationComplete?: () => void;
	setPlanPhase?: (phase: import('@/types/core').PlanPhase) => void;
}

/**
 * Main conversation loop that processes assistant responses and handles tool calls.
 * This function orchestrates the entire conversation flow including:
 * - Streaming responses from the LLM
 * - Parsing and validating tool calls
 * - Executing or requesting confirmation for tools
 * - Handling errors and self-correction
 * - Managing the conversation state
 */
export const processAssistantResponse = async (
	params: ProcessAssistantResponseParams,
): Promise<void> => {
	const {
		systemMessage,
		messages,
		client,
		toolManager,
		abortController,
		setAbortController,
		setIsGenerating,
		setStreamingContent,
		setTokenCount,
		setMessages,
		addToChatQueue,
		getNextComponentKey,
		currentProvider,
		currentModel,
		developmentMode,
		nonInteractiveMode,
		conversationStateManager,
		onStartToolConfirmationFlow,
		onConversationComplete,
		setPlanPhase,
	} = params;

	// Ensure we have an abort controller for this request
	let controller = abortController;
	if (!controller) {
		controller = new AbortController();
		setAbortController(controller);
	}

	// Use streaming with callbacks
	setIsGenerating(true);
	setStreamingContent('');
	setTokenCount(0);

	const result = await client.chat(
		[systemMessage, ...messages],
		toolManager?.getAllTools() || {},
		{
			onToolExecuted: (toolCall: ToolCall, result: string) => {
				// Display formatter for auto-executed tools (after execution with results)
				void (async () => {
					const toolResult: ToolResult = {
						tool_call_id: toolCall.id,
						role: 'tool' as const,
						name: toolCall.function.name,
						content: result,
					};
					await displayToolResult(
						toolCall,
						toolResult,
						toolManager,
						addToChatQueue,
						getNextComponentKey,
					);
				})();
			},
			onFinish: () => {
				setIsGenerating(false);
			},
		},
		controller.signal,
	);

	if (!result || !result.choices || result.choices.length === 0) {
		throw new Error('No response received from model');
	}

	const message = result.choices[0].message;
	const toolCalls = message.tool_calls || null;
	const fullContent = message.content || '';

	// Parse any tool calls from content for non-tool-calling models
	const parseResult = parseToolCalls(fullContent);

	// Check for malformed tool calls and send error back to model for self-correction
	if (!parseResult.success) {
		const errorContent = `${parseResult.error}\n\n${parseResult.examples}`;

		// Display error to user
		addToChatQueue(
			<ErrorMessage
				key={`malformed-tool-${Date.now()}`}
				message={errorContent}
				hideBox={true}
			/>,
		);

		// Create assistant message with the malformed content (so model knows what it said)
		const assistantMsgWithError: Message = {
			role: 'assistant',
			content: fullContent,
		};

		// Create a user message with the error feedback for the model
		const errorFeedbackMessage: Message = {
			role: 'user',
			content: `Your previous response contained a malformed tool call. ${errorContent}\n\nPlease try again using the correct format.`,
		};

		// Update messages and continue conversation loop for self-correction
		const malformedBuilder = new MessageBuilder(messages);
		malformedBuilder
			.addAssistantMessage(assistantMsgWithError)
			.addMessage(errorFeedbackMessage);
		const updatedMessagesWithError = malformedBuilder.build();
		setMessages(updatedMessagesWithError);

		// Clear streaming state before recursing
		setIsGenerating(false);
		setStreamingContent('');

		// Continue the main conversation loop with error message as context
		await processAssistantResponse({
			...params,
			messages: updatedMessagesWithError,
		});
		return;
	}

	const parsedToolCalls = parseResult.toolCalls;
	const cleanedContent = parseResult.cleanedContent;

	// Detect plan mode phase transitions in AI response
	// This updates both global context and React state when phase changes
	if (developmentMode === 'plan' && cleanedContent.trim()) {
		const phaseChanged = processPhaseTransition(cleanedContent);
		if (phaseChanged && setPlanPhase) {
			// Import here to avoid circular dependency
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			const {getPlanPhase} = await import('@/context/mode-context');
			const newPhase = getPlanPhase();
			setPlanPhase(newPhase);
		}
	}

	// Display the assistant response (cleaned of any tool calls)
	if (cleanedContent.trim()) {
		addToChatQueue(
			<AssistantMessage
				key={`assistant-${getNextComponentKey()}`}
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

	// Add assistant message to conversation history only if it has content or tool_calls
	// Empty assistant messages cause API errors: "Assistant message must have either content or tool_calls"
	const assistantMsg: Message = {
		role: 'assistant',
		content: cleanedContent,
		tool_calls: validToolCalls.length > 0 ? validToolCalls : undefined,
	};

	const hasValidAssistantMessage =
		cleanedContent.trim() || validToolCalls.length > 0;

	// Build updated messages array using MessageBuilder
	const builder = new MessageBuilder(messages);

	// Add auto-executed messages (assistant + tool results) from AI SDK multi-step execution
	// This ensures they're counted in usage tracking and included in context
	if (result.autoExecutedMessages && result.autoExecutedMessages.length > 0) {
		builder.addAutoExecutedMessages(result.autoExecutedMessages);
	}

	// Add the final assistant message if it has content or tool calls
	if (hasValidAssistantMessage) {
		builder.addAssistantMessage(assistantMsg);

		// Update conversation state with assistant message
		conversationStateManager.current.updateAssistantMessage(assistantMsg);
	}

	// Build the final messages array
	const updatedMessages = builder.build();

	// Update messages state once with all changes
	if (
		(result.autoExecutedMessages && result.autoExecutedMessages.length > 0) ||
		hasValidAssistantMessage
	) {
		setMessages(updatedMessages);
	}

	// Check for auto-compact after messages are updated
	// Note: This is awaited to prevent race conditions where setMessages(compressed)
	// could overwrite newer state updates that happen while compression is in progress
	try {
		const config = getAppConfig();
		const autoCompactConfig = config.autoCompact;

		if (autoCompactConfig) {
			const compressed = await performAutoCompact(
				updatedMessages,
				systemMessage,
				currentProvider,
				currentModel,
				autoCompactConfig,
				notification => {
					// Show notification
					addToChatQueue(
						React.createElement(InfoMessage, {
							key: `auto-compact-notification-${getNextComponentKey()}`,
							message: notification,
							hideBox: true,
						}),
					);
				},
			);

			if (compressed) {
				// Compression was performed, update messages
				setMessages(compressed);
			}
		}
	} catch (_error) {
		// Silently fail auto-compact, don't interrupt the conversation
	}

	// Clear streaming state after response is complete
	setIsGenerating(false);
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
		const errorBuilder = new MessageBuilder(updatedMessages);
		errorBuilder.addToolResults(errorResults);
		const updatedMessagesWithError = errorBuilder.build();
		setMessages(updatedMessagesWithError);

		// Continue the main conversation loop with error messages as context
		await processAssistantResponse({
			...params,
			messages: updatedMessagesWithError,
		});
		return;
	}

	// Handle tool calls if present - this continues the loop
	if (validToolCalls && validToolCalls.length > 0) {
		// Separate tools that need confirmation vs those that don't
		// Use centralized ToolManager approval logic for consistent behavior
		const toolsNeedingConfirmation: ToolCall[] = [];
		const toolsToExecuteDirectly: ToolCall[] = [];

		// Tools that are permitted to auto-run in non-interactive mode
		const nonInteractiveAllowList = new Set(appConfig.alwaysAllow ?? []);

		for (const toolCall of validToolCalls) {
			// Check if tool has a validator
			let validationFailed = false;

			// XML validation errors are treated as validation failures
			if (toolCall.function.name === '__xml_validation_error__') {
				validationFailed = true;
			} else if (toolManager) {
				const validator = toolManager.getToolValidator(toolCall.function.name);
				if (validator) {
					try {
						const parsedArgs = parseToolArguments(toolCall.function.arguments);

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

			// Use centralized ToolManager approval logic
			// This provides consistent plan mode filtering across all tools
			const canExecuteWithoutConfirmation = toolManager
				? toolManager.shouldExecuteWithoutConfirmation(
						toolCall.function.name,
						validationFailed,
					)
				: false;

			// Execute directly if:
			// 1. Validation failed (need to send error back to model)
			// 2. Tool is allowed to execute without confirmation (per ToolManager)
			if (validationFailed || canExecuteWithoutConfirmation) {
				// Check tool's needsApproval property from the tool definition
				let toolNeedsApproval = true; // Default to requiring approval for safety
				if (toolManager) {
					const toolEntry = toolManager.getToolEntry(toolCall.function.name);
					if (toolEntry?.tool) {
						const needsApprovalProp = (
							toolEntry.tool as unknown as {
								needsApproval?:
									| boolean
									| ((args: unknown) => boolean | Promise<boolean>);
							}
						).needsApproval;
						if (typeof needsApprovalProp === 'boolean') {
							toolNeedsApproval = needsApprovalProp;
						} else if (typeof needsApprovalProp === 'function') {
							// Evaluate function - our tools use getCurrentMode() internally
							// and don't actually need the args parameter
							try {
								const parsedArgs = parseToolArguments(
									toolCall.function.arguments,
								);
								// Cast to any to handle AI SDK type signature mismatch
								// Our tool implementations don't use the second parameter
								toolNeedsApproval = await (
									needsApprovalProp as (
										args: unknown,
									) => boolean | Promise<boolean>
								)(parsedArgs);
							} catch {
								// If evaluation fails, require approval for safety
								toolNeedsApproval = true;
							}
						}
					}
				}

				// Execute directly if:
				// 1. Validation failed (need to send error back to model)
				// 2. Tool has needsApproval: false
				// 3. Explicitly allowed in non-interactive mode
				// 4. In auto-accept mode (except bash which always needs approval)
				const isBashTool = toolCall.function.name === 'execute_bash';
				const isNonInteractiveAllowed =
					nonInteractiveMode &&
					nonInteractiveAllowList.has(toolCall.function.name);
				const shouldExecuteDirectly =
					validationFailed ||
					!toolNeedsApproval ||
					isNonInteractiveAllowed ||
					(developmentMode === 'auto-accept' && !isBashTool);

				if (shouldExecuteDirectly) {
					toolsToExecuteDirectly.push(toolCall);
				} else {
					toolsNeedingConfirmation.push(toolCall);
				}
			}

			// Execute non-confirmation tools directly
			if (toolsToExecuteDirectly.length > 0) {
				const directResults = await executeToolsDirectly(
					toolsToExecuteDirectly,
					toolManager,
					conversationStateManager,
					addToChatQueue,
					getNextComponentKey,
				);

				// If we have results, continue the conversation with them
				if (directResults.length > 0) {
					// Add tool results to messages
					const directBuilder = new MessageBuilder(updatedMessages);
					directBuilder.addToolResults(directResults);
					const updatedMessagesWithTools = directBuilder.build();
					setMessages(updatedMessagesWithTools);

					// Continue the main conversation loop with tool results as context
					// In plan mode, this ensures the LLM continues its analysis
					await processAssistantResponse({
						...params,
						messages: updatedMessagesWithTools,
					});
					return;
				}

				// Edge case: Tools were executed but returned no results
				// This shouldn't happen normally, but if it does, continue anyway
				// Add a continuation prompt to keep the conversation going
				const continuationPrompt: Message = {
					role: 'user',
					content:
						'Please continue with your analysis based on the tools you just executed.',
				};

				const continuationBuilder = new MessageBuilder(updatedMessages);
				continuationBuilder.addMessage(continuationPrompt);
				const updatedMessagesWithContinuation = continuationBuilder.build();
				setMessages(updatedMessagesWithContinuation);

				await processAssistantResponse({
					...params,
					messages: updatedMessagesWithContinuation,
				});
				return;
			}

			// Start confirmation flow only for tools that need it
			if (toolsNeedingConfirmation.length > 0) {
				// In non-interactive mode, exit when tool approval is required
				if (nonInteractiveMode) {
					const toolNames = toolsNeedingConfirmation
						.map(tc => tc.function.name)
						.join(', ');
					const errorMsg = `Tool approval required for: ${toolNames}. Exiting non-interactive mode`;

					// Add error message to UI
					addToChatQueue(
						<ErrorMessage
							key={`tool-approval-required-${Date.now()}`}
							message={errorMsg}
							hideBox={true}
						/>,
					);

					// Add error to messages array so exit detection can find it
					const errorMessage: Message = {
						role: 'assistant',
						content: errorMsg,
					};
					// Use updatedMessages which already includes auto-executed tool results
					const errorBuilder = new MessageBuilder(updatedMessages);
					errorBuilder.addMessage(errorMessage);
					setMessages(errorBuilder.build());

					// Signal completion to trigger exit
					if (onConversationComplete) {
						onConversationComplete();
					}
					return;
				}

				// Pass complete messages including assistant msg
				// useToolHandler will add tool results
				onStartToolConfirmationFlow(
					toolsNeedingConfirmation,
					updatedMessages, // Includes assistant message
					assistantMsg,
					systemMessage,
				);
			}
		}

		// If no tool calls, the conversation naturally ends here
		// BUT: if there's ALSO no content, that's likely an error - the model should have said something
		// Auto-reprompt to help the model continue
		if (validToolCalls.length === 0 && !cleanedContent.trim()) {
			// Check if we just executed tools (updatedMessages should have tool results)
			const lastMessage = updatedMessages[updatedMessages.length - 1];
			const hasRecentToolResults = lastMessage?.role === 'tool';

			// Add a continuation message to help the model respond
			// For recent tool results, ask for a summary; otherwise, ask to continue
			const nudgeContent = hasRecentToolResults
				? 'Please provide a summary or response based on the tool results above.'
				: 'Please continue with the task.';

			const nudgeMessage: Message = {
				role: 'user',
				content: nudgeContent,
			};

			// Display a "continue" message in chat so user knows what happened
			addToChatQueue(
				<UserMessage
					key={`auto-continue-${getNextComponentKey()}`}
					message="continue"
				/>,
			);

			// Don't include the empty assistantMsg - it would cause API error
			// "Assistant message must have either content or tool_calls"
			const nudgeBuilder = new MessageBuilder(updatedMessages);
			nudgeBuilder.addMessage(nudgeMessage);
			const updatedMessagesWithNudge = nudgeBuilder.build();
			setMessages(updatedMessagesWithNudge);

			// Continue the conversation loop with the nudge
			await processAssistantResponse({
				...params,
				messages: updatedMessagesWithNudge,
			});
			return;
		}

		if (validToolCalls.length === 0 && cleanedContent.trim()) {
			const currentMode = getCurrentMode();
			// In plan mode, don't auto-complete - continue the workflow
			// Plan mode is a multi-phase autonomous workflow that should continue
			// through all phases until exit_plan_mode is called
			if (currentMode === 'plan') {
				// Import here to avoid circular dependency
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				const {getPlanPhase} = await import('@/context/mode-context');
				const currentPhase = getPlanPhase();

				// Create phase-aware continuation prompt
				let phasePrompt = '';
				switch (currentPhase) {
					case 'understanding':
						phasePrompt =
							'Please continue by creating the proposal.md document with your findings, then move to the Design phase.';
						break;
					case 'design':
						phasePrompt =
							'Please continue by creating the design.md document with your technical decisions, then move to the Review phase.';
						break;
					case 'review':
						phasePrompt =
							'Please continue by creating the spec.md document with requirements and Gherkin scenarios, then move to the Final Plan phase.';
						break;
					case 'final':
						phasePrompt =
							'Please continue by creating the tasks.md and plan.md documents, then call the exit-plan-mode tool.';
						break;
					default:
						phasePrompt =
							'Please continue with the next phase of the plan workflow. Create the required documents and move forward.';
				}

				// Add a continuation prompt to move to the next phase
				const phaseBuilder = new MessageBuilder(updatedMessages);
				phaseBuilder.addMessage({
					role: 'user',
					content: phasePrompt,
				});
				const updatedMessagesWithPhasePrompt = phaseBuilder.build();
				setMessages(updatedMessagesWithPhasePrompt);

				// Continue the conversation loop
				await processAssistantResponse({
					...params,
					messages: updatedMessagesWithPhasePrompt,
				});
				return;
			}

			// In other modes, complete the conversation
			onConversationComplete?.();
		}
	}
};
