import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {TitleShape} from '@/components/ui/styled-title';
import {loadPreferences} from '@/config/preferences';
import {defaultTheme} from '@/config/themes';
import {CustomCommandExecutor} from '@/custom-commands/executor';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {createTokenizer} from '@/tokenization/index.js';
import {ToolManager} from '@/tools/tool-manager';
import type {CheckpointListItem} from '@/types/checkpoint';
import type {CustomCommand} from '@/types/commands';
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

	// Mode states
	const [isModelSelectionMode, setIsModelSelectionMode] =
		useState<boolean>(false);
	const [isProviderSelectionMode, setIsProviderSelectionMode] =
		useState<boolean>(false);
	const [isModelDatabaseMode, setIsModelDatabaseMode] =
		useState<boolean>(false);
	const [isConfigWizardMode, setIsConfigWizardMode] = useState<boolean>(false);
	const [isMcpWizardMode, setIsMcpWizardMode] = useState<boolean>(false);
	const [isCheckpointLoadMode, setIsCheckpointLoadMode] =
		useState<boolean>(false);
	const [checkpointLoadData, setCheckpointLoadData] = useState<{
		checkpoints: CheckpointListItem[];
		currentMessageCount: number;
	} | null>(null);
	const [isToolConfirmationMode, setIsToolConfirmationMode] =
		useState<boolean>(false);
	const [isToolExecuting, setIsToolExecuting] = useState<boolean>(false);

	// Development mode state
	const [developmentMode, setDevelopmentMode] =
		useState<DevelopmentMode>('normal');

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
		isModelSelectionMode,
		isProviderSelectionMode,
		isModelDatabaseMode,
		isConfigWizardMode,
		isMcpWizardMode,
		isCheckpointLoadMode,
		checkpointLoadData,
		isToolConfirmationMode,
		isToolExecuting,
		developmentMode,
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
		setIsModelSelectionMode,
		setIsProviderSelectionMode,
		setIsModelDatabaseMode,
		setIsConfigWizardMode,
		setIsMcpWizardMode,
		setIsCheckpointLoadMode,
		setCheckpointLoadData,
		setIsToolConfirmationMode,
		setIsToolExecuting,
		setDevelopmentMode,
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
