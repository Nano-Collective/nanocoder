import {Box, Text, useApp} from 'ink';
import Spinner from 'ink-spinner';
import React, {useMemo} from 'react';
import {createStaticComponents} from '@/app/components/app-container';
import {NonInteractiveShell} from '@/app/components/non-interactive-shell';
import {useAppLogging} from '@/app/hooks/useAppLogging';
import {useGlobalHandlerQueues} from '@/app/hooks/useGlobalHandlerQueues';
import {
	useUserSubmit,
	useVSCodePromptDispatcher,
} from '@/app/hooks/useVSCodePromptHandling';
import {InteractiveApp} from '@/app/sections/interactive-app';
import type {AppProps} from '@/app/types';
import AssistantReasoning from '@/components/assistant-reasoning';
import {SuccessMessage} from '@/components/message-box';
import SecurityDisclaimer from '@/components/security-disclaimer';
import StreamingMessage from '@/components/streaming-message';
import StreamingReasoning from '@/components/streaming-reasoning';
import type {TitleShape} from '@/components/ui/styled-title';
import {
	shouldPromptExtensionInstall,
	VSCodeExtensionPrompt,
} from '@/components/vscode-extension-prompt';
import WelcomeMessage from '@/components/welcome-message';
import {getAppConfig, loadDefaultMode} from '@/config/index';
import {updateSelectedTheme} from '@/config/preferences';
import {getThemeColors} from '@/config/themes';
import {useChatHandler} from '@/hooks/chat-handler';
import {useAppHandlers} from '@/hooks/useAppHandlers';
import {useAppInitialization} from '@/hooks/useAppInitialization';
import {useAppState} from '@/hooks/useAppState';
import {useContextPercentage} from '@/hooks/useContextPercentage';
import {useDirectoryTrust} from '@/hooks/useDirectoryTrust';
import {useModeHandlers} from '@/hooks/useModeHandlers';
import {useNonInteractiveMode} from '@/hooks/useNonInteractiveMode';
import {useNotifications} from '@/hooks/useNotifications';
import {useSessionAutosave} from '@/hooks/useSessionAutosave';
import {ThemeContext} from '@/hooks/useTheme';
import {TitleShapeContext, updateTitleShape} from '@/hooks/useTitleShape';
import {UIStateProvider} from '@/hooks/useUIState';
import {useUserMessageQueue} from '@/hooks/useUserMessageQueue';
import {useVSCodeServer} from '@/hooks/useVSCodeServer';
import {generateKey} from '@/session/key-generator';
import type {ImageAttachment} from '@/types/core';
import type {ThemePreset} from '@/types/ui';
import {createPinoLogger} from '@/utils/logging/pino-logger';
import {setGlobalMessageQueue} from '@/utils/message-queue';
import {setNotificationsConfig} from '@/utils/notifications';
import {getShutdownManager} from '@/utils/shutdown';
import {isExtensionInstalled} from '@/vscode/extension-installer';

export default function App({
	vscodeMode = false,
	vscodePort,
	nonInteractivePrompt,
	nonInteractiveMode = false,
	cliProvider,
	cliModel,
	cliMode,
	trustDirectory = false,
}: AppProps) {
	// Resolve the initial development mode with this precedence:
	// 1. --mode CLI flag (highest priority)
	// 2. Non-interactive (run) mode → auto-accept
	// 3. defaultMode from agents.config.json
	// 4. 'normal' (final fallback)
	// Only consumed once by useAppState's initial state — memoized so we
	// don't re-read agents.config.json on every render.
	const initialDevelopmentMode = useMemo(
		() =>
			cliMode ??
			(nonInteractiveMode ? 'auto-accept' : (loadDefaultMode() ?? 'normal')),
		[cliMode, nonInteractiveMode],
	);
	// Memoize the logger to prevent recreation on every render
	const logger = useMemo(() => createPinoLogger(), []);

	// Use extracted hooks
	const appState = useAppState(initialDevelopmentMode);
	const userMessageQueue = useUserMessageQueue();
	const queuedUserSubmitRef = React.useRef<
		| ((
				message: string,
				displayValue: string,
				images?: ImageAttachment[],
		  ) => Promise<void>)
		| null
	>(null);
	const {exit} = useApp();
	const {isTrusted, handleConfirmTrust, isTrustLoading, isTrustedError} =
		useDirectoryTrust();

	// Ephemeral trust override for non-interactive `--trust-directory` runs.
	// Bypasses the disclaimer without touching the preferences file.
	const isEffectivelyTrusted =
		isTrusted || (nonInteractiveMode && trustDirectory);

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

	// VS Code → chat plumbing. The dispatcher is created up front because
	// useVSCodeServer needs `onPrompt` immediately, and `handleUserSubmit`
	// is bound after appHandlers exists (it needs handleMessageSubmit).
	const vscodePromptDispatcher = useVSCodePromptDispatcher({logger});

	const effectiveVscodeEnabled = vscodeMode || appState.isVscodeEnabled;

	const vscodeServer = useVSCodeServer({
		enabled: effectiveVscodeEnabled,
		port: vscodePort,
		currentModel: appState.currentModel,
		currentProvider: appState.currentProvider,
		onPrompt: vscodePromptDispatcher.handleVSCodePrompt,
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

	// Question + subagent tool approval queues plumbed through global handlers.
	const {
		handleQuestionAnswer,
		pendingSubagentApproval,
		handleSubagentToolApproval,
		pendingToolConfirmation,
		handleToolConfirmation,
	} = useGlobalHandlerQueues({
		setPendingQuestion: appState.setPendingQuestion,
		setIsQuestionMode: appState.setIsQuestionMode,
	});

	// Initialize notifications config from app config (once)
	React.useEffect(() => {
		const config = getAppConfig();
		if (config.notifications) {
			setNotificationsConfig(config.notifications);
		}
	}, []);

	const drainQueuedUserMessage = React.useCallback(() => {
		queueMicrotask(() => {
			void userMessageQueue.drainNextMessage(async message => {
				const submitQueuedMessage = queuedUserSubmitRef.current;
				if (!submitQueuedMessage || !appState.client || !appState.toolManager) {
					return false;
				}

				await submitQueuedMessage(
					message.message,
					message.displayValue,
					message.images,
				);
				return true;
			});
		});
	}, [
		appState.client,
		appState.toolManager,
		userMessageQueue.drainNextMessage,
	]);

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
		abortController: appState.abortController,
		setAbortController: appState.setAbortController,
		developmentMode: appState.developmentMode,
		developmentModeRef: appState.developmentModeRef,
		nonInteractiveMode,
		onConversationComplete: () => {
			appState.setIsConversationComplete(true);
			appState.setCompactToolCounts(null);
			appState.compactToolCountsRef.current = {};
			appState.setLiveTaskList(null);
			drainQueuedUserMessage();
		},
		reasoningExpandedRef: appState.reasoningExpandedRef,
		compactToolDisplayRef: appState.compactToolDisplayRef,
		onSetCompactToolCounts: appState.setCompactToolCounts,
		compactToolCountsRef: appState.compactToolCountsRef,
		onSetLiveTaskList: appState.setLiveTaskList,
		setLiveComponent: appState.setLiveComponent,
		setLastApiUsage: appState.setLastApiUsage,
		tune: appState.tune,
		subagentsReady: appState.subagentsReady,
	});

	// Desktop notifications on state transitions. The unified tool flow drives
	// confirmation through pendingToolConfirmation (not appState.isToolConfirmationMode),
	// so derive the signal from it — otherwise the "tool needs approval"
	// notification never fires and "generation complete" misfires when a prompt
	// appears. Execution runs with isGenerating=true, so isToolExecuting is no
	// longer a distinct signal here.
	useNotifications({
		isToolConfirmationMode: pendingToolConfirmation !== null,
		isQuestionMode: appState.isQuestionMode,
		isGenerating: chatHandler.isGenerating,
		isToolExecuting: false,
	});

	// Track context window usage percentage
	useContextPercentage({
		currentModel: appState.currentModel,
		currentProvider: appState.currentProvider,
		currentProviderConfig: appState.currentProviderConfig,
		messages: appState.messages,
		tokenizer: appState.tokenizer,
		getMessageTokens: appState.getMessageTokens,
		toolManager: appState.toolManager,
		streamingTokenCount: chatHandler.tokenCount,
		contextLimit: appState.contextLimit,
		lastApiUsage: appState.lastApiUsage,
		setContextPercentUsed: appState.setContextPercentUsed,
		setContextLimit: appState.setContextLimit,
		setContextSource: appState.setContextSource,
		developmentMode: appState.developmentMode,
		tune: appState.tune,
	});

	// All app-level structured logging lives in this hook so the orchestrator
	// stays focused on render/state composition.
	useAppLogging({
		logger,
		vscodeMode,
		vscodePort,
		developmentMode: appState.developmentMode,
		client: appState.client,
		currentProvider: appState.currentProvider,
		currentModel: appState.currentModel,
		toolManager: appState.toolManager,
		mcpInitialized: appState.mcpInitialized,
		mcpServersStatus: appState.mcpServersStatus,
		updateInfo: appState.updateInfo,
		activeMode: appState.activeMode,
		isToolExecuting: appState.isToolExecuting,
		isToolConfirmationMode: appState.isToolConfirmationMode,
		pendingToolCallsLength: appState.pendingToolCalls.length,
		isGenerating: chatHandler.isGenerating,
	});

	// Setup initialization
	const appInitialization = useAppInitialization({
		setClient: appState.setClient,
		setCurrentModel: appState.setCurrentModel,
		setCurrentProvider: appState.setCurrentProvider,
		setCurrentProviderConfig: appState.setCurrentProviderConfig,
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
		setSubagentsReady: appState.setSubagentsReady,
		addToChatQueue: appState.addToChatQueue,
		customCommandCache: appState.customCommandCache,
		setActiveMode: appState.setActiveMode,
		cliProvider,
		cliModel,
		nonInteractiveMode,
		developmentModeRef: appState.developmentModeRef,
	});

	// Setup mode handlers
	const modeHandlers = useModeHandlers({
		client: appState.client,
		currentModel: appState.currentModel,
		currentProvider: appState.currentProvider,
		setClient: appState.setClient,
		setCurrentModel: appState.setCurrentModel,
		setCurrentProvider: appState.setCurrentProvider,
		setCurrentProviderConfig: appState.setCurrentProviderConfig,
		setMessages: appState.updateMessages,
		messages: appState.messages,
		getMessageTokens: appState.getMessageTokens,
		setActiveMode: appState.setActiveMode,
		setIsSettingsMode: appState.setIsSettingsMode,
		addToChatQueue: appState.addToChatQueue,
		reinitializeMCPServers: appInitialization.reinitializeMCPServers,
		setTune: appState.setTune,
	});

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
								key={generateKey('ide-vscode-enabled')}
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
					key={generateKey('ide-vscode-ready')}
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
		currentProviderConfig: appState.currentProviderConfig,
		currentModel: appState.currentModel,
		currentTheme: appState.currentTheme,
		developmentMode: appState.developmentMode,
		tune: appState.tune,
		abortController: appState.abortController,
		updateInfo: appState.updateInfo,
		mcpServersStatus: appState.mcpServersStatus,
		lspServersStatus: appState.lspServersStatus,
		preferencesLoaded: appState.preferencesLoaded,
		customCommandsCount: appState.customCommandsCount,
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
		setSessionName: appState.setSessionName,
		setCurrentProvider: appState.setCurrentProvider,
		setCurrentModel: appState.setCurrentModel,
		setLiveTaskList: appState.setLiveTaskList,
		addToChatQueue: appState.addToChatQueue,
		setChatComponents: appState.setChatComponents,
		setLiveComponent: appState.setLiveComponent,
		client: appState.client,
		getMessageTokens: appState.getMessageTokens,
		enterModelSelectionMode: modeHandlers.enterModelSelectionMode,
		enterModelDatabaseMode: modeHandlers.enterModelDatabaseMode,
		enterConfigWizardMode: modeHandlers.enterConfigWizardMode,
		enterSettingsMode: modeHandlers.enterSettingsMode,
		enterMcpWizardMode: modeHandlers.enterMcpWizardMode,
		enterExplorerMode: modeHandlers.enterExplorerMode,
		enterIdeSelectionMode: modeHandlers.enterIdeSelectionMode,
		enterTune: modeHandlers.enterTune,
		handleModelSelect: modeHandlers.handleModelSelect,
		handleChatMessage: chatHandler.handleChatMessage,
		dismissActiveEditor: vscodeServer.dismissActiveEditor,
	});

	// Bind the chat-input submit handler into the VS Code prompt dispatcher
	// now that appHandlers exists. The dispatcher was created earlier (before
	// appHandlers) because useVSCodeServer needs `onPrompt` immediately.
	React.useEffect(() => {
		vscodePromptDispatcher.bindMessageSubmit(appHandlers.handleMessageSubmit);
	}, [appHandlers.handleMessageSubmit, vscodePromptDispatcher]);

	// Wraps the user's typed message with the VS Code active-editor pill.
	// File-focused-only sends just the filename hint; an active selection
	// inlines the code too.
	const handleUserSubmit = useUserSubmit({
		handleMessageSubmit: appHandlers.handleMessageSubmit,
		activeEditor: vscodeServer.activeEditor,
	});

	React.useEffect(() => {
		queuedUserSubmitRef.current = handleUserSubmit;
	}, [handleUserSubmit]);

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
		developmentMode: initialDevelopmentMode,
	});

	// Setup session autosave
	useSessionAutosave({
		messages: appState.messages,
		currentProvider: appState.currentProvider,
		currentModel: appState.currentModel,
		currentSessionId: appState.currentSessionId,
		setCurrentSessionId: appState.setCurrentSessionId,
	});

	const shouldShowWelcome = !nonInteractiveMode;

	// Memoize static components. We pin the run-mode header to the
	// initial development mode so it never changes during the run — the
	// boot line represents what the agent *started* under, not a live
	// indicator.
	const staticComponents = React.useMemo(
		() =>
			createStaticComponents({
				shouldShowWelcome,
				currentProvider: appState.currentProvider,
				currentModel: appState.currentModel,
				nonInteractiveMode,
				developmentMode: initialDevelopmentMode,
			}),
		[
			shouldShowWelcome,
			appState.currentProvider,
			appState.currentModel,
			nonInteractiveMode,
			initialDevelopmentMode,
		],
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
	if (!isEffectivelyTrusted) {
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

	const liveComponent =
		appState.liveComponent ??
		(chatHandler.isGenerating &&
		(chatHandler.streamingContent || chatHandler.streamingReasoning) ? (
			<>
				{chatHandler.streamingReasoning && !chatHandler.streamingContent && (
					<StreamingReasoning
						reasoning={chatHandler.streamingReasoning}
						expand={appState.reasoningExpanded}
					/>
				)}
				{/* Reasoning stream is complete when text streaming begins */}
				{chatHandler.streamingReasoning && chatHandler.streamingContent && (
					<AssistantReasoning
						reasoning={chatHandler.streamingReasoning}
						expand={appState.reasoningExpanded}
					/>
				)}
				{chatHandler.streamingContent && (
					<StreamingMessage
						message={chatHandler.streamingContent}
						model={appState.currentModel}
					/>
				)}
			</>
		) : null);

	// Non-interactive render tree — minimal transcript + one status line,
	// no interactive affordances.
	if (nonInteractiveMode) {
		return (
			<ThemeContext.Provider value={themeContextValue}>
				<TitleShapeContext.Provider value={titleShapeContextValue}>
					<UIStateProvider>
						<NonInteractiveShell
							startChat={appState.startChat}
							staticComponents={staticComponents}
							queuedComponents={appState.chatComponents}
							liveComponent={liveComponent}
							statusMessage={nonInteractiveLoadingMessage}
						/>
					</UIStateProvider>
				</TitleShapeContext.Provider>
			</ThemeContext.Provider>
		);
	}

	// Main application render
	return (
		<ThemeContext.Provider value={themeContextValue}>
			<TitleShapeContext.Provider value={titleShapeContextValue}>
				<UIStateProvider>
					<InteractiveApp
						appState={appState}
						chatHandler={chatHandler}
						modeHandlers={modeHandlers}
						appHandlers={appHandlers}
						vscodeServer={vscodeServer}
						staticComponents={staticComponents}
						liveComponent={liveComponent}
						pendingSubagentApproval={pendingSubagentApproval}
						handleSubagentToolApproval={handleSubagentToolApproval}
						pendingToolConfirmation={pendingToolConfirmation}
						handleToolConfirmation={handleToolConfirmation}
						handleQuestionAnswer={handleQuestionAnswer}
						handleUserSubmit={handleUserSubmit}
						userMessageQueue={userMessageQueue}
						handleIdeSelect={handleIdeSelect}
					/>
				</UIStateProvider>
			</TitleShapeContext.Provider>
		</ThemeContext.Provider>
	);
}
