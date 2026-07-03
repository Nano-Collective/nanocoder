import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {TitleShape} from '@/components/ui/styled-title';
import {loadPreferences} from '@/config/preferences';
import {defaultTheme} from '@/config/themes';
import {resolveTune} from '@/config/tune';
import {CustomCommandExecutor} from '@/custom-commands/executor';
import {CustomCommandLoader} from '@/custom-commands/loader';
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
	| 'mcpWizard'
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
	const [messageTokenCache, setMessageTokenCache] = useState<
		BoundedMap<string, number>
	>(
		new BoundedMap({
			maxSize: 1000,
			// No TTL - cache is session-based and cleared on app restart
		}),
	);
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
	const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
	const [sessionName, setSessionName] = useState<string>('');
	const [isToolConfirmationMode, setIsToolConfirmationMode] =
		useState<boolean>(false);
	const [isToolExecuting, setIsToolExecuting] = useState<boolean>(false);

	// Flipped once subagent loading finishes so the cached system prompt
	// can rebuild with the real agent list instead of "No subagents available."
	const [subagentsReady, setSubagentsReady] = useState<boolean>(false);

	// Set to preference on launch, but can be toggled freely during runtime
	const [reasoningExpanded, setReasoningExpanded] = useState<boolean>(
		preferences.reasoningExpanded ?? false,
	);
	// Ref to access in async loops
	const reasoningExpandedRef = useRef(false);
	reasoningExpandedRef.current = reasoningExpanded;

	// Compact tool display state
	const [compactToolDisplay, setCompactToolDisplay] = useState<boolean>(true);
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
	const [liveTaskList, setLiveTaskList] = useState<Task[] | null>(null);

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
		return resolveTune(undefined, undefined, preferences);
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
	// Live component that renders outside Static for real-time updates (e.g., BashProgress)
	const [liveComponent, setLiveComponent] = useState<React.ReactNode>(null);

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
			const cacheKey = (message.content || '') + message.role + currentModel;

			const cachedTokens = messageTokenCache.get(cacheKey);
			if (cachedTokens !== undefined) {
				return cachedTokens;
			}

			const tokens = tokenizer.countTokens(message);
			// Defer cache update to avoid "Cannot update a component while rendering" error
			// This can happen when components call getMessageTokens during their render
			queueMicrotask(() => {
				setMessageTokenCache(prev => {
					const newCache = new BoundedMap<string, number>({
						maxSize: 1000,
					});
					// Copy existing entries
					for (const [k, v] of prev.entries()) {
						newCache.set(k, v);
					}
					// Add new entry
					newCache.set(cacheKey, tokens);
					return newCache;
				});
			});
			return tokens;
		},
		[messageTokenCache, tokenizer, currentModel],
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
		sessionName,
		isToolConfirmationMode,
		isToolExecuting,
		subagentsReady,
		compactToolDisplay,
		compactToolDisplayRef,
		compactToolCounts,
		compactToolCountsRef,
		liveTaskList,
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

		// Setters
		setClient,
		setMessages,
		setMessageTokenCache,
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
		setAbortController,
		setIsVscodeEnabled,
		setCheckpointLoadData,
		setShowAllSessions,
		setCurrentSessionId,
		setSessionName,
		setIsToolConfirmationMode,
		setIsToolExecuting,
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

		// Utilities
		addToChatQueue,
		getMessageTokens,
		updateMessages,
	};
}
