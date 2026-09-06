import React from 'react';
import type {ConversationStateManager} from '@/app/utils/conversation-state';
import {
	createWalkthroughLifecycle,
	observeSuccessfulLifecycleTool,
	takeWalkthroughFallback,
	type WalkthroughLifecycle,
} from '@/artifacts/walkthrough-lifecycle';
import AssistantMessage from '@/components/assistant-message';
import AssistantReasoning from '@/components/assistant-reasoning';
import {ErrorMessage, InfoMessage} from '@/components/message-box';
import {getAppConfig, getRetryLimits} from '@/config/index';
import {getShowUsageFooter} from '@/config/preferences';
import {
	MAX_COMPACT_RETRIES,
	TOOL_APPROVAL_REQUIRED_KIND,
	TOOL_APPROVAL_REQUIRED_PREFIX,
} from '@/constants';
import {runPreToolUseGate} from '@/services/lifecycle-hooks';
import {generateKey} from '@/session/key-generator';
import {
	parseToolCalls,
	stripEmbeddedToolCallText,
	stripThinkTags,
} from '@/tool-calling/index';
import {resolveToolApproval} from '@/tools/approval-policy';
import {loadTasks} from '@/tools/tasks/storage';
import type {Task} from '@/tools/tasks/types';
import type {ToolManager} from '@/tools/tool-manager';
import {isSingleToolProfile} from '@/tools/tool-profiles';
import type {TuneConfig} from '@/types/config';
import type {
	ApiCallRecord,
	ApiUsageSnapshot,
	LLMClient,
	Message,
	ModeOverrides,
	ToolCall,
	ToolResult,
} from '@/types/core';
import {buildResponseUsageBounded} from '@/usage/response-usage';
import {maybeAutoCompact} from '@/utils/auto-compact';
import {buildCompletionNote} from '@/utils/completion-note';
import {MessageBuilder} from '@/utils/message-builder';
import {capMessagesForModel} from '@/utils/message-capping';
import {compressMessages} from '@/utils/message-compression';
import {infoMsg} from '@/utils/message-factory';
import {getLastBuiltPrompt} from '@/utils/prompt-builder';
import {signalQuestion} from '@/utils/question-queue';
import {calculateTokens} from '@/utils/token-calculator';
import {parseToolArguments} from '@/utils/tool-args-parser';
import {
	createApprovalUnavailableResults,
	createCancellationResults,
} from '@/utils/tool-cancellation';
import {signalToolConfirm} from '@/utils/tool-confirm-queue';
import {displayCompactCountsSummary} from '@/utils/tool-result-display';
import {closeAllDiffsInVSCode} from '@/vscode/index';
import {
	buildAbandonedTurnMessages,
	filterValidToolCalls,
} from '../utils/tool-filters';
import {computeToolCallSignature} from '../utils/tool-signature';
import {buildAutoDiagnosticsMessage} from './auto-diagnostics';
import {
	displayExecutedTool,
	executeApprovedTool,
	executeToolsDirectly,
} from './tool-executor';

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
	// Live mode ref, read per tool call so a mid-turn mode switch (e.g. flipping
	// to yolo while tools execute) is honored immediately. Falls back to the
	// snapshot `developmentMode` for callers that don't supply a ref (subagents,
	// plain shell).
	developmentModeRef?: React.RefObject<
		'normal' | 'auto-accept' | 'yolo' | 'plan' | 'headless'
	>;
	nonInteractiveMode: boolean;
	conversationStateManager: React.MutableRefObject<ConversationStateManager>;
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
	// Pushes a per-call record after each successful API response so the
	// /usage command can compute accurate per-provider costs from real
	// provider-reported token counts rather than client-side estimates.
	onApiCallComplete?: (record: ApiCallRecord) => void;
	tune?: TuneConfig;
	privacySessionMapRef?: React.MutableRefObject<Record<string, string>>;
	privacyEnabled?: boolean;
	sessionId?: string;
	workingDirectory?: string;
	onPrivacyEvent?: (scrubbedDelta: number) => void;
	onToolExecuted?: (toolName: string) => void;
	onFinalAssistantText?: (content: string) => void;
	// Number of consecutive empty assistant turns that have already been
	// nudged in this loop. The empty-response branch increments and
	// recurses; every other recursion site resets to 0.
	emptyTurnCount?: number;
	// Number of consecutive malformed tool-call self-correction recursions
	// that have already happened, on any text-parsed path (XML fallback or a
	// native response that emitted tool-call text). The malformed branch
	// increments and recurses; every other recursion site resets to 0.
	malformedRetryCount?: number;
	// Number of compact-and-retry cycles attempted after exhausting empty-turn
	// nudges. Once MAX_COMPACT_RETRIES is reached we surface the error.
	compactRetryCount?: number;
	// Signature of the tool call(s) executed on the immediately preceding turn.
	// Used to detect an identical-call loop. The tool-execution continuation
	// threads it forward; every other recursion site resets it to undefined.
	lastToolSignature?: string;
	// How many consecutive turns have emitted the same tool-call signature
	// within the current window. Reaching the configured repeated-call limit
	// pauses to ask the user (interactive) or stops with an actionable error
	// (non-interactive). Resets to 0 when the user grants another window.
	repeatedToolCallCount?: number;
	// How many consecutive turns have emitted the same tool-call signature in
	// total, across every window the user granted. Never reset by a granted
	// continuation, so user-facing counts report the true repetition streak.
	repeatedToolCallTotal?: number;
	walkthroughLifecycle?: WalkthroughLifecycle;
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
		onConversationComplete,
		conversationStartTime,
		reasoningExpandedRef,
		compactToolDisplayRef,
		onSetCompactToolCounts,
		compactToolCountsRef,
		onSetLiveTaskList,
		setLiveComponent,
		setLastApiUsage,
		onApiCallComplete,
		tune,
		developmentMode,
		developmentModeRef,
		emptyTurnCount = 0,
		malformedRetryCount = 0,
		compactRetryCount = 0,
		lastToolSignature,
		repeatedToolCallCount = 0,
		repeatedToolCallTotal = 0,
		privacySessionMapRef,
		privacyEnabled = false,
		onPrivacyEvent,
		onToolExecuted,
		sessionId,
		workingDirectory,
	} = params;
	const walkthroughLifecycle =
		params.walkthroughLifecycle ?? createWalkthroughLifecycle(messages);

	const startTime = conversationStartTime ?? Date.now();

	// Agent-loop retry limits: configurable via `nanocoder.retries` in
	// agents.config.json, falling back to the historical hardcoded caps.
	const {maxRepeatedToolCalls, maxEmptyTurns, maxMalformedRetries} =
		getRetryLimits();

	// Helper to flush live task list to the static chat queue
	const flushLiveTaskList = async () => {
		if (!onSetLiveTaskList) return;
		const tasks = await loadTasks(sessionId);
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

	// Flush both the compact-count summary and any pending live task list.
	// Called at every turn boundary, so it lives in one place.
	const flushAll = async () => {
		flushCompactCounts();
		if (hasLiveTaskUpdates) {
			await flushLiveTaskList();
			hasLiveTaskUpdates = false;
		}
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
					privacySessionMapRef,
					privacyEnabled,
				}
			: {
					nonInteractiveMode: false,
					nonInteractiveAlwaysAllow: [],
					modelParameters,
					privacySessionMapRef,
					privacyEnabled,
				};

	// Get effective tools — ToolManager is the single authority for
	// availability (mode + profile filtering) and approval policy
	const availableNames =
		toolManager?.getAvailableToolNames(
			tune,
			developmentMode,
			undefined,
			currentModel,
		) ?? [];
	const tools = toolManager ? toolManager.getFilteredTools(availableNames) : {};

	let streamedContent = '';
	let streamedReasoning = '';

	// Apply maxMessages cap: limit how many history messages are sent to the
	// model. This is a model-context concern only - the full history is always
	// written to disk by useSessionAutosave. The system message is prepended
	// outside the slice and is never counted against the limit.
	const sessionConfig = getAppConfig().sessions;
	const maxMessages = sessionConfig?.maxMessages ?? 1000;
	const cappedMessages = capMessagesForModel(messages, maxMessages);

	const result = await client.chat(
		[systemMessage, ...cappedMessages],
		tools,
		{
			onToken: (token: string) => {
				streamedContent += token;
				setStreamingContent(streamedContent);
				// Feed the in-flight reply into the context-usage estimate so the
				// `~%` indicator climbs as the model writes, instead of only
				// stepping up once the finished message is committed to history.
				setTokenCount(calculateTokens(streamedContent));
			},
			onReasoningToken: (token: string) => {
				streamedReasoning += token;
				setStreamingReasoning(streamedReasoning);
			},
			onPrivacyEvent,
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

	// Check for malformed tool calls and send error back to model for
	// self-correction. Reachable from any text-parsed path: the XML fallback,
	// and native responses that emit tool-call text instead of native calls.
	if (!parseResult.success) {
		// Cap malformed-retry recursion. Without this, a model stuck producing
		// bad XML loops forever, appending two messages per iteration, until
		// Node's heap exhausts.
		if (malformedRetryCount >= maxMalformedRetries) {
			await flushAll();
			addToChatQueue(
				<ErrorMessage
					key={generateKey('malformed-tool-giveup')}
					message={`Model produced malformed tool calls ${maxMalformedRetries + 1} times in a row and cannot self-correct. Try rephrasing the request or switching models.`}
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
			abortController: controller,
			messages: updatedMessagesWithError,
			conversationStartTime: startTime,
			emptyTurnCount: 0,
			malformedRetryCount: malformedRetryCount + 1,
			lastToolSignature: undefined,
			repeatedToolCallCount: 0,
			repeatedToolCallTotal: 0,
			walkthroughLifecycle,
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
		tune?.enabled && isSingleToolProfile(tune.toolProfile, currentModel);
	if (enforceSingleTool && allToolCalls.length > 1) {
		allToolCalls = allToolCalls.slice(0, 1);
	}

	// Clear streaming content and add static message in one go so the
	// live StreamingMessage disappears at the same time the static
	// AssistantMessage appears, avoiding a visual jump.
	setStreamingContent('');
	setStreamingReasoning('');
	// The reply is about to be committed to history (counted by
	// calculateTokenBreakdown). Drop the in-flight streaming estimate so the
	// context-usage figure doesn't count this turn's text twice.
	setTokenCount(0);

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
		await flushAll();
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
		// Provider-reported tokens + estimated cost for this API call, shown
		// as the footer of the message. The lookup is bounded: token counts
		// are known synchronously and always render; the cost segment joins
		// only if (memoized) pricing resolves within the ceiling, so a cold
		// or offline models.dev fetch can never hold up the message swap.
		// Skipped entirely when the footer is off, so the pricing lookup
		// never runs for users who opted out.
		// Read per message rather than snapshotting at launch, so toggling the
		// setting mid-session takes effect on the very next response.
		const showUsageFooter = getShowUsageFooter();
		const responseUsage = showUsageFooter
			? await buildResponseUsageBounded(result.usage, currentModel)
			: undefined;
		addToChatQueue(
			<AssistantMessage
				key={generateKey('assistant')}
				message={cleanedContent}
				model={currentModel}
				usage={responseUsage}
				showUsageFooter={showUsageFooter}
			/>,
		);
	}

	const partition = filterValidToolCalls(allToolCalls, toolManager);
	const {validToolCalls, errorResults} = partition;
	const {emittedToolCalls, resultsForAbandonedTurn} =
		buildAbandonedTurnMessages(partition);

	// Add assistant message to conversation history only if it has content or tool_calls
	// Empty assistant messages cause API errors: "Assistant message must have either content or tool_calls"
	const assistantMsg: Message = {
		role: 'assistant',
		content: cleanedContent,
		tool_calls: emittedToolCalls.length > 0 ? emittedToolCalls : undefined,
		reasoning: fullReasoning,
	};

	const hasValidAssistantMessage =
		cleanedContent.trim() || emittedToolCalls.length > 0;

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
		const beforeCompact = updatedMessages;
		updatedMessages = await maybeAutoCompact(
			updatedMessages,
			systemMessage,
			client,
			// Native tool definitions occupy context out-of-band. Pass them so
			// the gate matches the ctx% indicator; under XML/JSON fallback they
			// already live inside systemMessage, so pass nothing to avoid
			// double-counting.
			result.toolsDisabled ? undefined : tools,
			{
				signal: controller.signal,
				onNotify: notification => {
					addToChatQueue(infoMsg(notification, 'auto-compact-notification'));
				},
				// The TUI tracks the active provider/model in app state; use those
				// rather than re-deriving them from the client, which may lag a
				// pending switch.
				provider: currentProvider,
				model: currentModel,
			},
		);

		if (updatedMessages !== beforeCompact) {
			setMessages(updatedMessages);
			setTokenCount(0);
			compactionOccurred = true;
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
		// Store the snapshot when the provider reported any usable token field
		// (input, output, or a lump-sum total). The indicator decides how to use
		// it; a non-finite or wholly-empty report is treated as "no usage".
		const hasReportedUsage =
			!compactionOccurred &&
			!!usage &&
			(Number.isFinite(usage.inputTokens) ||
				Number.isFinite(usage.outputTokens) ||
				Number.isFinite(usage.totalTokens) ||
				Number.isFinite(usage.cacheReadTokens) ||
				Number.isFinite(usage.cacheWriteTokens));
		setLastApiUsage(
			hasReportedUsage
				? {...usage, atMessageCount: updatedMessages.length}
				: null,
		);

		// Record a per-call history entry for session cost tracking
		if (onApiCallComplete && hasReportedUsage) {
			onApiCallComplete({
				provider: currentProvider,
				model: currentModel,
				inputTokens: usage.inputTokens,
				outputTokens: usage.outputTokens,
				totalTokens: usage.totalTokens,
				cacheReadTokens: usage.cacheReadTokens,
				cacheWriteTokens: usage.cacheWriteTokens,
				timestamp: Date.now(),
			});
		}
	}

	// Clear streaming content (but don't set isGenerating=false yet —
	// we may still need to execute tools and recurse)
	setStreamingContent('');
	setStreamingReasoning('');

	// This turn's repeated-call streak, computed over every call the model
	// emitted — unknown tools included, so a model stuck calling a nonexistent
	// tool trips the same cap as one re-running a real call.
	//
	// Keyed on emittedToolCalls rather than allToolCalls: filterValidToolCalls
	// silently discards calls with no id or no name, and those never reach the
	// model's history. Including them would let a stray empty call break an
	// otherwise identical streak (`[A]` then `[A, <empty>]` reads as a change).
	const currentToolSignature = computeToolCallSignature(emittedToolCalls);
	const currentRepeatedCount =
		currentToolSignature && currentToolSignature === lastToolSignature
			? repeatedToolCallCount + 1
			: 1;
	// Streak carried into the recursive continuation below. Reset to 0 when
	// the user grants another window at the limit prompt, so the re-prompt
	// cadence stays one full window rather than firing every turn.
	let repeatedCountForNextTurn = currentRepeatedCount;
	// True consecutive-repeat streak, never reset by a granted window, so
	// user-facing counts don't restart at the limit after each continue.
	const currentRepeatedTotal =
		currentToolSignature && currentToolSignature === lastToolSignature
			? repeatedToolCallTotal + 1
			: 1;

	// When the repeated-call streak hits the cap: pause and ask in an
	// interactive session (the repetition may be legitimate, e.g. polling a
	// long-running job, and the user is the only one who can tell). Headless
	// and non-interactive runs have nobody to ask, so they never continue.
	// Returns true when the user granted another window.
	const promptContinueRepeatedCalls = async (): Promise<boolean> => {
		const liveMode = developmentModeRef?.current ?? developmentMode;
		await flushAll();
		if (nonInteractiveMode || liveMode === 'headless') {
			return false;
		}
		setIsGenerating(false);
		const stopOption = 'Stop and return to prompt';
		const continueOption = `Continue (check again after ${maxRepeatedToolCalls} more)`;
		const answer = await signalQuestion({
			question: `The model has repeated the same tool call ${currentRepeatedTotal} times in a row without making progress. It may be stuck in a loop that drains tokens. Continue anyway?`,
			options: [stopOption, continueOption],
			allowFreeform: false,
			questionType: 'confirmation',
		});
		if (answer !== continueOption) {
			return false;
		}
		// User granted another window: reset the streak so the next
		// maxRepeatedToolCalls identical calls prompt again instead of
		// stopping, then let the caller resume this turn.
		repeatedCountForNextTurn = 0;
		setIsGenerating(true);
		addToChatQueue(
			<InfoMessage
				key={generateKey('tool-loop-continue')}
				message={`Continuing — will check again after ${maxRepeatedToolCalls} more repeated calls.`}
				hideBox={true}
			/>,
		);
		return true;
	};

	// Surface the loop-detected stop. Callers must have paired this turn's
	// tool calls with results in history before stopping.
	const stopForRepeatedCalls = () => {
		addToChatQueue(
			<ErrorMessage
				key={generateKey('tool-loop-detected')}
				message={`Model repeated the same tool call ${currentRepeatedTotal} times in a row without making progress — stopping to avoid a loop. Try rephrasing the request, breaking it into smaller steps, or switching models.`}
				hideBox={true}
			/>,
		);
		setIsGenerating(false);
		if (onConversationComplete) {
			onConversationComplete();
		}
	};

	// Handle error results for non-existent tools
	if (errorResults.length > 0) {
		// Show the user a concise notice. The full recovery hint (including the
		// list of available tools) lives in error.content and is sent to the
		// MODEL via addToolResults below — it would be noise in the chat.
		for (const error of errorResults) {
			addToChatQueue(
				<ErrorMessage
					key={generateKey(`unknown-tool-${error.tool_call_id}`)}
					message={`Model called an unavailable tool ("${error.name}") — asking it to retry with a valid tool.`}
					hideBox={true}
				/>,
			);
		}

		// Send error results back to model for self-correction
		const errorBuilder = new MessageBuilder(updatedMessages);
		errorBuilder.addToolResults(resultsForAbandonedTurn);
		const updatedMessagesWithError = errorBuilder.build();
		setMessages(updatedMessagesWithError);

		// Unknown-tool turns count toward the repeated-call streak, so a model
		// stuck calling a nonexistent tool cannot recurse unbounded. The error
		// and aborted results above are already paired in history, so a stop
		// here keeps the 1:1 tool-call/result mapping intact.
		if (currentRepeatedCount >= maxRepeatedToolCalls) {
			const continueAnyway = await promptContinueRepeatedCalls();
			if (!continueAnyway) {
				stopForRepeatedCalls();
				return;
			}
		}

		// Continue the main conversation loop with error messages as context
		await processAssistantResponse({
			...params,
			abortController: controller,
			messages: updatedMessagesWithError,
			conversationStartTime: startTime,
			emptyTurnCount: 0,
			malformedRetryCount: 0,
			lastToolSignature: currentToolSignature,
			repeatedToolCallCount: repeatedCountForNextTurn,
			repeatedToolCallTotal: currentRepeatedTotal,
			walkthroughLifecycle,
		});
		return;
	}

	// Handle tool calls if present - this continues the loop
	if (validToolCalls && validToolCalls.length > 0) {
		// Loop detection: if the model re-issues the exact same tool call(s) it
		// made last turn, it is almost certainly stuck (a small model re-running
		// an identical failing command, or repeatedly reading the same file).
		// The streak is computed above (shared with the unknown-tool branch);
		// once the cap is hit, pause and ask — or stop with an actionable error
		// when there is nobody to ask.
		if (currentRepeatedCount >= maxRepeatedToolCalls) {
			const continueAnyway = await promptContinueRepeatedCalls();
			if (!continueAnyway) {
				// Keep the AI SDK's 1:1 tool-call/result mapping intact: the assistant
				// message with these tool_calls is already in history, so pair each
				// with a cancellation result before stopping.
				const loopBuilder = new MessageBuilder(updatedMessages);
				loopBuilder.addToolResults(createCancellationResults(validToolCalls));
				setMessages(loopBuilder.build());
				stopForRepeatedCalls();
				return;
			}
		}

		// The SDK never auto-executes tools (execute is stripped). We evaluate
		// needsApproval ourselves, then run every tool through one routine that
		// gates each call: auto-approved tools execute immediately, the rest
		// suspend on a confirmation prompt before executing. No second code path.
		const autoTools: ToolCall[] = [];
		const confirmTools: ToolCall[] = [];
		// Results for tools a pre-tool-use hook refused. They skip execution
		// entirely but still need a result to pair with their tool call.
		const blockedResults: ToolResult[] = [];

		for (const toolCall of validToolCalls) {
			// The XML-fallback synthetic error isn't a real tool, so treat it as
			// auto (it surfaces as an error result). Real argument validation
			// lives in the tool handler (single source of truth).
			const validationFailed =
				toolCall.function.name === '__xml_validation_error__';

			// Lifecycle gate, ahead of the approval decision. Every execution path
			// gates again at its own boundary, but only here is it in front of the
			// confirmation prompt — so a "never touch .env" hook refuses the call
			// instead of rendering a diff preview, collecting an approval, and
			// vetoing afterwards. runPreToolUseGate fires the hook once per tool
			// call, so the downstream gates cost nothing after this one.
			if (!validationFailed) {
				const gate = await runPreToolUseGate(
					toolCall,
					// Lenient: malformed arguments are the handler's error to report,
					// and the hook should still see what the model actually sent.
					parseToolArguments<Record<string, unknown>>(
						toolCall.function.arguments,
					),
				);
				if (gate.blocked) {
					const reason = gate.reason ?? 'Blocked by a pre-tool-use hook.';
					blockedResults.push({
						tool_call_id: toolCall.id,
						role: 'tool',
						name: toolCall.function.name,
						content: `Error: ${reason}`,
						isError: true,
					});
					addToChatQueue(
						<ErrorMessage
							key={generateKey('hook-blocked-tool')}
							message={reason}
							hideBox={true}
						/>,
					);
					continue;
				}
			}

			const toolEntry = toolManager?.getToolEntry(toolCall.function.name);
			const needsApproval =
				!validationFailed &&
				(await resolveToolApproval(
					toolCall.function.name,
					toolEntry,
					toolCall.function.arguments,
					{
						// Prefer the live ref so a mode switch made while this turn's
						// tools are still executing takes effect on the next call.
						mode: developmentModeRef?.current ?? developmentMode,
						alwaysAllow: nonInteractiveMode
							? nonInteractiveAlwaysAllow
							: undefined,
					},
				));

			if (needsApproval) {
				confirmTools.push(toolCall);
			} else {
				autoTools.push(toolCall);
			}
		}

		// Display/tally options shared by auto and post-approval execution so a
		// tool renders identically however it was approved.
		const displayOptions = {
			compactDisplay: compactToolDisplayRef?.current,
			onCompactToolCount: (toolName: string) => {
				if (compactToolCountsRef) {
					const counts = compactToolCountsRef.current;
					counts[toolName] = (counts[toolName] ?? 0) + 1;
					onSetCompactToolCounts?.({...counts});
				}
			},
			onLiveTaskUpdate: (tasks?: Task[]) => {
				hasLiveTaskUpdates = true;
				if (tasks) {
					onSetLiveTaskList?.(tasks);
				} else {
					loadTasks(sessionId).then(loaded => {
						onSetLiveTaskList?.(loaded);
					});
				}
			},
			nonInteractiveMode,
		};

		const turnResults: ToolResult[] = [...blockedResults];

		// 1) Auto-approved tools execute as a batch (parallelizes consecutive
		//    read-only / agent runs).
		if (autoTools.length > 0) {
			const directResults = await executeToolsDirectly(
				autoTools,
				toolManager,
				conversationStateManager,
				addToChatQueue,
				{
					...displayOptions,
					setLiveComponent,
					signal: controller.signal,
					executionContext: {sessionId, workingDirectory},
				},
			);
			turnResults.push(...directResults);
			for (const [index, result] of directResults.entries()) {
				if (!result.isError) {
					onToolExecuted?.(result.name);
					const toolCall = autoTools[index];
					if (toolCall) {
						observeSuccessfulLifecycleTool(walkthroughLifecycle, toolCall);
					}
				}
			}
		}

		// 2) Non-interactive mode can't prompt, so exit when approval is needed.
		if (confirmTools.length > 0 && nonInteractiveMode) {
			await flushAll();
			const toolNames = confirmTools.map(tc => tc.function.name).join(', ');
			const errorMsg = `${TOOL_APPROVAL_REQUIRED_PREFIX}${toolNames}. Exiting non-interactive mode`;
			addToChatQueue(
				<ErrorMessage
					key={generateKey(TOOL_APPROVAL_REQUIRED_KIND)}
					message={errorMsg}
					hideBox={true}
				/>,
			);
			const builder = new MessageBuilder(updatedMessages);
			// The assistant message already announces confirmTools' tool_calls;
			// pair each with a result so the saved history keeps the
			// provider-required 1:1 call/result mapping.
			builder.addToolResults([
				...turnResults,
				...createApprovalUnavailableResults(confirmTools),
			]);
			builder.addMessage({
				role: 'assistant',
				content: errorMsg,
				displayOnly: true,
			});
			setMessages(builder.build());
			setIsGenerating(false);
			onConversationComplete?.();
			return;
		}

		// 3) Interactive confirmation: gate each remaining tool, execute on
		//    approval. A decline cancels the rest and returns control to the user.
		if (confirmTools.length > 0) {
			// Flush accumulated auto-exec output before the prompt, and stop the
			// thinking spinner so the confirmation UI renders cleanly.
			await flushAll();
			setIsGenerating(false);
			const {processToolUse} = await import('@/message-handler');
			const processToolWithContext = (toolCall: ToolCall) =>
				processToolUse(toolCall, {
					abortSignal: controller.signal,
					sessionId,
					workingDirectory,
				});

			for (let i = 0; i < confirmTools.length; i++) {
				const toolCall = confirmTools[i];
				const approved = await signalToolConfirm({toolCall});

				if (!approved) {
					// Close any VS Code diff previews the formatter opened for the
					// declined tools (the approve path self-closes post-execution).
					closeAllDiffsInVSCode();
					// Record cancellation results for this tool and every remaining
					// one (keeps tool_call/result pairing intact), then stop without
					// re-prompting the model.
					turnResults.push(...createCancellationResults(confirmTools.slice(i)));
					addToChatQueue(
						<InfoMessage
							key={generateKey('tool-cancelled')}
							message="Tool execution cancelled by user."
							hideBox={true}
						/>,
					);
					const builder = new MessageBuilder(updatedMessages);
					builder.addToolResults(turnResults);
					setMessages(builder.build());
					return;
				}

				// Approved: execute + display through the same primitives the auto
				// batch uses. isGenerating is true so the live area renders and the
				// global Escape handler stays armed during execution.
				setIsGenerating(true);
				const execution = await executeApprovedTool(
					toolCall,
					toolManager,
					processToolWithContext,
					setLiveComponent,
					controller.signal,
				);
				turnResults.push(execution.result);
				if (!execution.result.isError) {
					onToolExecuted?.(execution.result.name);
					observeSuccessfulLifecycleTool(walkthroughLifecycle, toolCall);
				}
				await displayExecutedTool(
					execution,
					toolManager,
					addToChatQueue,
					conversationStateManager,
					displayOptions,
				);

				// Escape during execution: stop prompting further tools; the abort
				// unwinds on the continuation's next LLM call (same as the auto
				// path), surfacing as "Interrupted by user.". Cancel the tools we
				// never reached so the saved history keeps the provider-required
				// 1:1 tool_call/result pairing.
				if (controller.signal.aborted) {
					turnResults.push(
						...createCancellationResults(confirmTools.slice(i + 1)),
					);
					break;
				}
			}
		}

		// 4) Feed all results back to the model and continue the loop.
		if (turnResults.length > 0) {
			let autoDiagnosticsMessage: Message | null = null;
			if (availableNames.includes('lsp_get_diagnostics')) {
				const {processToolUse} = await import('@/message-handler');
				autoDiagnosticsMessage = await buildAutoDiagnosticsMessage(
					validToolCalls,
					turnResults,
					processToolUse,
				);
			}
			const builder = new MessageBuilder(updatedMessages);
			builder.addToolResults(turnResults);
			if (autoDiagnosticsMessage) {
				builder.addMessage(autoDiagnosticsMessage);
			}
			const nextMessages = builder.build();
			setMessages(nextMessages);
			await processAssistantResponse({
				...params,
				// Carry the resolved controller forward. params.abortController can
				// be a stale (often null) closure value, which would make this
				// continuation mint a brand-new controller — so a cancel that
				// aborted THIS turn's controller wouldn't stop the next LLM call
				// ("Cancelling…" with no effect until a second press).
				abortController: controller,
				messages: nextMessages,
				conversationStartTime: startTime,
				emptyTurnCount: 0,
				malformedRetryCount: 0,
				lastToolSignature: currentToolSignature,
				repeatedToolCallCount: repeatedCountForNextTurn,
				repeatedToolCallTotal: currentRepeatedTotal,
				walkthroughLifecycle,
			});
			return;
		}
	}

	// If no tool calls, the conversation naturally ends here
	// BUT: if there's ALSO no content, that's likely an error - the model should have said something
	// Auto-reprompt to help the model continue
	if (validToolCalls.length === 0 && !cleanedContent.trim()) {
		// Cap consecutive empty turns. Without this, a model that keeps
		// returning nothing (common with GPT-5 reasoning that exhausts the
		// token budget on thinking) would loop forever.
		if (emptyTurnCount >= maxEmptyTurns) {
			setLiveComponent?.(null);
			// If we still have compact-and-retry budget, mechanically compress
			// the context and nudge the model to continue instead of giving up
			// immediately. This handles the common case where the model is
			// exhausting its token budget on reasoning.
			if (compactRetryCount < MAX_COMPACT_RETRIES) {
				try {
					const {createTokenizer} = await import('@/tokenization/index');
					const tokenizer = createTokenizer(currentProvider, currentModel);
					const systemPrompt = getLastBuiltPrompt();
					const sysMsg: Message = {role: 'system', content: systemPrompt};
					const allForCompress = [sysMsg, ...updatedMessages];
					const result = compressMessages(allForCompress, tokenizer, {
						mode: 'aggressive',
					});
					if (tokenizer.free) tokenizer.free();

					const compressedUser = result.compressedMessages.filter(
						m => m.role !== 'system',
					);
					setMessages(compressedUser);

					addToChatQueue(
						<InfoMessage
							key={generateKey('auto-compact-retry')}
							message={`Context too large — auto-compacted (${Math.round(result.reductionPercentage)}% reduction). Retrying…`}
							hideBox={true}
						/>,
					);

					const retryNudge: Message = {
						role: 'user',
						content:
							'Context has been compacted. Please continue with the task.',
					};
					const retryBuilder = new MessageBuilder(compressedUser);
					retryBuilder.addMessage(retryNudge);
					const messagesAfterCompact = retryBuilder.build();
					setMessages(messagesAfterCompact);

					await processAssistantResponse({
						...params,
						messages: messagesAfterCompact,
						conversationStartTime: startTime,
						emptyTurnCount: 0,
						malformedRetryCount: 0,
						compactRetryCount: compactRetryCount + 1,
						lastToolSignature: undefined,
						repeatedToolCallCount: 0,
						repeatedToolCallTotal: 0,
						walkthroughLifecycle,
					});
					return;
				} catch (_err) {
					// Compression failed — fall through to give-up below
				}
			}

			await flushAll();
			// Exhausted all retries (nudges + compact-and-retry cycles)
			addToChatQueue(
				<ErrorMessage
					key={generateKey('empty-response-giveup')}
					message={`Model produced no output after ${maxEmptyTurns + 1 + compactRetryCount} attempts. The model may be exhausting its token budget on reasoning, or the request may have been refused. Try rephrasing, lowering reasoning effort, or switching models.`}
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
		const total = maxEmptyTurns + 1;
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
		await flushAll();

		// Don't include the empty assistantMsg - it would cause API error
		// "Assistant message must have either content or tool_calls"
		const nudgeBuilder = new MessageBuilder(updatedMessages);
		nudgeBuilder.addMessage(nudgeMessage);
		const updatedMessagesWithNudge = nudgeBuilder.build();
		setMessages(updatedMessagesWithNudge);

		// Continue the conversation loop with the nudge
		await processAssistantResponse({
			...params,
			abortController: controller,
			messages: updatedMessagesWithNudge,
			conversationStartTime: startTime,
			emptyTurnCount: emptyTurnCount + 1,
			malformedRetryCount: 0,
			lastToolSignature: undefined,
			repeatedToolCallCount: 0,
			repeatedToolCallTotal: 0,
			walkthroughLifecycle,
		});
		return;
	}

	if (validToolCalls.length === 0 && cleanedContent.trim()) {
		// Never spend an extra model turn on a walkthrough the user just
		// cancelled out of.
		const walkthroughFallback = controller.signal.aborted
			? null
			: takeWalkthroughFallback(
					walkthroughLifecycle,
					availableNames.includes('write_walkthrough'),
				);
		if (walkthroughFallback) {
			const messagesWithFallback = [...updatedMessages, walkthroughFallback];
			setMessages(messagesWithFallback);
			// Lock the prior turn's live task panel into scrollback before the
			// nudge turn starts, same as every other recursion site here.
			await flushAll();
			await processAssistantResponse({
				...params,
				abortController: controller,
				messages: messagesWithFallback,
				conversationStartTime: startTime,
				emptyTurnCount: 0,
				malformedRetryCount: 0,
				lastToolSignature: undefined,
				repeatedToolCallCount: 0,
				walkthroughLifecycle,
			});
			return;
		}

		// Flush any residual compact counts and task updates from turns that
		// didn't emit reasoning so they persist in scrollback at conversation end.
		params.onFinalAssistantText?.(cleanedContent);
		await flushAll();

		setIsGenerating(false);
		addToChatQueue(
			<InfoMessage
				key={generateKey('completion-time')}
				message={buildCompletionNote(startTime)}
				hideBox={true}
				marginBottom={2}
			/>,
		);
		onConversationComplete?.();
	}
};
