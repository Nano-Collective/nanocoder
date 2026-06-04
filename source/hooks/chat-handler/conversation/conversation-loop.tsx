import React from 'react';
import type {ConversationStateManager} from '@/app/utils/conversation-state';
import AssistantMessage from '@/components/assistant-message';
import AssistantReasoning from '@/components/assistant-reasoning';
import {ErrorMessage, InfoMessage} from '@/components/message-box';
import {getAppConfig} from '@/config/index';
import {MAX_EMPTY_TURNS, MAX_MALFORMED_RETRIES} from '@/constants';
import {generateKey} from '@/session/key-generator';
import {
	parseToolCalls,
	stripEmbeddedToolCallText,
	stripThinkTags,
} from '@/tool-calling/index';
import {loadTasks} from '@/tools/tasks/storage';
import type {Task} from '@/tools/tasks/types';
import type {ToolManager} from '@/tools/tool-manager';
import {isSingleToolProfile} from '@/tools/tool-profiles';
import type {TuneConfig} from '@/types/config';
import type {
	ApiUsageSnapshot,
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
import {toolNeedsApproval} from '@/utils/tool-needs-approval';
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
	setStreamingReasoning: (content: string) => void;
	setStreamingContent: (content: string) => void;
	setTokenCount: (count: number) => void;
	setMessages: (messages: Message[]) => void;
	addToChatQueue: (component: React.ReactNode) => void;
	currentProvider: string;
	currentModel: string;
	developmentMode: 'normal' | 'auto-accept' | 'yolo' | 'plan' | 'headless';
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
	reasoningExpandedRef?: React.RefObject<boolean>;
	compactToolDisplayRef?: React.RefObject<boolean>;
	onSetCompactToolCounts?: (counts: Record<string, number> | null) => void;
	compactToolCountsRef?: React.MutableRefObject<Record<string, number>>;
	onSetLiveTaskList?: (tasks: Task[] | null) => void;
	setLiveComponent?: (component: React.ReactNode) => void;
	// Records the API-reported usage of the latest response (or null to clear
	// it, e.g. after auto-compaction) so the context indicator can prefer
	// API-accurate numbers over client-side estimation.
	setLastApiUsage?: (usage: ApiUsageSnapshot | null) => void;
	tune?: TuneConfig;
	// Number of consecutive empty assistant turns that have already been
	// nudged in this loop. The empty-response branch increments and
	// recurses; every other recursion site resets to 0.
	emptyTurnCount?: number;
	// Number of consecutive malformed-XML self-correction recursions that
	// have already happened. The malformed branch increments and recurses;
	// every other recursion site resets to 0.
	malformedRetryCount?: number;
}

// Module-level flag: show XML fallback notice only once per process lifetime.
let hasShownFallbackNotice = false;

/** Reset the fallback notice flag (for testing). */
export const resetFallbackNotice = () => {
	hasShownFallbackNotice = false;
};

// Tracks whether the most recently emitted turn contained reasoning. Used by
// the next flushCompactCounts call to decide whether the summary should be
// indented (grouping beneath its Thought) or rendered flat (non-thinking
// models, where there is no Thought to group under).
let lastTurnHadReasoning = false;

/** Reset the reasoning-grouping flag (for testing). */
export const resetLastTurnHadReasoning = () => {
	lastTurnHadReasoning = false;
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
		setStreamingReasoning,
		setStreamingContent,
		setTokenCount,
		setMessages,
		addToChatQueue,
		currentProvider,
		currentModel,
		nonInteractiveMode,
		conversationStateManager,
		onStartToolConfirmationFlow,
		onConversationComplete,
		conversationStartTime,
		reasoningExpandedRef,
		compactToolDisplayRef,
		onSetCompactToolCounts,
		compactToolCountsRef,
		onSetLiveTaskList,
		setLiveComponent,
		setLastApiUsage,
		tune,
		developmentMode,
		emptyTurnCount = 0,
		malformedRetryCount = 0,
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
					key={generateKey('task-list-final')}
					tasks={tasks}
					title="Tasks"
				/>,
			);
		}
		onSetLiveTaskList(null);
	};

	// Track whether any task tools were executed in this conversation turn
	let hasLiveTaskUpdates = false;

	// Helper to flush accumulated compact counts to the static chat queue.
	// Indents the summary when the previous turn emitted reasoning (so the
	// summary groups beneath that Thought); renders flat otherwise so the
	// block doesn't look orphaned for non-thinking models.
	const flushCompactCounts = () => {
		if (compactToolCountsRef) {
			const counts = compactToolCountsRef.current;
			if (Object.keys(counts).length > 0) {
				displayCompactCountsSummary(counts, addToChatQueue, {
					indent: lastTurnHadReasoning,
				});
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
	setStreamingReasoning('');
	setTokenCount(0);
	// Drop any prior empty-response retry counter from the live area so the
	// streaming UI for this turn renders unobstructed. The counter is only
	// meant to be visible briefly between calls on consecutive empties.
	setLiveComponent?.(null);

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
	let streamedReasoning = '';
	const result = await client.chat(
		[systemMessage, ...messages],
		tools,
		{
			onToken: (token: string) => {
				streamedContent += token;
				setStreamingContent(streamedContent);
			},
			onReasoningToken: (token: string) => {
				streamedReasoning += token;
				setStreamingReasoning(streamedReasoning);
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
	// Strip <think> tags unconditionally. Providers that emit reasoning via the
	// SDK protocol (Anthropic, OpenAI o-series, Ollama with thinking) never put
	// these in text, so this is a no-op for them. Providers that stream <think>
	// as raw text (generic OpenAI-compat serving GLM/Kimi/Qwen) would otherwise
	// leak the tokens into the assistant message and conversation history.
	const fullContent = stripThinkTags(message.content || '');
	const fullReasoning = message.reasoning;

	// Tool extraction is layered:
	//   - XML fallback path (toolsDisabled): parse text for XML/JSON tool calls.
	//   - Native path with native tool calls: trust the SDK protocol, but strip
	//     any echoed XML/JSON tool-call text from the message ("Ghost Echo")
	//     so it doesn't leak into the UI or conversation history.
	//   - Native path with NO native tool calls: still parse text for XML/JSON
	//     tool calls. Open-weights models marketed as native-tool-capable
	//     sometimes regress and emit text-based tool calls instead. Without
	//     this fallback the agent stalls. Malformed shapes return success:false
	//     and feed the existing self-correction loop.
	const hasNativeToolCalls = !!toolCalls && toolCalls.length > 0;
	let parseResult: ReturnType<typeof parseToolCalls>;
	if (result.toolsDisabled) {
		parseResult = parseToolCalls(fullContent);
	} else if (hasNativeToolCalls) {
		parseResult = {
			success: true as const,
			toolCalls: [],
			cleanedContent: stripEmbeddedToolCallText(fullContent),
		};
	} else {
		parseResult = parseToolCalls(fullContent);
	}

	// Notify the user once per session when the XML fallback path is active
	if (result.toolsDisabled && !hasShownFallbackNotice) {
		hasShownFallbackNotice = true;
		addToChatQueue(
			<InfoMessage
				key={generateKey('xml-fallback-notice')}
				message="Model does not support native tool calling. Using XML fallback."
				hideBox={true}
			/>,
		);
	}

	// Check for malformed tool calls and send error back to model for self-correction
	// (only happens on the XML fallback path)
	if (!parseResult.success) {
		// Cap malformed-retry recursion. Without this, a model stuck producing
		// bad XML loops forever, appending two messages per iteration, until
		// Node's heap exhausts.
		if (malformedRetryCount >= MAX_MALFORMED_RETRIES) {
			flushCompactCounts();
			if (hasLiveTaskUpdates) {
				await flushLiveTaskList();
				hasLiveTaskUpdates = false;
			}
			addToChatQueue(
				<ErrorMessage
					key={generateKey('malformed-tool-giveup')}
					message={`Model produced malformed tool calls ${MAX_MALFORMED_RETRIES + 1} times in a row and cannot self-correct. Try rephrasing the request or switching models.`}
					hideBox={true}
				/>,
			);
			setIsGenerating(false);
			if (onConversationComplete) {
				onConversationComplete();
			}
			return;
		}

		const errorContent = `${parseResult.error}\n\n${parseResult.examples}`;

		// Display error to user
		addToChatQueue(
			<ErrorMessage
				key={generateKey('malformed-tool')}
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
			emptyTurnCount: 0,
			malformedRetryCount: malformedRetryCount + 1,
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

	// Clear streaming content and add static message in one go so the
	// live StreamingMessage disappears at the same time the static
	// AssistantMessage appears, avoiding a visual jump.
	setStreamingContent('');
	setStreamingReasoning('');

	// Flush accumulated compact counts ONLY when this turn emits narrative
	// text — a natural break in a run of tool calls. Reasoning alone does NOT
	// break the run: thinking models emit reasoning on every turn, and agentic
	// flows often run one tool per turn, so flushing on reasoning would stack
	// "Ran 1 command" / "Wrote 1 file" lines instead of combining them.
	// Letting counts accumulate across reasoning-only turns means the summary
	// combines (e.g. "Made 4 edits" instead of four stacked "Made 1 edit"
	// boxes). Residual counts are flushed at end of conversation / before
	// confirmation below.
	if (cleanedContent.trim()) {
		flushCompactCounts();
		if (hasLiveTaskUpdates) {
			await flushLiveTaskList();
			hasLiveTaskUpdates = false;
		}
	}
	if (fullReasoning) {
		// Despite reasoning stream typically finishing before text stream,
		// reasoning is still added to chat queue here to give correct
		// message order with regards to tool calling
		addToChatQueue(
			<AssistantReasoning
				key={generateKey('assistant')}
				reasoning={fullReasoning}
				expand={reasoningExpandedRef?.current ?? false}
			/>,
		);
		lastTurnHadReasoning = true;
	}
	if (cleanedContent.trim()) {
		addToChatQueue(
			<AssistantMessage
				key={generateKey('assistant')}
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
		reasoning: fullReasoning,
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

	// Build the final messages array. `let` (not const) because auto-compact
	// below may replace it with the compressed array — downstream tool-result
	// builders and recursive calls must use the compressed messages, otherwise
	// compression is silently undone the moment we recurse.
	let updatedMessages = builder.build();

	// Update messages state once with all changes
	if (hasValidAssistantMessage) {
		setMessages(updatedMessages);
	}

	// Check for auto-compact after messages are updated
	// Note: This is awaited to prevent race conditions where setMessages(compressed)
	// could overwrite newer state updates that happen while compression is in progress
	let compactionOccurred = false;
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
							key: generateKey('auto-compact-notification'),
							message: notification,
							hideBox: true,
						}),
					);
				},
				client,
			);

			if (compressed) {
				// Compression was performed — update both React state AND the local
				// variable so downstream tool execution builds on compacted messages.
				setMessages(compressed);
				updatedMessages = compressed;
				// Reset stale streaming token count to avoid double-counting
				// with calculateTokenBreakdown which already counts compacted tokens
				setTokenCount(0);
				// Replace the local array so subsequent tool-result builders
				// and recursive calls see the compressed messages instead of
				// the pre-compression copy.
				updatedMessages = compressed;
				compactionOccurred = true;
			}
		}
	} catch (_error) {
		// Silently fail auto-compact, don't interrupt the conversation
	}

	// Record the API-reported usage for the context indicator. The snapshot is
	// keyed to the post-response message count so the indicator can fall back
	// to estimation once newer messages make it stale. After compaction the
	// reported usage describes the pre-compaction context, so clear it (null)
	// and let estimation recompute against the compressed history.
	if (setLastApiUsage) {
		const usage = result.usage;
		const hasReportedUsage =
			!compactionOccurred &&
			!!usage &&
			(usage.inputTokens !== undefined || usage.outputTokens !== undefined);
		setLastApiUsage(
			hasReportedUsage
				? {
						inputTokens: usage.inputTokens,
						outputTokens: usage.outputTokens,
						totalTokens: usage.totalTokens,
						atMessageCount: updatedMessages.length,
					}
				: null,
		);
	}

	// Clear streaming content (but don't set isGenerating=false yet —
	// we may still need to execute tools and recurse)
	setStreamingContent('');
	setStreamingReasoning('');

	// Handle error results for non-existent tools
	if (errorResults.length > 0) {
		// Display error messages to user
		for (const error of errorResults) {
			addToChatQueue(
				<ErrorMessage
					key={generateKey(`unknown-tool-${error.tool_call_id}`)}
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
			emptyTurnCount: 0,
			malformedRetryCount: 0,
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
			let needsApproval = true;

			// In non-interactive mode, check the nonInteractiveAlwaysAllow list
			if (
				nonInteractiveMode &&
				nonInteractiveAlwaysAllow.includes(toolCall.function.name)
			) {
				needsApproval = false;
			} else if (toolManager) {
				const toolEntry = toolManager.getToolEntry(toolCall.function.name);
				needsApproval = await toolNeedsApproval(
					toolEntry?.tool,
					toolCall.function.arguments,
				);
			}

			if (validationFailed || !needsApproval) {
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
					nonInteractiveMode,
					signal: controller.signal,
				},
			);

			if (directResults.length > 0) {
				// Add tool results to messages
				const directBuilder = new MessageBuilder(updatedMessages);
				directBuilder.addToolResults(directResults);
				const updatedMessagesWithTools = directBuilder.build();
				setMessages(updatedMessagesWithTools);
				updatedMessages = updatedMessagesWithTools;

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
					emptyTurnCount: 0,
					malformedRetryCount: 0,
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
						key={generateKey('tool-approval-required')}
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
		// Cap consecutive empty turns. Without this, a model that keeps
		// returning nothing (common with GPT-5 reasoning that exhausts the
		// token budget on thinking) would loop forever.
		if (emptyTurnCount >= MAX_EMPTY_TURNS) {
			setLiveComponent?.(null);
			flushCompactCounts();
			if (hasLiveTaskUpdates) {
				await flushLiveTaskList();
				hasLiveTaskUpdates = false;
			}
			addToChatQueue(
				<ErrorMessage
					key={generateKey('empty-response-giveup')}
					message={`Model produced no output after ${MAX_EMPTY_TURNS + 1} attempts. The model may be exhausting its token budget on reasoning, or the request may have been refused. Try rephrasing, lowering reasoning effort, or switching models.`}
					hideBox={true}
				/>,
			);
			setIsGenerating(false);
			if (onConversationComplete) {
				onConversationComplete();
			}
			return;
		}

		// Check if we just executed tools (updatedMessages should have tool results)
		const lastMessage = updatedMessages[updatedMessages.length - 1];
		const hasRecentToolResults = lastMessage?.role === 'tool';

		// Pick a nudge that matches the failure mode. A reasoning-only turn
		// gets a different prompt than a totally silent one — telling the
		// model "you produced reasoning but no answer" is more actionable
		// than a generic "continue".
		let nudgeContent: string;
		if (fullReasoning && fullReasoning.trim()) {
			nudgeContent =
				'You produced reasoning but no final response. Please provide your answer based on your reasoning above.';
		} else if (hasRecentToolResults) {
			nudgeContent =
				'Please provide a summary or response based on the tool results above.';
		} else {
			nudgeContent = 'Please continue with the task.';
		}

		const nudgeMessage: Message = {
			role: 'user',
			content: nudgeContent,
		};

		// Coalesce auto-nudge notices into a single live counter that
		// updates in place between turns instead of stacking N
		// InfoMessages in scrollback. The counter is visible briefly
		// between the empty turn and the next streaming response, then
		// gets cleared at the top of processAssistantResponse so the
		// streaming UI for the retry is unobstructed.
		const attempt = emptyTurnCount + 1;
		const total = MAX_EMPTY_TURNS + 1;
		setLiveComponent?.(
			<InfoMessage
				key="auto-continue-counter"
				message={`Empty response — retry ${attempt}/${total}: "${nudgeContent}"`}
				hideBox={true}
			/>,
		);

		// Lock any live task panel from the prior turn into scrollback so
		// the next turn's UI starts clean — same pattern as the give-up,
		// confirmation-flow, and natural-end branches.
		flushCompactCounts();
		if (hasLiveTaskUpdates) {
			await flushLiveTaskList();
			hasLiveTaskUpdates = false;
		}

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
			emptyTurnCount: emptyTurnCount + 1,
			malformedRetryCount: 0,
		});
		return;
	}

	if (validToolCalls.length === 0 && cleanedContent.trim()) {
		// Flush any residual compact counts and task updates from turns that
		// didn't emit reasoning so they persist in scrollback at conversation end.
		flushCompactCounts();
		if (hasLiveTaskUpdates) {
			await flushLiveTaskList();
			hasLiveTaskUpdates = false;
		}

		setIsGenerating(false);
		const adjective = getRandomAdjective();
		const elapsed = formatElapsedTime(startTime);
		addToChatQueue(
			<InfoMessage
				key={generateKey('completion-time')}
				message={`Worked for a ${adjective} ${elapsed}.`}
				hideBox={true}
				marginBottom={2}
			/>,
		);
		onConversationComplete?.();
	}
};
