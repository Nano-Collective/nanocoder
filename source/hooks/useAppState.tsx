import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {TitleShape} from '@/components/ui/styled-title';
import {loadPreferences} from '@/config/preferences';
import {defaultTheme} from '@/config/themes';
import {resolveTune} from '@/config/tune';
import {CustomCommandExecutor} from '@/custom-commands/executor';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {createTokenizer} from '@/tokenization/index.js';
import type {Task} from '@/tools/tasks/types';
import {ToolManager} from '@/tools/tool-manager';
import type {CheckpointListItem} from '@/types/checkpoint';
import type {CustomCommand} from '@/types/commands';
import type {TuneConfig} from '@/types/config';
import {
	DevelopmentMode,
	LLMClient,
	LSPConnectionStatus,
	MCPConnectionStatus,
	Message,
	ToolCall,
} from '@/types/core';
import type {ToolResult, UpdateInfo} from '@/types/index';
import type {Tokenizer} from '@/types/tokenization.js';
import type {ThemePreset} from '@/types/ui';
import {BoundedMap} from '@/utils/bounded-map';
import type {PendingQuestion} from '@/utils/question-queue';

export type ActiveMode =
	| 'model'
	| 'provider'
	| 'modelDatabase'
	| 'configWizard'
	| 'mcpWizard'
	| 'explorer'
	| 'ideSelection'
	| 'scheduler'
	| 'checkpointLoad'
	| 'sessionSelector'
	| 'tune'
	| null;

export interface ConversationContext {
	/**
	 * All messages up to (but not including) tool execution.
	 * Includes user message, auto-executed messages, and assistant message with tool_calls.
	 */
	messagesBeforeToolExecution: Message[];
	/**
	 * The assistant message that triggered tool execution.
	 * Included in messagesBeforeToolExecution for reference.
	 */
	assistantMsg: Message;
	/**
	 * System message for the next turn after tool execution.
	 */
	systemMessage: Message;
}

export function useAppState() {
	// Initialize theme and title shape from preferences
	const preferences = loadPreferences();
	const initialTheme = preferences.selectedTheme || defaultTheme;
	const initialTitleShape = preferences.titleShape || 'pill';

	const [client, setClient] = useState<LLMClient | null>(null);
	const [messages, setMessages] = useState<Message[]>([]);
	const [displayMessages, setDisplayMessages] = useState<Message[]>([]);
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
	const [isToolConfirmationMode, setIsToolConfirmationMode] =
		useState<boolean>(false);
	const [isToolExecuting, setIsToolExecuting] = useState<boolean>(false);

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
	const [developmentMode, setDevelopmentMode] =
		useState<DevelopmentMode>('normal');

	// Model mode state — resolved from config layers on startup
	const [tune, setTune] = useState<TuneConfig>(() => {
		return resolveTune(undefined, undefined, preferences);
	});

	// Context usage state
	const [contextPercentUsed, setContextPercentUsed] = useState<number | null>(
		null,
	);
	const [contextLimit, setContextLimit] = useState<number | null>(null);

	// Tool confirmation state
	const [pendingToolCalls, setPendingToolCalls] = useState<ToolCall[]>([]);
	const [currentToolIndex, setCurrentToolIndex] = useState<number>(0);
	const [completedToolResults, setCompletedToolResults] = useState<
		ToolResult[]
	>([]);
	const [currentConversationContext, setCurrentConversationContext] =
		useState<ConversationContext | null>(null);

	// Chat queue for components
	const [chatComponents, setChatComponents] = useState<React.ReactNode[]>([]);
	// Live component that renders outside Static for real-time updates (e.g., BashProgress)
	const [liveComponent, setLiveComponent] = useState<React.ReactNode>(null);
	// Use ref for component key counter to avoid stale closure issues
	// State updates are async/batched, but ref updates are synchronous
	// This prevents duplicate keys when addToChatQueue is called rapidly
	const componentKeyCounterRef = useRef(0);

	// Get the next unique component key - synchronous to prevent duplicates
	const getNextComponentKey = useCallback(() => {
		componentKeyCounterRef.current += 1;
		return componentKeyCounterRef.current;
	}, []);

	// Helper function to add components to the chat queue with stable keys
	const addToChatQueue = useCallback(
		(component: React.ReactNode) => {
			const newCounter = getNextComponentKey();

			let componentWithKey = component;
			if (React.isValidElement(component) && !component.key) {
				componentWithKey = React.cloneElement(component, {
					key: `chat-component-${newCounter}`,
				});
			}

			setChatComponents(prevComponents => [
				...prevComponents,
				componentWithKey,
			]);
		},
		[getNextComponentKey],
	);

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

	// Message updater - no limits, display all messages
	const updateMessages = useCallback((newMessages: Message[]) => {
		setMessages(newMessages);
		setDisplayMessages(newMessages);
	}, []);

	// Reset tool confirmation state
	const resetToolConfirmationState = () => {
		setIsToolConfirmationMode(false);
		setIsToolExecuting(false);
		setPendingToolCalls([]);
		setCurrentToolIndex(0);
		setCompletedToolResults([]);
		setCurrentConversationContext(null);
	};

	return {
		// State
		client,
		messages,
		displayMessages,
		messageTokenCache,
		currentModel,
		currentProvider,
		currentTheme,
		currentTitleShape,
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
		isModelSelectionMode: activeMode === 'model',
		isProviderSelectionMode: activeMode === 'provider',
		isModelDatabaseMode: activeMode === 'modelDatabase',
		isConfigWizardMode: activeMode === 'configWizard',
		isMcpWizardMode: activeMode === 'mcpWizard',
		isCheckpointLoadMode: activeMode === 'checkpointLoad',
		isExplorerMode: activeMode === 'explorer',
		isIdeSelectionMode: activeMode === 'ideSelection',
		isSchedulerMode: activeMode === 'scheduler',
		isSessionSelectorMode: activeMode === 'sessionSelector',
		isTuneActive: activeMode === 'tune',

		isVscodeEnabled,
		checkpointLoadData,
		showAllSessions,
		currentSessionId,
		isToolConfirmationMode,
		isToolExecuting,
		compactToolDisplay,
		compactToolDisplayRef,
		compactToolCounts,
		compactToolCountsRef,
		liveTaskList,
		isQuestionMode,
		pendingQuestion,
		developmentMode,
		tune,
		contextPercentUsed,
		contextLimit,
		pendingToolCalls,
		currentToolIndex,
		completedToolResults,
		currentConversationContext,
		chatComponents,
		getNextComponentKey,
		tokenizer,

		// Setters
		setClient,
		setMessages,
		setDisplayMessages,
		setMessageTokenCache,
		setCurrentModel,
		setCurrentProvider,
		setCurrentTheme,
		setCurrentTitleShape,
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
		setIsToolConfirmationMode,
		setIsToolExecuting,
		setCompactToolDisplay,
		setCompactToolCounts,
		setLiveTaskList,
		setIsQuestionMode,
		setPendingQuestion,
		setDevelopmentMode,
		setTune,
		setContextPercentUsed,
		setContextLimit,
		setPendingToolCalls,
		setCurrentToolIndex,
		setCompletedToolResults,
		setCurrentConversationContext,
		setChatComponents,
		liveComponent,
		setLiveComponent,

		// Utilities
		addToChatQueue,
		getMessageTokens,
		updateMessages,
		resetToolConfirmationState,
	};
}
