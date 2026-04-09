import React from 'react';
import type {ConversationStateManager} from '@/app/utils/conversation-state';
import AssistantMessage from '@/components/assistant-message';
import {ErrorMessage, InfoMessage} from '@/components/message-box';
import UserMessage from '@/components/user-message';
import {getAppConfig} from '@/config/index';
import {parseToolCalls} from '@/tool-calling/index';
import {loadTasks} from '@/tools/tasks/storage';
import type {Task} from '@/tools/tasks/types';
import type {ToolManager} from '@/tools/tool-manager';
import {isSingleToolProfile} from '@/tools/tool-profiles';
import type {TuneConfig} from '@/types/config';
import type {
	LLMClient,
	Message,
	ModeOverrides,
	ToolCall,
	ToolResult,
} from '@/types/core';
import {performAutoCompact} from '@/utils/auto-compact';
import {formatElapsedTime, getRandomAdjective} from '@/utils/completion-note';
import {MessageBuilder} from '@/utils/message-builder';
import {parseToolArguments} from '@/utils/tool-args-parser';
import {displayCompactCountsSummary} from '@/utils/tool-result-display';
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
	developmentMode: 'normal' | 'auto-accept' | 'yolo' | 'plan' | 'scheduler';
	nonInteractiveMode: boolean;
	conversationStateManager: React.MutableRefObject<ConversationStateManager>;
	onStartToolConfirmationFlow: (
		toolCalls: ToolCall[],
		updatedMessages: Message[],
		assistantMsg: Message,
		systemMessage: Message,
	) => void;
	onConversationComplete?: () => void;
	conversationStartTime?: number;
	compactToolDisplayRef?: React.RefObject<boolean>;
	onSetCompactToolCounts?: (counts: Record<string, number> | null) => void;
	compactToolCountsRef?: React.MutableRefObject<Record<string, number>>;
	onSetLiveTaskList?: (tasks: Task[] | null) => void;
	setLiveComponent?: (component: React.ReactNode) => void;
	tune?: TuneConfig;
}

// Module-level flag: show XML fallback notice only once per process lifetime.
let hasShownFallbackNotice = false;

/** Reset the fallback notice flag (for testing). */
export const resetFallbackNotice = () => {
	hasShownFallbackNotice = false;
};

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
		nonInteractiveMode,
		conversationStateManager,
		onStartToolConfirmationFlow,
		onConversationComplete,
		conversationStartTime,
		compactToolDisplayRef,
		onSetCompactToolCounts,
		compactToolCountsRef,
		onSetLiveTaskList,
		setLiveComponent,
		tune,
		developmentMode,
	} = params;

	const startTime = conversationStartTime ?? Date.now();

	// Helper to flush live task list to the static chat queue
	const flushLiveTaskList = async () => {
		if (!onSetLiveTaskList) return;
		const tasks = await loadTasks();
		if (tasks.length > 0) {
			const {TaskListDisplay} = await import('@/components/task-list-display');
			addToChatQueue(
				<TaskListDisplay
					key={`task-list-final-${getNextComponentKey()}`}
					tasks={tasks}
					title="Tasks"
				/>,
			);
		}
		onSetLiveTaskList(null);
	};

	// Track whether any task tools were executed in this conversation turn
	let hasLiveTaskUpdates = false;

	// Helper to flush accumulated compact counts to the static chat queue and clear live display
	const flushCompactCounts = () => {
		if (compactToolCountsRef) {
			const counts = compactToolCountsRef.current;
			if (Object.keys(counts).length > 0) {
				displayCompactCountsSummary(
					counts,
					addToChatQueue,
					getNextComponentKey,
				);
				compactToolCountsRef.current = {};
			}
		}
		onSetCompactToolCounts?.(null);
	};

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

	// Build mode overrides for non-interactive mode and tune settings
	const modelParameters = tune?.enabled ? tune.modelParameters : undefined;
	const nonInteractiveAlwaysAllow = nonInteractiveMode
		? (getAppConfig().alwaysAllow ?? [])
		: [];
	const modeOverrides: ModeOverrides | undefined =
		nonInteractiveMode || modelParameters
			? {
					nonInteractiveMode,
					nonInteractiveAlwaysAllow,
					modelParameters,
				}
			: undefined;

	// Get effective tools — ToolManager is the single authority for
	// availability (mode + profile filtering) and approval policy
	const availableNames =
		toolManager?.getAvailableToolNames(tune, developmentMode) ?? [];
	const tools = toolManager
		? toolManager.getEffectiveTools(availableNames, {
				nonInteractiveAlwaysAllow,
			})
		: {};

	let streamedContent = '';
	const result = await client.chat(
		[systemMessage, ...messages],
		tools,
		{
			onToken: (token: string) => {
				streamedContent += token;
				setStreamingContent(streamedContent);
			},
		},
		controller.signal,
		modeOverrides,
	);

	if (!result || !result.choices || result.choices.length === 0) {
		throw new Error('No response received from model');
	}

	const message = result.choices[0].message;
	const toolCalls = message.tool_calls || null;
	const fullContent = message.content || '';

	// Only parse text for XML tool calls on the fallback path (non-tool-calling models).
	// On the native path, response text is just text - no tool calls are embedded in it.
	const parseResult = result.toolsDisabled
		? parseToolCalls(fullContent)
		: {success: true as const, toolCalls: [], cleanedContent: fullContent};

	// Notify the user once per session when the XML fallback path is active
	if (result.toolsDisabled && !hasShownFallbackNotice) {
		hasShownFallbackNotice = true;
		addToChatQueue(
			<InfoMessage
				key={`xml-fallback-notice-${getNextComponentKey()}`}
				message="Model does not support native tool calling. Using XML fallback."
				hideBox={true}
			/>,
		);
	}

	// Check for malformed tool calls and send error back to model for self-correction
	// (only happens on the XML fallback path)
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

		// Continue the main conversation loop with error message as context
		await processAssistantResponse({
			...params,
			messages: updatedMessagesWithError,
			conversationStartTime: startTime,
		});
		return;
	}

	const parsedToolCalls = parseResult.toolCalls;
	const cleanedContent = parseResult.cleanedContent;

	// Combine native tool calls with any parsed from content (XML fallback path)
	// Native and parsed are mutually exclusive: native comes from tool-calling models,
	// parsed comes from non-tool-calling models using XML in text
	let allToolCalls = [...(toolCalls || []), ...parsedToolCalls];

	// Single-tool enforcement: truncate to first tool call
	// Active when tune profile implies single-tool (e.g. minimal profile)
	const enforceSingleTool =
		tune?.enabled && isSingleToolProfile(tune.toolProfile);
	if (enforceSingleTool && allToolCalls.length > 1) {
		allToolCalls = allToolCalls.slice(0, 1);
	}

	// If this is the final response (no tool calls), flush live displays
	// BEFORE the assistant message so they appear above it
	if (allToolCalls.length === 0) {
		flushCompactCounts();
		if (hasLiveTaskUpdates) {
			await flushLiveTaskList();
			hasLiveTaskUpdates = false;
		}
	}

	// Clear streaming content and add static message in one go so the
	// live StreamingMessage disappears at the same time the static
	// AssistantMessage appears, avoiding a visual jump.
	setStreamingContent('');
	if (cleanedContent.trim()) {
		addToChatQueue(
			<AssistantMessage
				key={`assistant-${getNextComponentKey()}`}
				message={cleanedContent}
				model={currentModel}
			/>,
		);
	}

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

	// Add the final assistant message if it has content or tool calls
	if (hasValidAssistantMessage) {
		builder.addAssistantMessage(assistantMsg);

		// Update conversation state with assistant message
		conversationStateManager.current.updateAssistantMessage(assistantMsg);
	}

	// Build the final messages array
	const updatedMessages = builder.build();

	// Update messages state once with all changes
	if (hasValidAssistantMessage) {
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

	// Clear streaming content (but don't set isGenerating=false yet —
	// we may still need to execute tools and recurse)
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

		// FIX: Satisfy the AI SDK's strict 1:1 Tool Call/Result mapping.
		// If we are aborting this turn to self-correct the bad tools,
		// we MUST provide a cancellation result for the valid tools we are skipping.
		const abortedResults: ToolResult[] = validToolCalls.map(tc => ({
			tool_call_id: tc.id,
			role: 'tool',
			name: tc.function.name,
			content:
				'Execution aborted because another tool call in this request was invalid. Please fix the invalid tool call and try again.',
		}));

		// Combine the actual errors with the aborted placeholders
		const allResultsForThisTurn = [...errorResults, ...abortedResults];

		// Send error results back to model for self-correction
		const errorBuilder = new MessageBuilder(updatedMessages);
		errorBuilder.addToolResults(allResultsForThisTurn);
		const updatedMessagesWithError = errorBuilder.build();
		setMessages(updatedMessagesWithError);

		// Continue the main conversation loop with error messages as context
		await processAssistantResponse({
			...params,
			messages: updatedMessagesWithError,
			conversationStartTime: startTime,
		});
		return;
	}

	// Handle tool calls if present - this continues the loop
	if (validToolCalls && validToolCalls.length > 0) {
		// Both native and XML fallback paths now use the same logic:
		// the SDK never auto-executes tools (execute is stripped), so we
		// evaluate needsApproval ourselves and split into direct vs confirmation.
		const toolsNeedingConfirmation: ToolCall[] = [];
		const toolsToExecuteDirectly: ToolCall[] = [];

		for (const toolCall of validToolCalls) {
			// Run validators (for XML fallback path, catches parse errors)
			let validationFailed = false;
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
						validationFailed = true;
					}
				}
			}

			// Evaluate needsApproval from tool definition
			let toolNeedsApproval = true;

			// In non-interactive mode, check the nonInteractiveAlwaysAllow list
			if (
				nonInteractiveMode &&
				nonInteractiveAlwaysAllow.includes(toolCall.function.name)
			) {
				toolNeedsApproval = false;
			} else if (toolManager) {
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
						try {
							const parsedArgs = parseToolArguments(
								toolCall.function.arguments,
							);
							toolNeedsApproval = await (
								needsApprovalProp as (
									args: unknown,
								) => boolean | Promise<boolean>
							)(parsedArgs);
						} catch {
							toolNeedsApproval = true;
						}
					}
				}
			}

			if (validationFailed || !toolNeedsApproval) {
				toolsToExecuteDirectly.push(toolCall);
			} else {
				toolsNeedingConfirmation.push(toolCall);
			}
		}

		// Execute tools that don't need confirmation (parallel via Promise.all)
		if (toolsToExecuteDirectly.length > 0) {
			const directResults = await executeToolsDirectly(
				toolsToExecuteDirectly,
				toolManager,
				conversationStateManager,
				addToChatQueue,
				getNextComponentKey,
				{
					compactDisplay: compactToolDisplayRef?.current,
					onCompactToolCount: (toolName: string) => {
						if (compactToolCountsRef) {
							const counts = compactToolCountsRef.current;
							counts[toolName] = (counts[toolName] ?? 0) + 1;
							onSetCompactToolCounts?.({...counts});
						}
					},
					onLiveTaskUpdate: () => {
						hasLiveTaskUpdates = true;
						// Load tasks and update live display
						loadTasks().then(tasks => {
							onSetLiveTaskList?.(tasks);
						});
					},
					setLiveComponent,
				},
			);

			if (directResults.length > 0) {
				// Add tool results to messages
				const directBuilder = new MessageBuilder(updatedMessages);
				directBuilder.addToolResults(directResults);
				const updatedMessagesWithTools = directBuilder.build();
				setMessages(updatedMessagesWithTools);

				// If there are also tools needing confirmation, start that flow
				if (toolsNeedingConfirmation.length > 0) {
					flushCompactCounts();
					if (hasLiveTaskUpdates) {
						await flushLiveTaskList();
						hasLiveTaskUpdates = false;
					}
					onStartToolConfirmationFlow(
						toolsNeedingConfirmation,
						updatedMessagesWithTools,
						assistantMsg,
						systemMessage,
					);
					return;
				}

				// No confirmation needed - continue conversation loop
				await processAssistantResponse({
					...params,
					messages: updatedMessagesWithTools,
					conversationStartTime: startTime,
				});
				return;
			}
		}

		// Start confirmation flow only for tools that need it
		if (toolsNeedingConfirmation.length > 0) {
			// Flush compact counts and live task list before entering confirmation or exiting
			flushCompactCounts();
			if (hasLiveTaskUpdates) {
				await flushLiveTaskList();
				hasLiveTaskUpdates = false;
			}

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
				setIsGenerating(false);
				if (onConversationComplete) {
					onConversationComplete();
				}
				return;
			}

			// Hand off to confirmation flow — it manages its own generating state
			setIsGenerating(false);
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

		// Display a "continue" message when the model produced empty text
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
			conversationStartTime: startTime,
		});
		return;
	}

	if (validToolCalls.length === 0 && cleanedContent.trim()) {
		setIsGenerating(false);
		const adjective = getRandomAdjective();
		const elapsed = formatElapsedTime(startTime);
		addToChatQueue(
			<InfoMessage
				key={`completion-time-${getNextComponentKey()}`}
				message={`Worked for a ${adjective} ${elapsed}.`}
				hideBox={true}
				marginBottom={2}
			/>,
		);
		onConversationComplete?.();
	}
};
