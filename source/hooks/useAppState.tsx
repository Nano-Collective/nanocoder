import {useState, useCallback, useEffect} from 'react';
import {LLMClient, Message, DevelopmentMode, ToolCall} from '@/types/core';
import {ToolManager} from '@/tools/tool-manager';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {CustomCommandExecutor} from '@/custom-commands/executor';
import {loadPreferences} from '@/config/preferences';
import {defaultTheme} from '@/config/themes';
import type {ThemePreset} from '@/types/ui';
import type {UpdateInfo, ToolResult} from '@/types/index';
import type {CustomCommand} from '@/types/commands';
import {SessionManager, Session} from '@/session/session-manager';
import React from 'react';

export interface ConversationContext {
	updatedMessages: Message[];
	assistantMsg: Message;
	systemMessage: Message;
}

export function useAppState() {
	// Initialize theme from preferences
	const preferences = loadPreferences();
	const initialTheme = preferences.selectedTheme || defaultTheme;

	const [client, setClient] = useState<LLMClient | null>(null);
	const [messages, setMessages] = useState<Message[]>([]);
	const [displayMessages, setDisplayMessages] = useState<Message[]>([]);
	const [messageTokenCache, setMessageTokenCache] = useState<
		Map<string, number>
	>(new Map());
	const [currentModel, setCurrentModel] = useState<string>('');
	const [currentProvider, setCurrentProvider] =
		useState<string>('openai-compatible');
	const [currentTheme, setCurrentTheme] = useState<ThemePreset>(initialTheme);
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

	// Thinking indicator state
	const [isThinking, setIsThinking] = useState<boolean>(false);
	const [isCancelling, setIsCancelling] = useState<boolean>(false);

	// Cancellation state
	const [abortController, setAbortController] =
		useState<AbortController | null>(null);

	// Mode states
		const [isModelSelectionMode, setIsModelSelectionMode] =
			useState<boolean>(false);
		const [isProviderSelectionMode, setIsProviderSelectionMode] =
			useState<boolean>(false);
		const [isThemeSelectionMode, setIsThemeSelectionMode] =
			useState<boolean>(false);
		const [isRecommendationsMode, setIsRecommendationsMode] =
			useState<boolean>(false);
		const [isConfigWizardMode, setIsConfigWizardMode] = useState<boolean>(false);
		const [isToolConfirmationMode, setIsToolConfirmationMode] =
		useState<boolean>(false);
		const [isToolExecuting, setIsToolExecuting] = useState<boolean>(false);
		const [isBashExecuting, setIsBashExecuting] = useState<boolean>(false);
		const [currentBashCommand, setCurrentBashCommand] = useState<string>('');
		const [isSessionSelectionMode, setIsSessionSelectionMode] = useState<boolean>(false);

	// Session management states
	const [sessionManager, setSessionManager] = useState<SessionManager | null>(null);
	const [currentSession, setCurrentSession] = useState<Session | null>(null);
	const [sessionSaveTimeout, setSessionSaveTimeout] = useState<NodeJS.Timeout | null>(null);

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
	const [componentKeyCounter, setComponentKeyCounter] = useState(0);

	// Helper function to add components to the chat queue with stable keys and memory optimization
	const addToChatQueue = useCallback(
		(component: React.ReactNode) => {
			const newCounter = componentKeyCounter + 1;
			setComponentKeyCounter(newCounter);

			let componentWithKey = component;
			if (React.isValidElement(component) && !component.key) {
				componentWithKey = React.cloneElement(component, {
					key: `chat-component-${newCounter}`,
				});
			}

			setChatComponents(prevComponents => {
				const newComponents = [...prevComponents, componentWithKey];
				// Keep reasonable limit in memory for performance
				return newComponents.length > 50
					? newComponents.slice(-50)
					: newComponents;
			});
		},
		[componentKeyCounter],
	);

	// Helper function for token calculation with caching
	const getMessageTokens = useCallback(
		(message: Message) => {
			const cacheKey = (message.content || '') + message.role;

			const cachedTokens = messageTokenCache.get(cacheKey);
			if (cachedTokens !== undefined) {
				return cachedTokens;
			}

			const tokens = Math.ceil((message.content?.length || 0) / 4);
			setMessageTokenCache(prev => new Map(prev).set(cacheKey, tokens));
			return tokens;
		},
		[messageTokenCache],
	);

	// Helper function to convert app Message to session message format
	const convertMessageToSessionFormat = (message: Message) => {
	  return {
	    role: message.role as 'user' | 'assistant' | 'system' | 'tool',
	    content: message.content,
	    timestamp: Date.now(),
	    tool_calls: message.tool_calls,
	    tool_call_id: message.tool_call_id,
	    name: message.name,
	  };
	};

	// Helper function to convert session message to app Message format
	const convertSessionMessageToAppFormat = (sessionMessage: {
	  role: 'user' | 'assistant' | 'system' | 'tool';
	  content: string;
	  timestamp: number;
	  tool_calls?: Array<{
	    id: string;
	    function: {
	      name: string;
	      arguments: Record<string, unknown>;
	    };
	  }>;
	  tool_call_id?: string;
	  name?: string;
	}): Message => {
	  const result: Message = {
	    role: sessionMessage.role,
	    content: sessionMessage.content,
	  };
	  
	  // Add optional fields if they exist
	  if (sessionMessage.tool_calls) result.tool_calls = sessionMessage.tool_calls;
	  if (sessionMessage.tool_call_id) result.tool_call_id = sessionMessage.tool_call_id;
	  if (sessionMessage.name) result.name = sessionMessage.name;
	  
	  return result;
	};

	// Optimized message updater that separates display from context
	const updateMessages = useCallback((newMessages: Message[]) => {
		setMessages(newMessages); // Full context always preserved for model

		// Limit display messages for UI performance only
		const displayLimit = 30;
		setDisplayMessages(
			newMessages.length > displayLimit
				? newMessages.slice(-displayLimit)
				: newMessages,
		);
		
		// Update the current session if one exists
		if (currentSession && sessionManager) {
			const sessionMessages = newMessages.map(convertMessageToSessionFormat);
			const updatedSession = {
				...currentSession,
				messages: sessionMessages,
				metadata: {
					...(currentSession.metadata || {}),
					lastAccessedAt: Date.now(),
					messageCount: newMessages.length,
				},
			};
			setCurrentSession(updatedSession);
		}
	}, [currentSession, sessionManager]);

	// Function to save session with debouncing
	const saveSessionDebounced = useCallback((sessionToSave: Session) => {
		// Clear any existing timeout
		if (sessionSaveTimeout) {
			clearTimeout(sessionSaveTimeout);
		}

		// Set a new timeout to save the session after 1 second of inactivity
		const timeout = setTimeout(() => {
			sessionManager?.saveSession(sessionToSave).catch(error => {
				console.error('Failed to save session:', error);
			});
		}, 1000); // 1 second debounce

		setSessionSaveTimeout(timeout);
	}, [sessionManager, sessionSaveTimeout]);

	// Initialize SessionManager and handle session loading on app startup
	useEffect(() => {
	  const initializeSessionManager = async () => {
	    const manager = new SessionManager();
	    await manager.initialize();
	    setSessionManager(manager);

	    // Try to load the most recent session or create a new one
	    try {
	      const sessions = await manager.listSessions();
	      if (sessions.length > 0) {
	        // Load the most recently updated session
	        const mostRecentSession = sessions.reduce((latest, session) =>
	          session.updatedAt > latest.updatedAt ? session : latest,
	          sessions[0]
	        );
	        
	        const loadedSession = await manager.loadSession(mostRecentSession.id);
	        if (loadedSession) {
	          setCurrentSession(loadedSession);
	          const appMessages = loadedSession.messages.map(convertSessionMessageToAppFormat);
	          setMessages(appMessages);
	        }
	      } else {
	        // Create a new session if no existing sessions
	        const newSession = await manager.createSession();
	        setCurrentSession(newSession);
	      }
	      
	      // Run cleanup of old sessions in the background
	      manager.cleanupOldSessions().catch(error => {
	        console.error('Failed to cleanup old sessions:', error);
	      });
	    } catch (error) {
	      console.error('Failed to load session:', error);
	      // Create a new session if loading fails
	      const newSession = await manager.createSession();
	      setCurrentSession(newSession);
	    }
	    
	    // Start auto-save functionality
	    manager.startAutoSave();
	  };
	  
	  initializeSessionManager();
	  
	  // Cleanup function to save session on exit
	  return () => {
	    if (sessionManager && currentSession && messages) {
	      const sessionMessages = messages.map(convertMessageToSessionFormat);
	      const sessionToSave = {
	        ...currentSession,
	        messages: sessionMessages,
	        metadata: {
	          ...(currentSession.metadata || {}),
	          lastAccessedAt: Date.now(),
	          messageCount: messages.length,
	        },
	      };
	      
	      // Attempt to save the session immediately during cleanup
	      sessionManager.saveSession(sessionToSave).catch(error => {
	        console.error('Failed to save session on exit:', error);
	      });
	    }
	    
	    // Clear any pending save timeouts
	    if (sessionSaveTimeout) {
	      clearTimeout(sessionSaveTimeout);
	    }
	    
	    // Stop auto-save and cleanup resources
	    sessionManager?.stopAutoSave();
	    sessionManager?.cleanup().catch(error => {
	      console.error('Failed to cleanup session manager:', error);
	    });
	  };
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
		toolManager,
		customCommandLoader,
		customCommandExecutor,
		customCommandCache,
		startChat,
		mcpInitialized,
		updateInfo,
		isThinking,
		isCancelling,
		abortController,
		isModelSelectionMode,
		isProviderSelectionMode,
		isThemeSelectionMode,
		isRecommendationsMode,
		isConfigWizardMode,
		isToolConfirmationMode,
		isToolExecuting,
		isBashExecuting,
		currentBashCommand,
		developmentMode,
		pendingToolCalls,
		currentToolIndex,
		completedToolResults,
		currentConversationContext,
		chatComponents,
		componentKeyCounter,
	isSessionSelectionMode,

		// Setters
			setClient,
			setMessages,
			setDisplayMessages,
			setMessageTokenCache,
			setCurrentModel,
			setCurrentProvider,
			setCurrentTheme,
			setToolManager,
			setCustomCommandLoader,
			setCustomCommandExecutor,
			setCustomCommandCache,
			setStartChat,
			setMcpInitialized,
			setUpdateInfo,
			setIsThinking,
			setIsCancelling,
			setAbortController,
			setIsModelSelectionMode,
			setIsProviderSelectionMode,
			setIsThemeSelectionMode,
			setIsRecommendationsMode,
			setIsConfigWizardMode,
			setIsToolConfirmationMode,
			setIsToolExecuting,
			setIsBashExecuting,
			setCurrentBashCommand,
			setDevelopmentMode,
			setPendingToolCalls,
			setCurrentToolIndex,
			setCompletedToolResults,
			setCurrentConversationContext,
			setChatComponents,
			setComponentKeyCounter,
			setIsSessionSelectionMode,

		// Utilities
	addToChatQueue,
		getMessageTokens,
		updateMessages,
		resetToolConfirmationState,
		// Session management
		sessionManager,
		currentSession,
		setCurrentSession,
		saveSessionDebounced,
		convertMessageToSessionFormat,
	convertSessionMessageToAppFormat,
	};
}
