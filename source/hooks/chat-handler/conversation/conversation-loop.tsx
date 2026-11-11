import React from 'react';
import {NO_RESPONSE_MESSAGE, runTurnEngine} from '@/agent-loop/turn-engine';
import type {ConversationStateManager} from '@/app/utils/conversation-state';
import {
	createWalkthroughLifecycle,
	takeWalkthroughFallback,
} from '@/artifacts/walkthrough-lifecycle';
import AssistantMessage from '@/components/assistant-message';
import AssistantReasoning from '@/components/assistant-reasoning';
import {ErrorMessage, InfoMessage} from '@/components/message-box';
import {getAppConfig, getRetryLimits} from '@/config/index';
import {getShowUsageFooter} from '@/config/preferences';
import {MAX_COMPACT_RETRIES} from '@/constants';
import {runLifecycleHooks} from '@/services/lifecycle-hooks';
import {generateKey} from '@/session/key-generator';
import {loadTasks} from '@/tools/tasks/storage';
import type {Task} from '@/tools/tasks/types';
import type {ToolManager} from '@/tools/tool-manager';
import {isSingleToolProfile} from '@/tools/tool-profiles';
import {getTuneToolMode, type TuneConfig} from '@/types/config';
import type {
	ApiCallRecord,
	ApiUsageSnapshot,
	LLMChatResponse,
	LLMClient,
	Message,
	ModeOverrides,
	ToolCall,
	ToolResult,
} from '@/types/core';
import {buildResponseUsageBounded} from '@/usage/response-usage';
import {buildCompletionNote} from '@/utils/completion-note';
import {compressionBackup} from '@/utils/compression-backup';
import {MessageBuilder} from '@/utils/message-builder';
import {compressMessages} from '@/utils/message-compression';
import {infoMsg} from '@/utils/message-factory';
import {signalQuestion} from '@/utils/question-queue';
import {bumpReadContentGeneration} from '@/utils/read-tracker';
import {markRunFailed} from '@/utils/run-outcome';
import {estimateTokens} from '@/utils/token-calculator';
import {createCancellationResults} from '@/utils/tool-cancellation';
import {displayCompactCountsSummary} from '@/utils/tool-result-display';
import {filterValidToolCalls} from '../utils/tool-filters';
import {
	type ArchitectCheckpointState,
	runToolTurn,
	type ToolTurnStop,
} from './tool-turn';

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
	developmentMode:
		| 'normal'
		| 'auto-accept'
		| 'yolo'
		| 'plan'
		| 'architect'
		| 'headless';
	// Live mode ref, read per tool call so a mid-turn mode switch (e.g. flipping
	// to yolo while tools execute) is honored immediately. Falls back to the
	// snapshot `developmentMode` for callers that don't supply a ref (subagents,
	// plain shell).
	developmentModeRef?: React.RefObject<
		'normal' | 'auto-accept' | 'yolo' | 'plan' | 'architect' | 'headless'
	>;
	nonInteractiveMode: boolean;
	conversationStateManager: React.MutableRefObject<ConversationStateManager>;
	architectCheckpointState?: ArchitectCheckpointState;
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
// models, where there is no Thought to group under). Set on every turn, so
// one thinking turn does not indent every summary for the rest of the
// process (e.g. after switching to a non-thinking model).
let lastTurnHadReasoning = false;

/** Reset the reasoning-grouping flag (for testing). */
export const resetLastTurnHadReasoning = () => {
	lastTurnHadReasoning = false;
};

/**
 * Main conversation loop that processes assistant responses and handles tool calls.
 *
 * Runs on the shared turn engine (`source/agent-loop/turn-engine.ts`), one
 * iteration per model round-trip, with the interactive behaviours switched on
 * through its policy and hooks: text tool calls parsed whenever a turn has no
 * native ones, `<think>` stripping, the single-tool tune profile, the
 * repeated-call "continue anyway?" prompt, context-aware empty-turn nudges
 * and compact-and-retry. This adapter owns everything the user sees:
 * streaming, the chat queue, confirmations and tool execution.
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
		architectCheckpointState,
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
		privacySessionMapRef,
		privacyEnabled = false,
		onPrivacyEvent,
		onToolExecuted,
		sessionId,
		workingDirectory,
	} = params;
	const walkthroughLifecycle = createWalkthroughLifecycle(messages);

	const startTime = conversationStartTime ?? Date.now();

	// Agent-loop retry limits: configurable via `nanocoder.retries` in
	// agents.config.json, falling back to the historical hardcoded caps.
	const retryLimits = getRetryLimits();
	const {maxRepeatedToolCalls, maxEmptyTurns, maxMalformedRetries} =
		retryLimits;

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

	// Whether any task tools were executed in this model turn. Reset at the
	// start of every turn.
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

	// One controller for the whole run, created once: every model call and
	// tool in it shares this signal, so a single cancel reaches all of them.
	let controller = abortController;
	if (!controller) {
		controller = new AbortController();
		setAbortController(controller);
	}
	const signal = controller.signal;

	// Build mode overrides for non-interactive mode and tune settings
	const modelParameters = tune?.enabled ? tune.modelParameters : undefined;

	// What the mode offers right now. Shift+Tab can change the mode while a turn
	// is running, so a call is checked against this rather than the list the
	// request offered.
	const liveAvailableNames = () =>
		toolManager?.getAvailableToolNames(
			tune,
			developmentModeRef?.current ?? developmentMode,
			undefined,
			currentModel,
		);
	// Why `toolCall` can't run now, or undefined when the mode still offers it.
	const notOfferedReason = (toolCall: ToolCall) => {
		const offered = liveAvailableNames();
		return offered && !offered.includes(toolCall.function.name)
			? `The tool "${toolCall.function.name}" is not available in the current mode.`
			: undefined;
	};

	// Single-tool enforcement: active when the tune profile implies a single
	// tool per turn (e.g. the minimal profile).
	const enforceSingleTool =
		tune?.enabled && isSingleToolProfile(tune.toolProfile, currentModel);

	// The conversation as this run writes it. Every write goes to app state.
	let history = messages;
	const setHistory = (next: Message[]) => {
		history = next;
		setMessages(next);
	};
	const toolResultMessages = (results: ToolResult[]) =>
		new MessageBuilder([]).addToolResults(results).build();

	// Per-turn state, reset when a turn starts.
	let turnStartMessages = messages;
	let availableNames: string[] = [];
	let streamedContent = '';
	let streamedReasoning = '';
	let fullReasoning: string | undefined;
	let turnUsage: LLMChatResponse['usage'];
	let rejectedToolCalls: ToolCall[] = [];
	let recordedToolCalls: ToolCall[] = [];

	// Per-run state.
	let compactRetryCount = 0;
	let repeatedToolCallTotal = 0;
	let finalContent = '';

	// When the repeated-call streak hits the cap: pause and ask in an
	// interactive session (the repetition may be legitimate, e.g. polling a
	// long-running job, and the user is the only one who can tell). Headless
	// and non-interactive runs have nobody to ask, so they never continue.
	const promptContinueRepeatedCalls = async (): Promise<boolean> => {
		const liveMode = developmentModeRef?.current ?? developmentMode;
		await flushAll();
		if (nonInteractiveMode || liveMode === 'headless') {
			return false;
		}
		setIsGenerating(false);
		const stopOption = 'Stop and return to prompt';
		const continueOption = `Continue (check again after ${maxRepeatedToolCalls} more)`;
		// Aborting settles this with the slot's error string, which is not
		// `continueOption`, so a cancelled turn stops rather than hanging on a
		// question nobody is left to answer.
		const answer = await signalQuestion(
			{
				question: `The model has repeated the same tool call ${repeatedToolCallTotal} times in a row without making progress. It may be stuck in a loop that drains tokens. Continue anyway?`,
				options: [stopOption, continueOption],
				allowFreeform: false,
				questionType: 'confirmation',
			},
			signal,
		);
		if (answer !== continueOption) {
			return false;
		}
		// The engine grants another window, so the next maxRepeatedToolCalls
		// identical calls prompt again instead of stopping.
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
		markRunFailed('repeated-tool-calls');
		addToChatQueue(
			<ErrorMessage
				key={generateKey('tool-loop-detected')}
				message={`Model repeated the same tool call ${repeatedToolCallTotal} times in a row without making progress — stopping to avoid a loop. Try rephrasing the request, breaking it into smaller steps, or switching models.`}
				hideBox={true}
			/>,
		);
		setIsGenerating(false);
		if (onConversationComplete) {
			onConversationComplete();
		}
	};

	const executeTools = (validToolCalls: ToolCall[]) =>
		runToolTurn(validToolCalls, {
			toolManager,
			signal,
			addToChatQueue,
			setIsGenerating,
			setLiveComponent,
			conversationStateManager,
			compactToolDisplayRef,
			compactToolCountsRef,
			onSetCompactToolCounts,
			onSetLiveTaskList,
			developmentMode,
			developmentModeRef,
			nonInteractiveMode,
			architectCheckpointState,
			currentProvider,
			currentModel,
			sessionId,
			workingDirectory,
			onToolExecuted,
			walkthroughLifecycle,
			turnStartMessages,
			availableNames,
			notOfferedReason,
			flushAll,
			markLiveTaskUpdates: () => {
				hasLiveTaskUpdates = true;
			},
		});

	const result = await runTurnEngine<ToolTurnStop>({
		client,
		signal,
		// No turn ceiling: the user is there to stop a run.
		maxTurns: Number.POSITIVE_INFINITY,
		retryLimits,
		policy: {
			// Open-weights models marketed as native-tool-capable sometimes
			// regress and emit text-based tool calls instead. Without this
			// fallback the agent stalls.
			textToolCalls: 'whenever-no-native',
			// Providers that emit reasoning via the SDK protocol never put
			// <think> in text, so this is a no-op for them. Providers that
			// stream it as raw text would otherwise leak it into history.
			stripThinkTags: true,
			maxToolCallsPerTurn: enforceSingleTool ? 1 : undefined,
			// filterValidToolCalls discards calls with no id or name, and those
			// never reach the model's history. Including them would let a stray
			// empty call break an otherwise identical streak.
			repeatSignature: 'emitted',
			// The client raises the abort on the next request; only the check
			// after compaction (which records cancellation results) runs here.
			abortBetweenTurns: false,
			truncatedTurnGuard: false,
		},
		adapter: {
			history: {get: () => history, set: setHistory},
			getSystemMessage: () => systemMessage,
			prepareTurn: () => {
				turnStartMessages = history;
				hasLiveTaskUpdates = false;
				streamedContent = '';
				streamedReasoning = '';
				fullReasoning = undefined;
				turnUsage = undefined;
				rejectedToolCalls = [];
				recordedToolCalls = [];

				// Use streaming with callbacks
				setIsGenerating(true);
				setStreamingContent('');
				setStreamingReasoning('');
				setTokenCount(0);
				// Drop any prior empty-response retry counter from the live area so
				// the streaming UI for this turn renders unobstructed. The counter
				// is only meant to be visible briefly between calls on consecutive
				// empties.
				setLiveComponent?.(null);

				const nonInteractiveAlwaysAllow = nonInteractiveMode
					? (getAppConfig().alwaysAllow ?? [])
					: [];
				const modeOverrides: ModeOverrides = {
					nonInteractiveMode,
					nonInteractiveAlwaysAllow,
					modelParameters,
					privacySessionMapRef,
					privacyEnabled,
					nativeToolsDisabled: getTuneToolMode(tune) !== 'native',
				};

				// Get effective tools — ToolManager is the single authority for
				// availability (mode + profile filtering) and approval policy
				availableNames =
					toolManager?.getAvailableToolNames(
						tune,
						developmentMode,
						undefined,
						currentModel,
					) ?? [];
				const tools = toolManager
					? toolManager.getFilteredTools(availableNames)
					: {};
				return {tools, availableNames, modeOverrides};
			},
			beginModelCall: () => ({
				callbacks: {
					onToken: (token: string) => {
						streamedContent += token;
						setStreamingContent(streamedContent);
						// Feed the in-flight reply into the context-usage estimate so
						// the `~%` indicator climbs as the model writes, instead of
						// only stepping up once the finished message is committed.
						setTokenCount(estimateTokens(streamedContent));
					},
					onReasoningToken: (token: string) => {
						streamedReasoning += token;
						setStreamingReasoning(streamedReasoning);
					},
					onPrivacyEvent,
				},
				reasoning: () => fullReasoning,
			}),
			onModelResponse: response => {
				if (!response?.choices?.length) return;
				fullReasoning = response.choices[0].message.reasoning;
				turnUsage = response.usage;
				// Notify the user once per session when the XML fallback path is
				// active
				if (response.toolsDisabled && !hasShownFallbackNotice) {
					hasShownFallbackNotice = true;
					addToChatQueue(
						<InfoMessage
							key={generateKey('xml-fallback-notice')}
							message="Model does not support native tool calling. Using XML fallback."
							hideBox={true}
						/>,
					);
				}
			},
			onMalformedRetry: ({error, examples}) => {
				// Display error to user; the engine sends it back to the model for
				// self-correction.
				addToChatQueue(
					<ErrorMessage
						key={generateKey('malformed-tool')}
						message={`${error}\n\n${examples}`}
						hideBox={true}
					/>,
				);
			},
			onAssistantTurn: async ({content}) => {
				// Clear streaming content and add static message in one go so the
				// live StreamingMessage disappears at the same time the static
				// AssistantMessage appears, avoiding a visual jump.
				setStreamingContent('');
				setStreamingReasoning('');
				// The reply is about to be committed to history (counted by
				// calculateTokenBreakdown). Drop the in-flight streaming estimate
				// so the context-usage figure doesn't count this turn's text twice.
				setTokenCount(0);

				// Flush accumulated compact counts ONLY when this turn emits
				// narrative text — a natural break in a run of tool calls.
				// Reasoning alone does NOT break the run: thinking models emit
				// reasoning on every turn, and agentic flows often run one tool per
				// turn, so flushing on reasoning would stack "Ran 1 command" /
				// "Wrote 1 file" lines instead of combining them. Residual counts
				// are flushed at end of conversation / before confirmation.
				if (content.trim()) {
					await flushAll();
				}
				if (fullReasoning) {
					// Despite reasoning stream typically finishing before text
					// stream, reasoning is still added to chat queue here to give
					// correct message order with regards to tool calling
					addToChatQueue(
						<AssistantReasoning
							key={generateKey('assistant')}
							reasoning={fullReasoning}
							expand={reasoningExpandedRef?.current ?? false}
						/>,
					);
				}
				lastTurnHadReasoning = Boolean(fullReasoning);
				if (content.trim()) {
					// Provider-reported tokens + estimated cost for this API call,
					// shown as the footer of the message. The lookup is bounded:
					// token counts are known synchronously and always render; the
					// cost segment joins only if (memoized) pricing resolves within
					// the ceiling, so a cold or offline models.dev fetch can never
					// hold up the message swap. Skipped entirely when the footer is
					// off. Read per message so toggling the setting mid-session
					// takes effect on the very next response.
					const showUsageFooter = getShowUsageFooter();
					const responseUsage = showUsageFooter
						? await buildResponseUsageBounded(turnUsage, currentModel)
						: undefined;
					addToChatQueue(
						<AssistantMessage
							key={generateKey('assistant')}
							message={content}
							model={currentModel}
							usage={responseUsage}
							showUsageFooter={showUsageFooter}
						/>,
					);
				}
			},
			partitionToolCalls: toolCalls =>
				filterValidToolCalls(toolCalls, toolManager, liveAvailableNames()),
			onRejectedToolCalls: partition => {
				rejectedToolCalls = partition.rejectedToolCalls;
			},
			toolResultMessages,
			compactOptions: () => ({
				onNotify: notification => {
					addToChatQueue(infoMsg(notification, 'auto-compact-notification'));
				},
				// The TUI tracks the active provider/model in app state; use those
				// rather than re-deriving them from the client, which may lag a
				// pending switch.
				provider: currentProvider,
				model: currentModel,
			}),
			onTurnRecorded: ({assistantMessage, compacted}) => {
				if (assistantMessage) {
					conversationStateManager.current.updateAssistantMessage(
						assistantMessage,
					);
					recordedToolCalls = assistantMessage.tool_calls ?? [];
				}
				if (compacted) {
					setTokenCount(0);
				}
				// Cancelled while the reply was finishing or while compaction ran:
				// the run unwinds next, with nothing more recorded.
				if (signal.aborted) {
					return;
				}

				// Record the API-reported usage for the context indicator. The
				// snapshot is keyed to the post-response message count so the
				// indicator can fall back to estimation once newer messages make
				// it stale. After compaction the reported usage describes the
				// pre-compaction context, so clear it (null) and let estimation
				// recompute against the compressed history.
				if (setLastApiUsage) {
					const usage = turnUsage;
					// Store the snapshot when the provider reported any usable token
					// field (input, output, or a lump-sum total). The indicator
					// decides how to use it; a non-finite or wholly-empty report is
					// treated as "no usage".
					const hasReportedUsage =
						!compacted &&
						!!usage &&
						(Number.isFinite(usage.inputTokens) ||
							Number.isFinite(usage.outputTokens) ||
							Number.isFinite(usage.totalTokens) ||
							Number.isFinite(usage.cacheReadTokens) ||
							Number.isFinite(usage.cacheWriteTokens));
					setLastApiUsage(
						hasReportedUsage && usage
							? {...usage, atMessageCount: history.length}
							: null,
					);

					// Record a per-call history entry for session cost tracking
					if (onApiCallComplete && hasReportedUsage && usage) {
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
				// we may still need to execute tools and continue)
				setStreamingContent('');
				setStreamingReasoning('');

				// Show the user a concise notice for each rejected call (an
				// unavailable tool, or arguments that could not be parsed). The
				// full recovery hint (including the list of available tools)
				// lives in the error result the engine sends the MODEL — it would
				// be noise in the chat.
				for (const toolCall of rejectedToolCalls) {
					addToChatQueue(
						<ErrorMessage
							key={generateKey(`rejected-tool-${toolCall.id}`)}
							message={
								toolCall.argumentsError === undefined
									? `Model called an unavailable tool ("${toolCall.function.name}") — asking it to retry with a valid tool.`
									: `Model sent invalid arguments for "${toolCall.function.name}" (${toolCall.argumentsError}) — asking it to retry.`
							}
							hideBox={true}
						/>,
					);
				}
			},
			onRepeatedToolCalls: async ({total}) => {
				repeatedToolCallTotal = total;
				return (await promptContinueRepeatedCalls()) ? 'continue' : 'stop';
			},
			// Pick a nudge that matches the failure mode. A reasoning-only turn
			// gets a different prompt than a totally silent one — telling the
			// model "you produced reasoning but no answer" is more actionable
			// than a generic "continue".
			emptyTurnNudge: currentHistory => {
				const lastMessage = currentHistory[currentHistory.length - 1];
				if (fullReasoning && fullReasoning.trim()) {
					return 'You produced reasoning but no final response. Please provide your answer based on your reasoning above.';
				}
				if (lastMessage?.role === 'tool') {
					return 'Please provide a summary or response based on the tool results above.';
				}
				return 'Please continue with the task.';
			},
			onEmptyRetry: async (attempt, nudge) => {
				// Coalesce auto-nudge notices into a single live counter that
				// updates in place between turns instead of stacking N
				// InfoMessages in scrollback. It is cleared when the next turn
				// starts so the streaming UI for the retry is unobstructed.
				const total = maxEmptyTurns + 1;
				setLiveComponent?.(
					<InfoMessage
						key="auto-continue-counter"
						message={`Empty response — retry ${attempt}/${total}: "${nudge}"`}
						hideBox={true}
					/>,
				);

				// Lock any live task panel from the prior turn into scrollback so
				// the next turn's UI starts clean.
				await flushAll();
			},
			// Out of nudges (common with GPT-5 reasoning that exhausts the token
			// budget on thinking). If there is compact-and-retry budget left,
			// mechanically compress the context and nudge the model to continue
			// instead of giving up immediately.
			onEmptyTurnsExhausted: async () => {
				setLiveComponent?.(null);
				if (compactRetryCount >= MAX_COMPACT_RETRIES) {
					return undefined;
				}
				try {
					const {createTokenizer} = await import('@/tokenization/index');
					const tokenizer = createTokenizer(currentProvider, currentModel);
					// Same observe-only hook and /compact restore point as
					// auto-compact and /compact, so this compaction is not the one a
					// pre-compact archive hook or a restore never sees.
					await runLifecycleHooks('pre-compact', {
						messageCount: history.length,
					});
					compressionBackup.storeBackup(history);
					// The system message this turn was sent with, not the
					// process-wide last-built prompt, so the compressor measures and
					// preserves what the model actually sees.
					const allForCompress = [systemMessage, ...history];
					const compression = compressMessages(allForCompress, tokenizer, {
						mode: 'aggressive',
					});
					if (tokenizer.free) tokenizer.free();

					const compressedUser = compression.compressedMessages.filter(
						m => m.role !== 'system',
					);
					// Aggressive compression truncates old read_file bodies, so a
					// repeat read must return the content again, not the
					// "unchanged since last read" stub. Same as /compact and
					// auto-compact.
					bumpReadContentGeneration();

					addToChatQueue(
						<InfoMessage
							key={generateKey('auto-compact-retry')}
							message={`Context too large — auto-compacted (${Math.round(compression.reductionPercentage)}% reduction). Retrying…`}
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
					compactRetryCount++;
					return retryBuilder.build();
				} catch (_err) {
					// Compression failed — give up below
					return undefined;
				}
			},
			onFinalAnswer: async ({content}) => {
				// Never spend an extra model turn on a walkthrough the user just
				// cancelled out of.
				const walkthroughFallback = signal.aborted
					? null
					: takeWalkthroughFallback(
							walkthroughLifecycle,
							availableNames.includes('write_walkthrough'),
						);
				if (walkthroughFallback) {
					setHistory([...history, walkthroughFallback]);
					// Lock the prior turn's live task panel into scrollback before
					// the nudge turn starts.
					await flushAll();
					return {kind: 'continue', messages: [], resetRetryGuards: true};
				}
				finalContent = content;
				return {kind: 'finish'};
			},
			executeTools,
		},
	});

	switch (result.kind) {
		case 'completed':
			// Flush any residual compact counts and task updates from turns that
			// didn't emit reasoning so they persist in scrollback at the end.
			params.onFinalAssistantText?.(finalContent);
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
			return;
		case 'aborted':
			// The model call raised the abort: unwind with its error.
			if (result.error !== undefined) {
				throw result.error;
			}
			// Escape while the reply was finishing or while compaction ran: don't
			// go on to execute this turn's tool calls. Pair them with
			// cancellation results so the saved history keeps the 1:1
			// tool_call/result mapping, then unwind the same way an abort during
			// the LLM call does.
			if (recordedToolCalls.length > 0) {
				setHistory([
					...history,
					...toolResultMessages(createCancellationResults(recordedToolCalls)),
				]);
			}
			throw new Error('Operation was cancelled');
		case 'model-error':
			throw result.error;
		case 'no-response':
			throw new Error(NO_RESPONSE_MESSAGE);
		case 'guard-stop':
			if (result.guard === 'malformed') {
				// Cap malformed-retry turns. Without this, a model stuck producing
				// bad XML loops forever.
				await flushAll();
				markRunFailed('malformed-tool-giveup');
				addToChatQueue(
					<ErrorMessage
						key={generateKey('malformed-tool-giveup')}
						message={`Model produced malformed tool calls ${maxMalformedRetries + 1} time${maxMalformedRetries === 0 ? '' : 's'} in a row and cannot self-correct. Try rephrasing the request or switching models.`}
						hideBox={true}
					/>,
				);
				setIsGenerating(false);
				if (onConversationComplete) {
					onConversationComplete();
				}
				return;
			}
			if (result.guard === 'empty') {
				await flushAll();
				// Exhausted all retries (nudges + compact-and-retry cycles)
				markRunFailed('empty-response-giveup');
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
			// Keep the AI SDK's 1:1 tool-call/result mapping intact: the
			// assistant message with these tool_calls is already in history, so
			// pair each with a cancellation result before stopping.
			if (result.unrunToolCalls.length > 0) {
				setHistory([
					...history,
					...toolResultMessages(
						createCancellationResults(result.unrunToolCalls),
					),
				]);
			}
			stopForRepeatedCalls();
			return;
		case 'adapter-stop':
			if (result.payload === 'approval-unavailable') {
				setIsGenerating(false);
				onConversationComplete?.();
			} else if (result.payload === 'declined') {
				// The turn ends here, so say so: without this the app stays
				// "mid-conversation" and never drains messages queued while the
				// prompt was up.
				onConversationComplete?.();
			} else {
				// 'nothing-ran': a turn with valid calls produced no results. Not
				// reachable today, but if it ever is, release the UI rather than
				// leave it generating with nothing left to finish the turn.
				setIsGenerating(false);
				onConversationComplete?.();
			}
			return;
		case 'no-system-message':
		case 'max-turns':
			// Unreachable: the system message is required and there is no turn
			// ceiling. Ended the same way regardless, so a future change cannot
			// strand the UI mid-turn.
			setIsGenerating(false);
			onConversationComplete?.();
			return;
	}
};
