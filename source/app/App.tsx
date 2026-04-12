import {Box, Text, useApp} from 'ink';
import Spinner from 'ink-spinner';
import React, {useEffect, useMemo} from 'react';
import {createStaticComponents} from '@/app/components/app-container';
import {ChatHistory} from '@/app/components/chat-history';
import {ChatInput} from '@/app/components/chat-input';
import {ModalSelectors} from '@/app/components/modal-selectors';
import type {AppProps} from '@/app/types';
import {FileExplorer} from '@/components/file-explorer';
import {IdeSelector} from '@/components/ide-selector';
import {SuccessMessage} from '@/components/message-box';
import {SchedulerView} from '@/components/scheduler-view';
import SecurityDisclaimer from '@/components/security-disclaimer';
import StreamingMessage from '@/components/streaming-message';
import type {TitleShape} from '@/components/ui/styled-title';
import {
	shouldPromptExtensionInstall,
	VSCodeExtensionPrompt,
} from '@/components/vscode-extension-prompt';
import WelcomeMessage from '@/components/welcome-message';
import {getAppConfig} from '@/config/index';
import {updateSelectedTheme} from '@/config/preferences';
import {getThemeColors} from '@/config/themes';
import {setCurrentMode as setCurrentModeContext} from '@/context/mode-context';
import {useChatHandler} from '@/hooks/chat-handler';
import {useAppHandlers} from '@/hooks/useAppHandlers';
import {useAppInitialization} from '@/hooks/useAppInitialization';
import {useAppState} from '@/hooks/useAppState';
import {useContextPercentage} from '@/hooks/useContextPercentage';
import {useDirectoryTrust} from '@/hooks/useDirectoryTrust';
import {useModeHandlers} from '@/hooks/useModeHandlers';
import {useNonInteractiveMode} from '@/hooks/useNonInteractiveMode';
import {useNotifications} from '@/hooks/useNotifications';
import {useSchedulerMode} from '@/hooks/useSchedulerMode';
import {useSessionAutosave} from '@/hooks/useSessionAutosave';
import {ThemeContext} from '@/hooks/useTheme';
import {TitleShapeContext, updateTitleShape} from '@/hooks/useTitleShape';
import {useToolHandler} from '@/hooks/useToolHandler';
import {UIStateProvider} from '@/hooks/useUIState';
import {useVSCodeServer} from '@/hooks/useVSCodeServer';
import type {ThemePreset} from '@/types/ui';
import {
	generateCorrelationId,
	withNewCorrelationContext,
} from '@/utils/logging';
import {createPinoLogger} from '@/utils/logging/pino-logger';
import {setGlobalMessageQueue} from '@/utils/message-queue';
import {setNotificationsConfig} from '@/utils/notifications';
import {
	type PendingQuestion,
	setGlobalQuestionHandler,
} from '@/utils/question-queue';
import {getShutdownManager} from '@/utils/shutdown';
import {
	type PendingToolApproval,
	setGlobalToolApprovalHandler,
} from '@/utils/tool-approval-queue';
import {displayCompactCountsSummary} from '@/utils/tool-result-display';
import {isExtensionInstalled} from '@/vscode/extension-installer';
import {shouldRenderWelcome} from './helpers';

export default function App({
	vscodeMode = false,
	vscodePort,
	nonInteractivePrompt,
	nonInteractiveMode = false,
	cliProvider,
	cliModel,
}: AppProps) {
	// Memoize the logger to prevent recreation on every render
	const logger = useMemo(() => createPinoLogger(), []);

	// Log application startup with key configuration
	React.useEffect(() => {
		logger.info('Nanocoder application starting', {
			vscodeMode,
			vscodePort,
			nodeEnv: process.env.NODE_ENV || 'development',
			platform: process.platform,
			pid: process.pid,
		});
	}, [logger, vscodeMode, vscodePort]);

	// Use extracted hooks
	const appState = useAppState();
	const {exit} = useApp();
	const {isTrusted, handleConfirmTrust, isTrustLoading, isTrustedError} =
		useDirectoryTrust();

	// Sync global mode context whenever development mode changes.
	// Note: This useEffect serves as a backup synchronization mechanism.
	// Primary synchronization happens synchronously at the call sites:
	// - useNonInteractiveMode.ts: setCurrentModeContext() called with setDevelopmentMode()
	// - useToolHandler.tsx: setCurrentModeContext() called with setDevelopmentMode()
	// - useAppHandlers.tsx: setCurrentModeContext() called within handleToggleDevelopmentMode()
	// This effect ensures the global context stays in sync even if new code paths
	// are added that update React state without updating the global context.
	React.useEffect(() => {
		setCurrentModeContext(appState.developmentMode);

		logger.info('Development mode changed', {
			newMode: appState.developmentMode,
			previousMode: undefined,
		});
	}, [appState.developmentMode, logger]);

	// VS Code extension installation prompt state
	const [showExtensionPrompt, setShowExtensionPrompt] = React.useState(
		() => vscodeMode && shouldPromptExtensionInstall(),
	);
	const [extensionPromptComplete, setExtensionPromptComplete] =
		React.useState(false);

	const handleExit = () => {
		exit();
		void getShutdownManager().gracefulShutdown(0);
	};

	// VS Code server integration
	// Reference to handleMessageSubmit that will be set after appHandlers is created
	const handleMessageSubmitRef = React.useRef<
		((message: string) => void) | null
	>(null);

	const handleVSCodePrompt = React.useCallback(
		(
			prompt: string,
			context?: {
				filePath?: string;
				selection?: string;
				fileName?: string;
				startLine?: number;
				endLine?: number;
				cursorPosition?: {line: number; character: number};
			},
		) => {
			const correlationId = generateCorrelationId();

			logger.info('VS Code prompt received', {
				promptLength: prompt.length,
				hasContext: !!context,
				filePath: context?.filePath,
				hasSelection: !!context?.selection,
				cursorPosition: context?.cursorPosition,
				correlationId,
			});

			// Build the full prompt with code context for the LLM
			let fullPrompt = prompt;
			if (context?.selection && context?.fileName) {
				const lineInfo =
					context.startLine && context.endLine
						? ` (lines ${context.startLine}-${context.endLine})`
						: '';
				// Format: question + placeholder tag (for display) + hidden code block (for LLM)
				// The placeholder tag [@filename] will be highlighted in the UI
				// The code block is included for the LLM but won't clutter the display
				fullPrompt = `${prompt}\n\n[@${context.fileName}${lineInfo}]<!--vscode-context-->\n\`\`\`\n${context.selection}\n\`\`\`<!--/vscode-context-->`;
			}

			logger.debug('VS Code enhanced prompt prepared', {
				enhancedPromptLength: fullPrompt.length,
				correlationId,
			});

			// Submit the prompt to the chat
			if (handleMessageSubmitRef.current) {
				handleMessageSubmitRef.current(fullPrompt);
			} else {
				logger.warn(
					'VS Code prompt received but handleMessageSubmit not ready',
					{
						correlationId,
					},
				);
			}
		},
		[logger],
	);

	const effectiveVscodeEnabled = vscodeMode || appState.isVscodeEnabled;

	const vscodeServer = useVSCodeServer({
		enabled: effectiveVscodeEnabled,
		port: vscodePort,
		currentModel: appState.currentModel,
		currentProvider: appState.currentProvider,
		onPrompt: handleVSCodePrompt,
	});

	// Create theme context value
	const themeContextValue = {
		currentTheme: appState.currentTheme,
		colors: getThemeColors(appState.currentTheme),
		setCurrentTheme: (theme: ThemePreset) => {
			appState.setCurrentTheme(theme);
			updateSelectedTheme(theme);
		},
	};

	// Create title shape context value
	const titleShapeContextValue = {
		currentTitleShape: appState.currentTitleShape,
		setCurrentTitleShape: (shape: TitleShape) => {
			appState.setCurrentTitleShape(shape);
			updateTitleShape(shape);
		},
	};

	// Initialize global message queue on component mount
	React.useEffect(() => {
		setGlobalMessageQueue(appState.addToChatQueue);

		logger.debug('Global message queue initialized', {
			chatQueueFunction: 'addToChatQueue',
		});
	}, [appState.addToChatQueue, logger]);

	// Question handler - ref holds the resolver for the pending question promise
	const questionResolverRef = React.useRef<((answer: string) => void) | null>(
		null,
	);

	// Initialize global question handler
	React.useEffect(() => {
		setGlobalQuestionHandler((question: PendingQuestion) => {
			return new Promise<string>(resolve => {
				questionResolverRef.current = resolve;
				appState.setPendingQuestion(question);
				appState.setIsQuestionMode(true);
			});
		});
	}, [appState.setPendingQuestion, appState.setIsQuestionMode, appState]);

	// Handle user answering a question
	const handleQuestionAnswer = React.useCallback(
		(answer: string) => {
			if (questionResolverRef.current) {
				questionResolverRef.current(answer);
				questionResolverRef.current = null;
			}
			appState.setIsQuestionMode(false);
			appState.setPendingQuestion(null);
		},
		[appState.setIsQuestionMode, appState.setPendingQuestion, appState],
	);

	// Subagent tool approval handler — uses a dedicated state slot so it
	// doesn't conflict with the main agent's tool confirmation flow.
	const toolApprovalResolverRef = React.useRef<
		((approved: boolean) => void) | null
	>(null);
	const [pendingSubagentApproval, setPendingSubagentApproval] =
		React.useState<PendingToolApproval | null>(null);

	React.useEffect(() => {
		setGlobalToolApprovalHandler((approval: PendingToolApproval) => {
			return new Promise<boolean>(resolve => {
				toolApprovalResolverRef.current = resolve;
				setPendingSubagentApproval(approval);
				// Don't clear the live component — AgentProgress renders above
				// the chat input, and ToolConfirmation renders below it.
				// They coexist without conflict.
			});
		});
	}, []);

	const handleSubagentToolApproval = React.useCallback((confirmed: boolean) => {
		if (toolApprovalResolverRef.current) {
			toolApprovalResolverRef.current(confirmed);
			toolApprovalResolverRef.current = null;
		}
		setPendingSubagentApproval(null);
	}, []);

	// Log important application state changes
	React.useEffect(() => {
		if (appState.client) {
			logger.info('AI client initialized', {
				provider: appState.currentProvider,
				model: appState.currentModel,
				hasToolManager: !!appState.toolManager,
			});
		}
	}, [
		appState.client,
		appState.currentProvider,
		appState.currentModel,
		appState.toolManager,
		logger,
	]);

	React.useEffect(() => {
		if (appState.mcpInitialized) {
			logger.info('MCP servers initialized', {
				serverCount: appState.mcpServersStatus?.length || 0,
				status: 'connected',
			});
		}
	}, [appState.mcpInitialized, appState.mcpServersStatus, logger]);

	React.useEffect(() => {
		if (appState.updateInfo) {
			logger.info('Update information available', {
				hasUpdate: appState.updateInfo.hasUpdate,
				currentVersion: appState.updateInfo.currentVersion,
				latestVersion: appState.updateInfo.latestVersion,
			});
		}
	}, [appState.updateInfo, logger]);

	// Initialize notifications config from app config (once)
	React.useEffect(() => {
		const config = getAppConfig();
		if (config.notifications) {
			setNotificationsConfig(config.notifications);
		}
	}, []);

	// Setup chat handler
	const chatHandler = useChatHandler({
		client: appState.client,
		toolManager: appState.toolManager,
		customCommandLoader: appState.customCommandLoader,
		messages: appState.messages,
		setMessages: appState.updateMessages,
		currentProvider: appState.currentProvider,
		currentModel: appState.currentModel,
		setIsCancelling: appState.setIsCancelling,
		addToChatQueue: appState.addToChatQueue,
		getNextComponentKey: appState.getNextComponentKey,
		abortController: appState.abortController,
		setAbortController: appState.setAbortController,
		developmentMode: appState.developmentMode,
		nonInteractiveMode,
		onStartToolConfirmationFlow: (
			toolCalls,
			messagesBeforeToolExecution,
			assistantMsg,
			systemMessage,
		) => {
			appState.setPendingToolCalls(toolCalls);
			appState.setCurrentToolIndex(0);
			appState.setCompletedToolResults([]);
			appState.setCurrentConversationContext({
				messagesBeforeToolExecution,
				assistantMsg,
				systemMessage,
			});
			appState.setIsToolConfirmationMode(true);
		},
		onConversationComplete: () => {
			appState.setIsConversationComplete(true);
			appState.setCompactToolCounts(null);
			appState.compactToolCountsRef.current = {};
			appState.setLiveTaskList(null);
		},
		compactToolDisplayRef: appState.compactToolDisplayRef,
		onSetCompactToolCounts: appState.setCompactToolCounts,
		compactToolCountsRef: appState.compactToolCountsRef,
		onSetLiveTaskList: appState.setLiveTaskList,
		setLiveComponent: appState.setLiveComponent,
		tune: appState.tune,
	});

	// Desktop notifications on state transitions
	useNotifications({
		isToolConfirmationMode: appState.isToolConfirmationMode,
		isQuestionMode: appState.isQuestionMode,
		isGenerating: chatHandler.isGenerating,
		isToolExecuting: appState.isToolExecuting,
	});

	// Track when streaming starts for tok/s calculation
	const streamingStartRef = React.useRef<number>(Date.now());
	const prevIsGenerating = React.useRef(false);
	if (chatHandler.isGenerating && !prevIsGenerating.current) {
		streamingStartRef.current = Date.now();
	}
	prevIsGenerating.current = chatHandler.isGenerating;

	// Track context window usage percentage
	useContextPercentage({
		currentModel: appState.currentModel,
		messages: appState.messages,
		tokenizer: appState.tokenizer,
		getMessageTokens: appState.getMessageTokens,
		toolManager: appState.toolManager,
		streamingTokenCount: chatHandler.tokenCount,
		contextLimit: appState.contextLimit,
		setContextPercentUsed: appState.setContextPercentUsed,
		setContextLimit: appState.setContextLimit,
		developmentMode: appState.developmentMode,
		tune: appState.tune,
	});

	// Setup tool handler
	const toolHandler = useToolHandler({
		pendingToolCalls: appState.pendingToolCalls,
		currentToolIndex: appState.currentToolIndex,
		completedToolResults: appState.completedToolResults,
		currentConversationContext: appState.currentConversationContext,
		setPendingToolCalls: appState.setPendingToolCalls,
		setCurrentToolIndex: appState.setCurrentToolIndex,
		setCompletedToolResults: appState.setCompletedToolResults,
		setCurrentConversationContext: appState.setCurrentConversationContext,
		setIsToolConfirmationMode: appState.setIsToolConfirmationMode,
		setIsToolExecuting: appState.setIsToolExecuting,
		setMessages: appState.updateMessages,
		addToChatQueue: appState.addToChatQueue,
		setLiveComponent: appState.setLiveComponent,
		getNextComponentKey: appState.getNextComponentKey,
		resetToolConfirmationState: appState.resetToolConfirmationState,
		onProcessAssistantResponse: chatHandler.processAssistantResponse,
		client: appState.client,
		currentProvider: appState.currentProvider,
		setDevelopmentMode: appState.setDevelopmentMode,
		compactToolDisplay: appState.compactToolDisplay,
		abortController: appState.abortController,
		setAbortController: appState.setAbortController,
	});

	// Log when application is fully ready
	useEffect(() => {
		if (
			appState.mcpInitialized &&
			appState.client &&
			!appState.isToolExecuting &&
			!appState.isToolConfirmationMode &&
			appState.activeMode !== 'configWizard' &&
			appState.activeMode !== 'mcpWizard' &&
			appState.pendingToolCalls.length === 0
		) {
			const correlationId = generateCorrelationId();

			withNewCorrelationContext(() => {
				logger.info('Application interface ready for user interaction', {
					correlationId,
					interfaceState: {
						developmentMode: appState.developmentMode,
						hasPendingToolCalls: appState.pendingToolCalls.length > 0,
						clientInitialized: !!appState.client,
						mcpServersConnected: appState.mcpInitialized,
						inputDisabled: chatHandler.isGenerating || appState.isToolExecuting,
					},
				});
			}, correlationId);
		}
	}, [
		appState.mcpInitialized,
		appState.client,
		appState.isToolExecuting,
		appState.isToolConfirmationMode,
		appState.activeMode,
		appState.pendingToolCalls.length,
		logger,
		appState.developmentMode,
		chatHandler.isGenerating,
	]);

	// Setup initialization
	const appInitialization = useAppInitialization({
		setClient: appState.setClient,
		setCurrentModel: appState.setCurrentModel,
		setCurrentProvider: appState.setCurrentProvider,
		setToolManager: appState.setToolManager,
		setCustomCommandLoader: appState.setCustomCommandLoader,
		setCustomCommandExecutor: appState.setCustomCommandExecutor,
		setCustomCommandCache: appState.setCustomCommandCache,
		setStartChat: appState.setStartChat,
		setMcpInitialized: appState.setMcpInitialized,
		setUpdateInfo: appState.setUpdateInfo,
		setMcpServersStatus: appState.setMcpServersStatus,
		setLspServersStatus: appState.setLspServersStatus,
		setPreferencesLoaded: appState.setPreferencesLoaded,
		setCustomCommandsCount: appState.setCustomCommandsCount,
		addToChatQueue: appState.addToChatQueue,
		getNextComponentKey: appState.getNextComponentKey,
		customCommandCache: appState.customCommandCache,
		setActiveMode: appState.setActiveMode,
		cliProvider,
		cliModel,
	});

	// Setup mode handlers
	const modeHandlers = useModeHandlers({
		client: appState.client,
		currentModel: appState.currentModel,
		currentProvider: appState.currentProvider,
		setClient: appState.setClient,
		setCurrentModel: appState.setCurrentModel,
		setCurrentProvider: appState.setCurrentProvider,
		setMessages: appState.updateMessages,
		setActiveMode: appState.setActiveMode,
		setIsSettingsMode: appState.setIsSettingsMode,
		addToChatQueue: appState.addToChatQueue,
		getNextComponentKey: appState.getNextComponentKey,
		reinitializeMCPServers: appInitialization.reinitializeMCPServers,
		setTune: appState.setTune,
	});

	// Scheduler mode enter/exit handlers
	const enterSchedulerMode = React.useCallback(() => {
		appState.setActiveMode('scheduler');
	}, [appState.setActiveMode, appState]);

	const exitSchedulerMode = React.useCallback(() => {
		appState.setActiveMode(null);
	}, [appState.setActiveMode, appState]);

	// IDE selection handler
	const handleIdeSelect = React.useCallback(
		(ide: string) => {
			appState.setActiveMode(null);
			if (ide === 'vscode') {
				appState.setIsVscodeEnabled(true);

				// Check if extension needs installing
				void (async () => {
					if (!(await isExtensionInstalled())) {
						setShowExtensionPrompt(true);
						setExtensionPromptComplete(false);
					} else {
						appState.addToChatQueue(
							<SuccessMessage
								key={`ide-vscode-enabled-${appState.getNextComponentKey()}`}
								message="VS Code integration enabled. Starting server..."
								hideBox={true}
							/>,
						);
					}
				})();
			}
		},
		[appState],
	);

	// Show confirmation once VS Code server is ready with its port
	const prevVscodePortRef = React.useRef(vscodeServer.actualPort);
	React.useEffect(() => {
		const prevPort = prevVscodePortRef.current;
		prevVscodePortRef.current = vscodeServer.actualPort;

		// Only show message when port transitions from null to a value
		// and it was triggered by /ide (not the --vscode CLI flag)
		if (
			prevPort === null &&
			vscodeServer.actualPort !== null &&
			appState.isVscodeEnabled
		) {
			appState.addToChatQueue(
				<SuccessMessage
					key={`ide-vscode-ready-${appState.getNextComponentKey()}`}
					message={`VS Code server listening on port ${vscodeServer.actualPort}`}
					hideBox={true}
				/>,
			);
		}
	}, [vscodeServer.actualPort, appState]);

	// Setup app handlers
	const appHandlers = useAppHandlers({
		messages: appState.messages,
		currentProvider: appState.currentProvider,
		currentModel: appState.currentModel,
		currentTheme: appState.currentTheme,
		abortController: appState.abortController,
		updateInfo: appState.updateInfo,
		mcpServersStatus: appState.mcpServersStatus,
		lspServersStatus: appState.lspServersStatus,
		preferencesLoaded: appState.preferencesLoaded,
		customCommandsCount: appState.customCommandsCount,
		getNextComponentKey: appState.getNextComponentKey,
		customCommandCache: appState.customCommandCache,
		customCommandLoader: appState.customCommandLoader,
		customCommandExecutor: appState.customCommandExecutor,
		updateMessages: appState.updateMessages,
		setIsCancelling: appState.setIsCancelling,
		setDevelopmentMode: appState.setDevelopmentMode,
		setIsConversationComplete: appState.setIsConversationComplete,
		setIsToolExecuting: appState.setIsToolExecuting,
		setActiveMode: appState.setActiveMode,
		setCheckpointLoadData: appState.setCheckpointLoadData,
		setShowAllSessions: appState.setShowAllSessions,
		setCurrentSessionId: appState.setCurrentSessionId,
		setCurrentProvider: appState.setCurrentProvider,
		setCurrentModel: appState.setCurrentModel,
		setLiveTaskList: appState.setLiveTaskList,
		addToChatQueue: appState.addToChatQueue,
		setChatComponents: appState.setChatComponents,
		setLiveComponent: appState.setLiveComponent,
		client: appState.client,
		getMessageTokens: appState.getMessageTokens,
		enterModelSelectionMode: modeHandlers.enterModelSelectionMode,
		enterProviderSelectionMode: modeHandlers.enterProviderSelectionMode,
		enterModelDatabaseMode: modeHandlers.enterModelDatabaseMode,
		enterConfigWizardMode: modeHandlers.enterConfigWizardMode,
		enterSettingsMode: modeHandlers.enterSettingsMode,
		enterMcpWizardMode: modeHandlers.enterMcpWizardMode,
		enterExplorerMode: modeHandlers.enterExplorerMode,
		enterIdeSelectionMode: modeHandlers.enterIdeSelectionMode,
		enterTune: modeHandlers.enterTune,
		enterSchedulerMode,
		handleChatMessage: chatHandler.handleChatMessage,
	});

	// Update the ref so VS Code prompts can be submitted
	React.useEffect(() => {
		handleMessageSubmitRef.current = appHandlers.handleMessageSubmit;
	}, [appHandlers.handleMessageSubmit]);

	// Setup non-interactive mode
	const {nonInteractiveLoadingMessage} = useNonInteractiveMode({
		nonInteractivePrompt,
		nonInteractiveMode,
		mcpInitialized: appState.mcpInitialized,
		client: appState.client,
		appState: {
			isToolExecuting: appState.isToolExecuting,
			isToolConfirmationMode: appState.isToolConfirmationMode,
			isConversationComplete: appState.isConversationComplete,
			messages: appState.messages,
		},
		setDevelopmentMode: appState.setDevelopmentMode,
		handleMessageSubmit: appHandlers.handleMessageSubmit,
	});

	// Setup scheduler mode
	const schedulerMode = useSchedulerMode({
		isSchedulerMode: appState.isSchedulerMode,
		mcpInitialized: appState.mcpInitialized,
		setDevelopmentMode: appState.setDevelopmentMode,
		handleMessageSubmit: appHandlers.handleMessageSubmit,
		clearMessages: appHandlers.clearMessages,
		isConversationComplete: appState.isConversationComplete,
		isToolExecuting: appState.isToolExecuting,
		isToolConfirmationMode: appState.isToolConfirmationMode,
		messages: appState.messages,
		addToChatQueue: appState.addToChatQueue,
	});

	// Setup session autosave
	useSessionAutosave({
		messages: appState.messages,
		currentProvider: appState.currentProvider,
		currentModel: appState.currentModel,
		currentSessionId: appState.currentSessionId,
		setCurrentSessionId: appState.setCurrentSessionId,
	});

	const shouldShowWelcome = shouldRenderWelcome(nonInteractiveMode);

	// Memoize static components
	const staticComponents = React.useMemo(
		() =>
			createStaticComponents({
				shouldShowWelcome,
				currentProvider: appState.currentProvider,
				currentModel: appState.currentModel,
			}),
		[shouldShowWelcome, appState.currentProvider, appState.currentModel],
	);

	// Handle loading state for directory trust check
	if (isTrustLoading) {
		logger.debug('Directory trust check in progress');

		return (
			<ThemeContext.Provider value={themeContextValue}>
				<Box flexDirection="column" padding={1}>
					<Text color={themeContextValue.colors.secondary}>
						<Spinner type="dots" /> Checking directory trust...
					</Text>
				</Box>
			</ThemeContext.Provider>
		);
	}

	// Handle error state for directory trust
	if (isTrustedError) {
		logger.error('Directory trust check failed', {
			error: isTrustedError,
			suggestion: 'restart_application_or_check_permissions',
		});

		return (
			<ThemeContext.Provider value={themeContextValue}>
				<Box flexDirection="column" padding={1}>
					<Text color={themeContextValue.colors.error}>
						⚠️ Error checking directory trust: {isTrustedError}
					</Text>
					<Text color={themeContextValue.colors.secondary}>
						Please restart the application or check your permissions.
					</Text>
				</Box>
			</ThemeContext.Provider>
		);
	}

	// Show security disclaimer if directory is not trusted
	if (!isTrusted) {
		logger.info('Directory not trusted, showing security disclaimer');

		return (
			<ThemeContext.Provider value={themeContextValue}>
				<TitleShapeContext.Provider value={titleShapeContextValue}>
					<SecurityDisclaimer
						onConfirm={handleConfirmTrust}
						onExit={handleExit}
					/>
				</TitleShapeContext.Provider>
			</ThemeContext.Provider>
		);
	}

	// Directory is trusted - application can proceed
	logger.debug('Directory trusted, proceeding with application initialization');

	// Show VS Code extension installation prompt if needed
	if (showExtensionPrompt && !extensionPromptComplete) {
		logger.info('Showing VS Code extension installation prompt', {
			vscodeMode,
			extensionPromptComplete,
		});

		return (
			<ThemeContext.Provider value={themeContextValue}>
				<TitleShapeContext.Provider value={titleShapeContextValue}>
					<Box flexDirection="column" padding={1}>
						<WelcomeMessage />
						<VSCodeExtensionPrompt
							onComplete={() => {
								logger.info('VS Code extension prompt completed');
								setShowExtensionPrompt(false);
								setExtensionPromptComplete(true);
							}}
							onSkip={() => {
								logger.info('VS Code extension prompt skipped');
								setShowExtensionPrompt(false);
								setExtensionPromptComplete(true);
							}}
						/>
					</Box>
				</TitleShapeContext.Provider>
			</ThemeContext.Provider>
		);
	}

	// Main application render
	return (
		<ThemeContext.Provider value={themeContextValue}>
			<TitleShapeContext.Provider value={titleShapeContextValue}>
				<UIStateProvider>
					<Box flexDirection="column" padding={1} width="100%">
						{/* Chat History - ALWAYS rendered to keep Static content stable */}
						<ChatHistory
							startChat={appState.startChat}
							staticComponents={staticComponents}
							queuedComponents={appState.chatComponents}
							liveComponent={
								appState.liveComponent ??
								(chatHandler.isGenerating && chatHandler.streamingContent ? (
									<StreamingMessage
										message={chatHandler.streamingContent}
										model={appState.currentModel}
										startTime={streamingStartRef.current}
									/>
								) : null)
							}
						/>

						{/* File Explorer - rendered below chat history */}
						{appState.isExplorerMode && (
							<Box marginLeft={-1} flexDirection="column">
								<FileExplorer onClose={modeHandlers.handleExplorerCancel} />
							</Box>
						)}

						{/* IDE Selector - rendered below chat history */}
						{appState.isIdeSelectionMode && (
							<Box marginLeft={-1} flexDirection="column">
								<IdeSelector
									onSelect={handleIdeSelect}
									onCancel={modeHandlers.handleIdeSelectionCancel}
								/>
							</Box>
						)}

						{/* Modal Selectors - rendered below chat history */}
						{(appState.activeMode !== null &&
							appState.activeMode !== 'explorer' &&
							appState.activeMode !== 'ideSelection' &&
							appState.activeMode !== 'scheduler') ||
						appState.isSettingsMode ? (
							<Box marginLeft={-1} flexDirection="column">
								<ModalSelectors
									activeMode={appState.activeMode}
									isSettingsMode={appState.isSettingsMode}
									showAllSessions={appState.showAllSessions}
									client={appState.client}
									currentModel={appState.currentModel}
									currentProvider={appState.currentProvider}
									checkpointLoadData={appState.checkpointLoadData}
									onModelSelect={modeHandlers.handleModelSelect}
									onModelSelectionCancel={
										modeHandlers.handleModelSelectionCancel
									}
									onProviderSelect={modeHandlers.handleProviderSelect}
									onProviderSelectionCancel={
										modeHandlers.handleProviderSelectionCancel
									}
									onModelDatabaseCancel={modeHandlers.handleModelDatabaseCancel}
									onConfigWizardComplete={
										modeHandlers.handleConfigWizardComplete
									}
									onConfigWizardCancel={modeHandlers.handleConfigWizardCancel}
									onMcpWizardComplete={modeHandlers.handleMcpWizardComplete}
									onMcpWizardCancel={modeHandlers.handleMcpWizardCancel}
									onSettingsCancel={modeHandlers.handleSettingsCancel}
									tuneConfig={appState.tune}
									onTuneSelect={modeHandlers.handleTuneSelect}
									onTuneCancel={modeHandlers.handleTuneCancel}
									onCheckpointSelect={appHandlers.handleCheckpointSelect}
									onCheckpointCancel={appHandlers.handleCheckpointCancel}
									onSessionSelect={sessionId =>
										void appHandlers.handleSessionSelect(sessionId)
									}
									onSessionCancel={appHandlers.handleSessionCancel}
								/>
							</Box>
						) : null}

						{/* Scheduler View - replaces ChatInput in scheduler mode */}
						{appState.isSchedulerMode && (
							<SchedulerView
								activeJobCount={schedulerMode.activeJobCount}
								queueLength={schedulerMode.queueLength}
								isProcessing={schedulerMode.isProcessing}
								currentJobCommand={schedulerMode.currentJobCommand}
								developmentMode={appState.developmentMode}
								contextPercentUsed={appState.contextPercentUsed}
								onExit={exitSchedulerMode}
							/>
						)}

						{/* Chat Input - only rendered when not in modal mode or scheduler mode */}
						{appState.startChat &&
							appState.activeMode === null &&
							!appState.isSettingsMode && (
								<ChatInput
									isCancelling={appState.isCancelling}
									isToolExecuting={appState.isToolExecuting}
									isToolConfirmationMode={appState.isToolConfirmationMode}
									isQuestionMode={appState.isQuestionMode}
									pendingToolCalls={appState.pendingToolCalls}
									currentToolIndex={appState.currentToolIndex}
									pendingQuestion={appState.pendingQuestion}
									onQuestionAnswer={handleQuestionAnswer}
									mcpInitialized={appState.mcpInitialized}
									client={appState.client}
									nonInteractivePrompt={nonInteractivePrompt}
									nonInteractiveLoadingMessage={nonInteractiveLoadingMessage}
									customCommands={Array.from(
										appState.customCommandCache.keys(),
									)}
									inputDisabled={
										chatHandler.isGenerating || appState.isToolExecuting
									}
									developmentMode={appState.developmentMode}
									contextPercentUsed={appState.contextPercentUsed}
									compactToolCounts={appState.compactToolCounts}
									compactToolDisplay={appState.compactToolDisplay}
									liveTaskList={appState.liveTaskList}
									onToggleCompactDisplay={() => {
										const expanding = appState.compactToolDisplay;
										appState.setCompactToolDisplay(!expanding);

										// When expanding, flush accumulated counts to static
										if (expanding) {
											const counts = appState.compactToolCountsRef.current;
											if (Object.keys(counts).length > 0) {
												displayCompactCountsSummary(
													counts,
													appState.addToChatQueue,
													appState.getNextComponentKey,
												);
												appState.compactToolCountsRef.current = {};
												appState.setCompactToolCounts(null);
											}
										}
									}}
									pendingSubagentApproval={pendingSubagentApproval}
									onSubagentToolApproval={handleSubagentToolApproval}
									onToolConfirm={toolHandler.handleToolConfirmation}
									onToolCancel={toolHandler.handleToolConfirmationCancel}
									onSubmit={appHandlers.handleMessageSubmit}
									onCancel={appHandlers.handleCancel}
									onToggleMode={appHandlers.handleToggleDevelopmentMode}
									tune={appState.tune}
								/>
							)}
					</Box>
				</UIStateProvider>
			</TitleShapeContext.Provider>
		</ThemeContext.Provider>
	);
}
