import {createStaticComponents} from '@/app/components/AppContainer';
import {ChatInterface} from '@/app/components/ChatInterface';
import {ModalSelectors} from '@/app/components/ModalSelectors';
import {shouldRenderWelcome} from '@/app/helpers';
import type {AppProps} from '@/app/types';
import SecurityDisclaimer from '@/components/security-disclaimer';
import {
	VSCodeExtensionPrompt,
	shouldPromptExtensionInstall,
} from '@/components/vscode-extension-prompt';
import WelcomeMessage from '@/components/welcome-message';
import {getThemeColors} from '@/config/themes';
import {setCurrentMode as setCurrentModeContext} from '@/context/mode-context';
import {useChatHandler} from '@/hooks/chat-handler';
import {useAppHandlers} from '@/hooks/useAppHandlers';
import {useAppInitialization} from '@/hooks/useAppInitialization';
import {useAppState} from '@/hooks/useAppState';
import {useDirectoryTrust} from '@/hooks/useDirectoryTrust';
import {useModeHandlers} from '@/hooks/useModeHandlers';
import {useNonInteractiveMode} from '@/hooks/useNonInteractiveMode';
import {ThemeContext} from '@/hooks/useTheme';
import {useToolHandler} from '@/hooks/useToolHandler';
import {UIStateProvider} from '@/hooks/useUIState';
import {useVSCodeServer} from '@/hooks/useVSCodeServer';
import {
	generateCorrelationId,
	withNewCorrelationContext,
} from '@/utils/logging';
import {createPinoLogger} from '@/utils/logging/pino-logger';
import {setGlobalMessageQueue} from '@/utils/message-queue';
import {Box, Text, useApp} from 'ink';
import Spinner from 'ink-spinner';
import React, {useEffect, useMemo, useRef} from 'react';

export default function App({
	vscodeMode = false,
	vscodePort,
	nonInteractivePrompt,
	nonInteractiveMode = false,
}: AppProps) {
	// Memoize the logger to prevent recreation on every render
	const logger = useMemo(() => createPinoLogger(), []);

	// Debug: Track render count
	const renderCountRef = useRef(0);
	renderCountRef.current += 1;
	logger.debug('App component render', {
		renderCount: renderCountRef.current,
		timestamp: Date.now(),
	});

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

	// Sync global mode context whenever development mode changes
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
	};

	// VS Code server integration
	const handleVSCodePrompt = React.useCallback(
		(
			prompt: string,
			context?: {
				filePath?: string;
				selection?: string;
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

			let enhancedPrompt = prompt;
			if (context?.filePath) {
				enhancedPrompt = `[Context: ${context.filePath}${
					context.selection ? ` (selection)` : ''
				}]\n\n${prompt}`;
			}
			logger.debug('VS Code enhanced prompt prepared', {
				enhancedPromptLength: enhancedPrompt.length,
				correlationId,
			});
		},
		[logger],
	);

	useVSCodeServer({
		enabled: vscodeMode,
		port: vscodePort,
		currentModel: appState.currentModel,
		currentProvider: appState.currentProvider,
		onPrompt: handleVSCodePrompt,
	});

	// Create theme context value
	const themeContextValue = {
		currentTheme: appState.currentTheme,
		colors: getThemeColors(appState.currentTheme),
		setCurrentTheme: appState.setCurrentTheme,
	};

	// Initialize global message queue on component mount
	React.useEffect(() => {
		setGlobalMessageQueue(appState.addToChatQueue);

		logger.debug('Global message queue initialized', {
			chatQueueFunction: 'addToChatQueue',
		});
	}, [appState.addToChatQueue, logger]);

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

	// Setup chat handler
	const chatHandler = useChatHandler({
		client: appState.client,
		toolManager: appState.toolManager,
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
		},
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
		getNextComponentKey: appState.getNextComponentKey,
		resetToolConfirmationState: appState.resetToolConfirmationState,
		onProcessAssistantResponse: chatHandler.processAssistantResponse,
		client: appState.client,
		currentProvider: appState.currentProvider,
		setDevelopmentMode: appState.setDevelopmentMode,
	});

	// Log when application is fully ready
	useEffect(() => {
		if (
			appState.mcpInitialized &&
			appState.client &&
			!appState.isToolExecuting &&
			!appState.isToolConfirmationMode &&
			!appState.isConfigWizardMode &&
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
						inputDisabled:
							chatHandler.isGenerating ||
							appState.isToolExecuting ||
							appState.isBashExecuting,
					},
				});
			}, correlationId);
		}
	}, [
		appState.mcpInitialized,
		appState.client,
		appState.isToolExecuting,
		appState.isToolConfirmationMode,
		appState.isConfigWizardMode,
		appState.pendingToolCalls.length,
		logger,
		appState.developmentMode,
		chatHandler.isGenerating,
		appState.isBashExecuting,
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
		setIsConfigWizardMode: appState.setIsConfigWizardMode,
	});

	// Setup mode handlers
	const modeHandlers = useModeHandlers({
		client: appState.client,
		currentModel: appState.currentModel,
		currentProvider: appState.currentProvider,
		currentTheme: appState.currentTheme,
		setClient: appState.setClient,
		setCurrentModel: appState.setCurrentModel,
		setCurrentProvider: appState.setCurrentProvider,
		setCurrentTheme: appState.setCurrentTheme,
		setMessages: appState.updateMessages,
		setIsModelSelectionMode: appState.setIsModelSelectionMode,
		setIsProviderSelectionMode: appState.setIsProviderSelectionMode,
		setIsThemeSelectionMode: appState.setIsThemeSelectionMode,
		setIsModelDatabaseMode: appState.setIsModelDatabaseMode,
		setIsConfigWizardMode: appState.setIsConfigWizardMode,
		addToChatQueue: appState.addToChatQueue,
		getNextComponentKey: appState.getNextComponentKey,
		reinitializeMCPServers: appInitialization.reinitializeMCPServers,
	});

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
		setIsBashExecuting: appState.setIsBashExecuting,
		setCurrentBashCommand: appState.setCurrentBashCommand,
		setIsCheckpointLoadMode: appState.setIsCheckpointLoadMode,
		setCheckpointLoadData: appState.setCheckpointLoadData,
		addToChatQueue: appState.addToChatQueue,
		client: appState.client,
		getMessageTokens: appState.getMessageTokens,
		enterModelSelectionMode: modeHandlers.enterModelSelectionMode,
		enterProviderSelectionMode: modeHandlers.enterProviderSelectionMode,
		enterThemeSelectionMode: modeHandlers.enterThemeSelectionMode,
		enterModelDatabaseMode: modeHandlers.enterModelDatabaseMode,
		enterConfigWizardMode: modeHandlers.enterConfigWizardMode,
		handleChatMessage: chatHandler.handleChatMessage,
	});

	// Setup non-interactive mode
	const {nonInteractiveLoadingMessage} = useNonInteractiveMode({
		nonInteractivePrompt,
		nonInteractiveMode,
		mcpInitialized: appState.mcpInitialized,
		client: appState.client,
		appState: {
			isToolExecuting: appState.isToolExecuting,
			isBashExecuting: appState.isBashExecuting,
			isToolConfirmationMode: appState.isToolConfirmationMode,
			isConversationComplete: appState.isConversationComplete,
			messages: appState.messages,
		},
		setDevelopmentMode: appState.setDevelopmentMode,
		handleMessageSubmit: appHandlers.handleMessageSubmit,
	});

	const shouldShowWelcome = shouldRenderWelcome(nonInteractiveMode);

	// Debug: Track which dependencies changed for staticComponents
	const prevStaticDepsRef = useRef<{
		shouldShowWelcome: boolean;
		currentProvider: string;
		currentModel: string;
		currentTheme: string;
		updateInfo: unknown;
		mcpServersStatus: unknown;
		lspServersStatus: unknown;
		preferencesLoaded: boolean;
		customCommandsCount: number;
	} | null>(null);

	const currentStaticDeps = {
		shouldShowWelcome,
		currentProvider: appState.currentProvider,
		currentModel: appState.currentModel,
		currentTheme: appState.currentTheme,
		updateInfo: appState.updateInfo,
		mcpServersStatus: appState.mcpServersStatus,
		lspServersStatus: appState.lspServersStatus,
		preferencesLoaded: appState.preferencesLoaded,
		customCommandsCount: appState.customCommandsCount,
	};

	if (prevStaticDepsRef.current) {
		const changedDeps: string[] = [];
		for (const key of Object.keys(currentStaticDeps) as Array<
			keyof typeof currentStaticDeps
		>) {
			if (prevStaticDepsRef.current[key] !== currentStaticDeps[key]) {
				changedDeps.push(key);
			}
		}
		if (changedDeps.length > 0) {
			logger.debug('staticComponents deps changed', {
				changedDeps,
				renderCount: renderCountRef.current,
			});
		}
	}
	prevStaticDepsRef.current = currentStaticDeps;

	// Memoize static components
	const staticComponents = React.useMemo(
		() =>
			createStaticComponents({
				shouldShowWelcome,
				currentProvider: appState.currentProvider,
				currentModel: appState.currentModel,
				currentTheme: appState.currentTheme,
				updateInfo: appState.updateInfo,
				mcpServersStatus: appState.mcpServersStatus,
				lspServersStatus: appState.lspServersStatus,
				preferencesLoaded: appState.preferencesLoaded,
				customCommandsCount: appState.customCommandsCount,
			}),
		[
			shouldShowWelcome,
			appState.currentProvider,
			appState.currentModel,
			appState.currentTheme,
			appState.updateInfo,
			appState.mcpServersStatus,
			appState.lspServersStatus,
			appState.preferencesLoaded,
			appState.customCommandsCount,
		],
	);

	// Handle loading state for directory trust check
	if (isTrustLoading) {
		logger.debug('Directory trust check in progress');

		return (
			<Box flexDirection="column" padding={1}>
				<Text color={themeContextValue.colors.secondary}>
					<Spinner type="dots" /> Checking directory trust...
				</Text>
			</Box>
		);
	}

	// Handle error state for directory trust
	if (isTrustedError) {
		logger.error('Directory trust check failed', {
			error: isTrustedError,
			suggestion: 'restart_application_or_check_permissions',
		});

		return (
			<Box flexDirection="column" padding={1}>
				<Text color={themeContextValue.colors.error}>
					⚠️ Error checking directory trust: {isTrustedError}
				</Text>
				<Text color={themeContextValue.colors.secondary}>
					Please restart the application or check your permissions.
				</Text>
			</Box>
		);
	}

	// Show security disclaimer if directory is not trusted
	if (!isTrusted) {
		logger.info('Directory not trusted, showing security disclaimer');

		return (
			<SecurityDisclaimer onConfirm={handleConfirmTrust} onExit={handleExit} />
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
			</ThemeContext.Provider>
		);
	}

	// Determine if any modal mode is active
	const isAnyModalMode =
		appState.isModelSelectionMode ||
		appState.isProviderSelectionMode ||
		appState.isThemeSelectionMode ||
		appState.isModelDatabaseMode ||
		appState.isConfigWizardMode ||
		appState.isCheckpointLoadMode;

	// Main application render
	// IMPORTANT: ChatInterface is ALWAYS rendered to prevent Static component remounting
	// which causes the entire terminal to re-render and memory growth.
	// Modal selectors are rendered as an overlay/replacement for the input area only.
	return (
		<ThemeContext.Provider value={themeContextValue}>
			<UIStateProvider>
				<Box flexDirection="column" padding={1} width="100%">
					{/* Chat Interface - ALWAYS rendered to keep Static content stable */}
					<ChatInterface
						startChat={appState.startChat}
						staticComponents={staticComponents}
						queuedComponents={appState.chatComponents}
						isCancelling={appState.isCancelling}
						isToolExecuting={appState.isToolExecuting}
						isToolConfirmationMode={appState.isToolConfirmationMode}
						isBashExecuting={appState.isBashExecuting}
						currentBashCommand={appState.currentBashCommand}
						pendingToolCalls={appState.pendingToolCalls}
						currentToolIndex={appState.currentToolIndex}
						mcpInitialized={appState.mcpInitialized}
						client={appState.client}
						nonInteractivePrompt={nonInteractivePrompt}
						nonInteractiveLoadingMessage={nonInteractiveLoadingMessage}
						customCommands={Array.from(appState.customCommandCache.keys())}
						inputDisabled={
							chatHandler.isGenerating ||
							appState.isToolExecuting ||
							appState.isBashExecuting ||
							isAnyModalMode // Disable input when in modal mode
						}
						developmentMode={appState.developmentMode}
						onToolConfirm={toolHandler.handleToolConfirmation}
						onToolCancel={toolHandler.handleToolConfirmationCancel}
						onSubmit={appHandlers.handleMessageSubmit}
						onCancel={appHandlers.handleCancel}
						onToggleMode={appHandlers.handleToggleDevelopmentMode}
						hideInput={isAnyModalMode} // Hide input area when in modal mode
					/>

					{/* Modal Selectors - rendered after ChatInterface */}
					{isAnyModalMode && (
						<ModalSelectors
							isModelSelectionMode={appState.isModelSelectionMode}
							isProviderSelectionMode={appState.isProviderSelectionMode}
							isThemeSelectionMode={appState.isThemeSelectionMode}
							isModelDatabaseMode={appState.isModelDatabaseMode}
							isConfigWizardMode={appState.isConfigWizardMode}
							isCheckpointLoadMode={appState.isCheckpointLoadMode}
							client={appState.client}
							currentModel={appState.currentModel}
							currentProvider={appState.currentProvider}
							checkpointLoadData={appState.checkpointLoadData}
							onModelSelect={modeHandlers.handleModelSelect}
							onModelSelectionCancel={modeHandlers.handleModelSelectionCancel}
							onProviderSelect={modeHandlers.handleProviderSelect}
							onProviderSelectionCancel={
								modeHandlers.handleProviderSelectionCancel
							}
							onThemeSelect={modeHandlers.handleThemeSelect}
							onThemeSelectionCancel={modeHandlers.handleThemeSelectionCancel}
							onModelDatabaseCancel={modeHandlers.handleModelDatabaseCancel}
							onConfigWizardComplete={modeHandlers.handleConfigWizardComplete}
							onConfigWizardCancel={modeHandlers.handleConfigWizardCancel}
							onCheckpointSelect={appHandlers.handleCheckpointSelect}
							onCheckpointCancel={appHandlers.handleCheckpointCancel}
						/>
					)}
				</Box>
			</UIStateProvider>
		</ThemeContext.Provider>
	);
}
