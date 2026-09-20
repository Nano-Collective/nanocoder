import {randomUUID} from 'node:crypto';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {SettingsTabId} from '@/app/components/settings-constants';
import type {TitleShape} from '@/components/ui/styled-title';
import {getAppConfig} from '@/config/index';
import {loadPreferences} from '@/config/preferences';
import {defaultTheme} from '@/config/themes';
import {resolveTune} from '@/config/tune';
import {CustomCommandExecutor} from '@/custom-commands/executor';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {setCliSessionId} from '@/session/cli-session-context';
import {generateKey} from '@/session/key-generator';
import {createTokenizer} from '@/tokenization/index.js';
import type {Task} from '@/tools/tasks/types';
import {ToolManager} from '@/tools/tool-manager';
import type {CheckpointListItem} from '@/types/checkpoint';
import type {CustomCommand} from '@/types/commands';
import type {AIProviderConfig, TuneConfig} from '@/types/config';
import {
	ApiCallRecord,
	ApiUsageSnapshot,
	ContextSource,
	DevelopmentMode,
	LLMClient,
	LSPConnectionStatus,
	MCPConnectionStatus,
	Message,
	ToolCall,
} from '@/types/core';
import type {UpdateInfo} from '@/types/index';
import type {Tokenizer} from '@/types/tokenization.js';
import type {ThemePreset} from '@/types/ui';
import {BoundedMap} from '@/utils/bounded-map';
import type {PendingQuestion} from '@/utils/question-queue';

export type ActiveMode =
	| 'model'
	| 'modelDatabase'
	| 'configWizard'
	| 'explorer'
	| 'ideSelection'
	| 'checkpointLoad'
	| 'sessionSelector'
	| 'tune'
	| null;

export function useAppState(
	initialDevelopmentMode: DevelopmentMode = 'normal',
) {
	// Initialize theme and title shape from preferences
	const preferences = loadPreferences();
	const initialTheme = preferences.selectedTheme || defaultTheme;
	const initialTitleShape = preferences.titleShape || 'pill';

	const [client, setClient] = useState<LLMClient | null>(null);
	const [messages, setMessages] = useState<Message[]>([]);
	// Held in a ref, not state: a cache write must not re-render the app or
	// change the identity of getMessageTokens. Returned from this hook only so
	// useAppState.spec.tsx can assert on it; there is no production consumer.
	const messageTokenCacheRef = useRef<BoundedMap<string, number> | null>(null);
	if (!messageTokenCacheRef.current) {
		messageTokenCacheRef.current = new BoundedMap({
			maxSize: 1000,
			// No TTL - cache is session-based and cleared on app restart
		});
	}
	const messageTokenCache = messageTokenCacheRef.current;
	const [currentModel, setCurrentModel] = useState<string>('');
	const [currentProvider, setCurrentProvider] =
		useState<string>('openai-compatible');
	const [currentProviderConfig, setCurrentProviderConfig] =
		useState<AIProviderConfig | null>(null);
	const [currentTheme, setCurrentTheme] = useState<ThemePreset>(initialTheme);
	const [currentTitleShape, setCurrentTitleShape] =
		useState<TitleShape>(initialTitleShape);
	const [toolManager, setToolManager] = useState<ToolManager | null>(null);
	const [customCommandLoader, setCustomCommandLoader] =
		useState<CustomCommandLoader | null>(null);
	const [customCommandExecutor, setCustomCommandExecutor] =
		useState<CustomCommandExecutor | null>(null);
	const [customCommandCache, setCustomCommandCache] = useState<
		Map<string, CustomCommand>
	>(new Map());
	const [startChat, setStartChat] = useState<boolean>(false);
	const [mcpInitialized, setMcpInitialized] = useState<boolean>(false);
	const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

	// Connection status states
	const [mcpServersStatus, setMcpServersStatus] = useState<
		MCPConnectionStatus[]
	>([]);
	const [lspServersStatus, setLspServersStatus] = useState<
		LSPConnectionStatus[]
	>([]);

	// Initialization status states
	const [preferencesLoaded, setPreferencesLoaded] = useState<boolean>(false);
	const [customCommandsCount, setCustomCommandsCount] = useState<number>(0);

	// Cancelling indicator state
	const [isCancelling, setIsCancelling] = useState<boolean>(false);
	const [isConversationComplete, setIsConversationComplete] =
		useState<boolean>(false);
	const [isSettingsMode, setIsSettingsMode] = useState<boolean>(false);
	const [settingsActiveTab, setSettingsActiveTab] = useState<
		SettingsTabId | undefined
	>(undefined);

	// Plan review state (post-plan-generation action bar)
	const [planReviewState, setPlanReviewState] = useState<{
		show: boolean;
		originalMessage: string;
	} | null>(null);
	// One-shot signal: set true by the chat handler when a turn that started in
	// plan mode completes uninterrupted. The interactive UI consumes it to show
	// the plan review bar (reading the latest messages), then resets it.
	const [planTurnCompleted, setPlanTurnCompleted] = useState<boolean>(false);
	// One-shot approved-plan message created when the user hits Proceed.
	// Dispatch is deferred to an effect
	// that waits for developmentMode to become 'normal', so the executing turn
	// runs with normal-mode tools/prompt instead of the stale plan-mode closures.
	const [pendingPlanProceed, setPendingPlanProceed] = useState<string | null>(
		null,
	);

	// Cancellation state
	const [abortController, setAbortController] =
		useState<AbortController | null>(null);

	// Unified modal/mode state - replaces 11 individual boolean states
	const [activeMode, setActiveMode] = useState<ActiveMode>(null);
	const [isVscodeEnabled, setIsVscodeEnabled] = useState<boolean>(false);
	const [checkpointLoadData, setCheckpointLoadData] = useState<{
		checkpoints: CheckpointListItem[];
		currentMessageCount: number;
	} | null>(null);
	const [showAllSessions, setShowAllSessions] = useState<boolean>(false);
	const [currentSessionId, setCurrentSessionIdState] = useState<string | null>(
		null,
	);
	const currentSessionIdRef = useRef<string | null>(null);
	const setCurrentSessionId = useCallback((value: string | null) => {
		currentSessionIdRef.current = value;
		setCliSessionId(value);
		setCurrentSessionIdState(value);
	}, []);
	const ensureCurrentSessionId = useCallback((): string => {
		if (currentSessionIdRef.current) return currentSessionIdRef.current;
		const id = randomUUID();
		currentSessionIdRef.current = id;
		setCliSessionId(id);
		setCurrentSessionIdState(id);
		return id;
	}, []);
	const [sessionName, setSessionName] = useState<string>('');
	const [isToolConfirmationMode, setIsToolConfirmationMode] =
		useState<boolean>(false);
	const [isToolExecuting, setIsToolExecuting] = useState<boolean>(false);
	const [liveComponentCapturesInput, setLiveComponentCapturesInput] =
		useState<boolean>(false);

	// Flipped once subagent loading finishes so the cached system prompt
	// can rebuild with the real agent list instead of "No subagents available."
	const [subagentsReady, setSubagentsReady] = useState<boolean>(false);

	// Track which subagent (if any) the user is currently attached to for interactive debugging
	const [attachedAgentId, setAttachedAgentId] = useState<string | null>(null);

	// Set to preference on launch, but can be toggled freely during runtime
	const [reasoningExpanded, setReasoningExpanded] = useState<boolean>(
		preferences.reasoningExpanded ?? false,
	);
	// Ref to access in async loops
	const reasoningExpandedRef = useRef(false);
	reasoningExpandedRef.current = reasoningExpanded;

	// Set to preference on launch, but can be toggled freely during runtime
	const [compactToolDisplay, setCompactToolDisplay] = useState<boolean>(
		preferences.compactToolDisplay ?? true,
	);
	// Ref keeps current value accessible to long-running async loops
	const compactToolDisplayRef = useRef(true);
	compactToolDisplayRef.current = compactToolDisplay;
	const [compactToolCounts, setCompactToolCounts] = useState<Record<
		string,
		number
	> | null>(null);
	// Mutable ref for the compact counts accumulator - shared between
	// the async conversation loop and the toggle handler
	const compactToolCountsRef = useRef<Record<string, number>>({});

	// Live task list state - renders in the live area (updating in-place)
	// instead of appending repeated task lists to the static chat queue
	const [liveTaskList, setLiveTaskListState] = useState<Task[] | null>(null);
	// Ctrl-T collapses the list into a status-bar badge for the rest of the
	// session. While collapsed, updates that land behind the user's back set
	// the unread marker so the badge can flag them.
	const [showTaskList, setShowTaskList] = useState<boolean>(true);
	const [taskListHasUnread, setTaskListHasUnread] = useState<boolean>(false);
	// Ref rather than the state value so setLiveTaskList (called from async
	// loops, and from the same tick as a toggle) always reads the live value.
	// toggleTaskList is the only writer of showTaskList, so the two stay in sync.
	const showTaskListRef = useRef(true);
	// Fingerprint of the last list we saw. Re-setting an unchanged list must not
	// light up the unread marker, so only real id/status churn counts.
	const taskListFingerprintRef = useRef('');

	const setLiveTaskList = useCallback((tasks: Task[] | null) => {
		const fingerprint = tasks?.map(t => `${t.id}:${t.status}`).join(',') ?? '';
		const changed = fingerprint !== taskListFingerprintRef.current;
		taskListFingerprintRef.current = fingerprint;

		if (!tasks || tasks.length === 0) {
			setTaskListHasUnread(false);
		} else if (changed && !showTaskListRef.current) {
			setTaskListHasUnread(true);
		}
		setLiveTaskListState(tasks);
	}, []);

	const toggleTaskList = useCallback(() => {
		const next = !showTaskListRef.current;
		showTaskListRef.current = next;
		setShowTaskList(next);
		// Expanding marks the list read; collapsing has nothing unread to carry
		// over, since everything in it was on screen a moment ago.
		setTaskListHasUnread(false);
	}, []);

	// Question mode state (ask_question tool)
	const [isQuestionMode, setIsQuestionMode] = useState<boolean>(false);
	const [pendingQuestion, setPendingQuestion] =
		useState<PendingQuestion | null>(null);

	// Development mode state
	const [developmentMode, setDevelopmentMode] = useState<DevelopmentMode>(
		initialDevelopmentMode,
	);
	// Ref keeps the current mode readable inside long-running async loops so a
	// mid-turn switch (e.g. flipping to yolo while tools are executing) takes
	// effect on the next tool call instead of only on the next message.
	const developmentModeRef = useRef<DevelopmentMode>(initialDevelopmentMode);
	developmentModeRef.current = developmentMode;

	// Model mode state — resolved from config layers on startup
	const [tune, setTune] = useState<TuneConfig>(() => {
		return resolveTune(getAppConfig(), undefined, preferences);
	});

	// Context usage state
	const [contextPercentUsed, setContextPercentUsed] = useState<number | null>(
		null,
	);
	const [contextLimit, setContextLimit] = useState<number | null>(null);
	// Whether the displayed context percentage is API-reported or estimated
	const [contextSource, setContextSource] = useState<ContextSource | null>(
		null,
	);
	// Most recent API-reported usage, tagged with the conversation length at
	// capture time (see ApiUsageSnapshot). Null when unavailable or stale.
	const [lastApiUsage, setLastApiUsage] = useState<ApiUsageSnapshot | null>(
		null,
	);

	// Per-call usage history accumulated across the session. Each entry
	// carries the provider/model active at that API call, so the /usage
	// command can compute accurate per-provider costs from real token counts.
	const [apiCallHistory, setApiCallHistory] = useState<ApiCallRecord[]>([]);

	// Tool confirmation state
	const [pendingToolCalls, setPendingToolCalls] = useState<ToolCall[]>([]);
	const [currentToolIndex, setCurrentToolIndex] = useState<number>(0);

	// Chat queue for components
	const [chatComponents, setChatComponents] = useState<React.ReactNode[]>([]);
	// Live component state - renders over top of the static chat queue
	// Used for loading indicators, live task progress, etc.
	const [liveComponent, setLiveComponent] = useState<React.ReactNode>(null);

	// Prompt Scrubbing Session
	const privacySessionMapRef = useRef<Record<string, string>>({});

	// Helper function to add components to the chat queue with stable keys
	const addToChatQueue = useCallback((component: React.ReactNode) => {
		let componentWithKey = component;
		if (React.isValidElement(component) && !component.key) {
			componentWithKey = React.cloneElement(component, {
				key: generateKey('chat-component'),
			});
		}

		setChatComponents(prevComponents => [...prevComponents, componentWithKey]);
	}, []);

	// Create tokenizer based on current provider and model
	const tokenizer = useMemo<Tokenizer>(() => {
		if (currentProvider && currentModel) {
			return createTokenizer(currentProvider, currentModel);
		}

		// Fallback to simple char/4 heuristic if provider/model not set
		return createTokenizer('', '');
	}, [currentProvider, currentModel]);

	// Cleanup tokenizer resources when it changes
	useEffect(() => {
		return () => {
			if (tokenizer.free) {
				tokenizer.free();
			}
		};
	}, [tokenizer]);

	// Helper function for token calculation with caching
	const getMessageTokens = useCallback(
		(message: Message) => {
			// Provider is part of the key because it selects the tokenizer
			// implementation (see the useMemo above). Two providers can serve the
			// same model name with different encoders, so keying on the model
			// alone would hand back counts produced by the previous tokenizer.
			// Keep this formula in sync with tokenCacheKey() in the spec.
			const cacheKey =
				(message.content || '') + message.role + currentProvider + currentModel;

			const cachedTokens = messageTokenCache.get(cacheKey);
			if (cachedTokens !== undefined) {
				return cachedTokens;
			}

			const tokens = tokenizer.countTokens(message);
			messageTokenCache.set(cacheKey, tokens);
			return tokens;
		},
		[messageTokenCache, tokenizer, currentProvider, currentModel],
	);

	// Tracks the messages array last written through updateMessages so we can
	// tell an in-conversation append from a wholesale replacement. All external
	// mutations go through updateMessages, so this never drifts from state.
	const prevMessagesRef = useRef<Message[]>([]);

	// Message updater - no limits, display all messages
	const updateMessages = useCallback((newMessages: Message[]) => {
		// Preserve the API usage snapshot across appends within the same
		// conversation (new user message, streamed reply, tool results) so the
		// context indicator keeps anchoring on the provider-reported total and
		// only estimates the fresh tail — otherwise the figure drops to the full
		// client-side estimate the instant a new message is added, then jumps back
		// up once the next response lands.
		//
		// An append keeps the prior messages as a prefix: same-or-greater length
		// with an unchanged opening message. Anything else — shrunk (/clear,
		// /compact) or a different first message (session resume, checkpoint
		// restore) — is a wholesale swap, so the snapshot no longer describes a
		// prefix of the conversation and must be dropped. (The chat loop
		// re-establishes a fresh snapshot via setLastApiUsage after each response.)
		const prev = prevMessagesRef.current;
		const first = newMessages[0];
		const prevFirst = prev[0];
		const isAppendInSameConversation =
			first !== undefined &&
			prevFirst !== undefined &&
			newMessages.length >= prev.length &&
			first.role === prevFirst.role &&
			first.content === prevFirst.content;
		if (!isAppendInSameConversation) {
			setLastApiUsage(null);
		}
		prevMessagesRef.current = newMessages;
		setMessages(newMessages);
	}, []);

	return {
		// State
		client,
		messages,
		messageTokenCache,
		currentModel,
		currentProvider,
		currentProviderConfig,
		currentTheme,
		currentTitleShape,
		reasoningExpanded,
		reasoningExpandedRef,
		toolManager,
		customCommandLoader,
		customCommandExecutor,
		customCommandCache,
		startChat,
		mcpInitialized,
		updateInfo,
		mcpServersStatus,
		lspServersStatus,
		preferencesLoaded,
		customCommandsCount,
		isCancelling,
		isConversationComplete,
		isSettingsMode,
		settingsActiveTab,
		planReviewState,
		planTurnCompleted,
		pendingPlanProceed,
		abortController,

		// Unified mode state
		activeMode,
		setActiveMode,

		// Derived mode booleans (read-only convenience)
		isExplorerMode: activeMode === 'explorer',
		isIdeSelectionMode: activeMode === 'ideSelection',

		isVscodeEnabled,
		checkpointLoadData,
		showAllSessions,
		currentSessionId,
		ensureCurrentSessionId,
		sessionName,
		isToolConfirmationMode,
		isToolExecuting,
		liveComponentCapturesInput,
		subagentsReady,
		compactToolDisplay,
		compactToolDisplayRef,
		compactToolCounts,
		compactToolCountsRef,
		liveTaskList,
		showTaskList,
		taskListHasUnread,
		toggleTaskList,
		isQuestionMode,
		pendingQuestion,
		developmentMode,
		developmentModeRef,
		tune,
		contextPercentUsed,
		contextLimit,
		contextSource,
		lastApiUsage,
		apiCallHistory,
		pendingToolCalls,
		currentToolIndex,
		chatComponents,
		tokenizer,
		attachedAgentId,

		// Setters
		setClient,
		setMessages,
		setCurrentModel,
		setCurrentProvider,
		setCurrentProviderConfig,
		setCurrentTheme,
		setCurrentTitleShape,
		setReasoningExpanded,
		setToolManager,
		setCustomCommandLoader,
		setCustomCommandExecutor,
		setCustomCommandCache,
		setStartChat,
		setMcpInitialized,
		setUpdateInfo,
		setMcpServersStatus,
		setLspServersStatus,
		setPreferencesLoaded,
		setCustomCommandsCount,
		setIsCancelling,
		setIsConversationComplete,
		setIsSettingsMode,
		setSettingsActiveTab,
		setPlanReviewState,
		setPlanTurnCompleted,
		setPendingPlanProceed,
		setAbortController,
		setIsVscodeEnabled,
		setCheckpointLoadData,
		setShowAllSessions,
		setCurrentSessionId,
		setSessionName,
		setIsToolConfirmationMode,
		setIsToolExecuting,
		setLiveComponentCapturesInput,
		setSubagentsReady,
		setCompactToolDisplay,
		setCompactToolCounts,
		setLiveTaskList,
		setIsQuestionMode,
		setPendingQuestion,
		setDevelopmentMode,
		setTune,
		setContextPercentUsed,
		setContextLimit,
		setContextSource,
		setLastApiUsage,
		setApiCallHistory,
		setPendingToolCalls,
		setCurrentToolIndex,
		setChatComponents,
		liveComponent,
		setLiveComponent,
		privacySessionMapRef,
		setAttachedAgentId,

		// Utilities
		addToChatQueue,
		getMessageTokens,
		updateMessages,
	};
}
