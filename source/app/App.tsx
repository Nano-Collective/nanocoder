import {Box, Text, useApp} from 'ink';
import Spinner from 'ink-spinner';
import React, {useEffect, useMemo} from 'react';
import {createStaticComponents} from '@/app/components/app-container';
import {ChatHistory} from '@/app/components/chat-history';
import {ChatInput} from '@/app/components/chat-input';
import {ModalSelectors} from '@/app/components/modal-selectors';
import {shouldRenderWelcome} from '@/app/helpers';
import type {AppProps} from '@/app/types';
import ModeSelectionPrompt from '@/components/mode-selection-prompt';
import PlanReviewPrompt from '@/components/plan-review-prompt';
import SecurityDisclaimer from '@/components/security-disclaimer';
import type {TitleShape} from '@/components/ui/styled-title';
import {
	shouldPromptExtensionInstall,
	VSCodeExtensionPrompt,
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
import {TitleShapeContext, updateTitleShape} from '@/hooks/useTitleShape';
import {useToolHandler} from '@/hooks/useToolHandler';
import {UIStateProvider} from '@/hooks/useUIState';
import {useVSCodeServer} from '@/hooks/useVSCodeServer';
import {
	generateCorrelationId,
	withNewCorrelationContext,
} from '@/utils/logging';
import {createPinoLogger} from '@/utils/logging/pino-logger';
import {setGlobalMessageQueue} from '@/utils/message-queue';
import {registerModeSelectionCallback} from '@/utils/mode-selection-registry';
import {registerPlanReviewCallback} from '@/utils/plan-review-registry';

export default function App({
	vscodeMode = false,
	vscodePort,
	nonInteractivePrompt,
	nonInteractiveMode = false,
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
		// Force exit - at security disclaimer stage, no services need cleanup
		// TODO: Replace with ShutdownManager.gracefulShutdown() once #239 is implemented
		process.exit(0);
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

	const vscodeServer = useVSCodeServer({
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
		setPlanPhase: appState.setPlanPhase,
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
		appState.isConfigWizardMode,
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
		setIsTitleShapeSelectionMode: appState.setIsTitleShapeSelectionMode,
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
		setIsToolExecuting: appState.setIsToolExecuting,
		setIsCheckpointLoadMode: appState.setIsCheckpointLoadMode,
		setCheckpointLoadData: appState.setCheckpointLoadData,
		setPlanModeActive: appState.setPlanModeActive,
		setPlanId: appState.setPlanId,
		setPlanPhase: appState.setPlanPhase,
		setPlanFilePath: appState.setPlanFilePath,
		addToChatQueue: appState.addToChatQueue,
		setLiveComponent: appState.setLiveComponent,
		client: appState.client,
		getMessageTokens: appState.getMessageTokens,
		enterModelSelectionMode: modeHandlers.enterModelSelectionMode,
		enterProviderSelectionMode: modeHandlers.enterProviderSelectionMode,
		enterThemeSelectionMode: modeHandlers.enterThemeSelectionMode,
		enterTitleShapeSelectionMode: modeHandlers.enterTitleShapeSelectionMode,
		enterModelDatabaseMode: modeHandlers.enterModelDatabaseMode,
		enterConfigWizardMode: modeHandlers.enterConfigWizardMode,
		handleChatMessage: chatHandler.handleChatMessage,
	});

	// Update the ref so VS Code prompts can be submitted
	React.useEffect(() => {
		handleMessageSubmitRef.current = appHandlers.handleMessageSubmit;
	}, [appHandlers.handleMessageSubmit]);

	// Register mode selection callback when in plan mode
	React.useEffect(() => {
		if (appState.developmentMode === 'plan') {
			// Register callback for mode selection
			registerModeSelectionCallback(
				(
					onSelect: (mode: import('@/types/core').DevelopmentMode) => void,
					onCancel: () => void,
				) => {
					// Trigger mode selection UI
					appState.setIsModeSelectionMode(true);

					// Store the onSelect/onCancel handlers for use by the UI component
					// We'll pass these through the app state
					appState.setPendingModeSelection({
						onSelect,
						onCancel,
					});
				},
			);

			// Cleanup on unmount or when leaving plan mode
			return () => {
				registerModeSelectionCallback(null);
				appState.setIsModeSelectionMode(false);
			};
		}
	}, [appState.developmentMode, appState]);

	// Register plan review callback when in plan mode
	React.useEffect(() => {
		if (appState.developmentMode === 'plan') {
			// Register callback for plan review
			registerPlanReviewCallback(
				(
					data: import('@/utils/plan-review-registry').PlanReviewData,
					onApprove: () => void,
					onCancel: () => void,
				) => {
					// Trigger plan review UI
					appState.setIsPlanReviewMode(true);

					// Store the data and callbacks for use by the UI component
					appState.setPendingPlanReview({
						data,
						onApprove,
						onReject: onCancel,
					});
				},
			);

			// Cleanup on unmount or when leaving plan mode
			return () => {
				registerPlanReviewCallback(null);
				appState.setIsPlanReviewMode(false);
			};
		}
	}, [appState.developmentMode, appState]);

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

	const shouldShowWelcome = shouldRenderWelcome(nonInteractiveMode);

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
				vscodeMode,
				vscodePort: vscodeServer.actualPort,
				vscodeRequestedPort: vscodeServer.requestedPort,
				planModeActive: appState.planModeActive,
				planPhase: appState.planPhase,
				planId: appState.planId,
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
			vscodeMode,
			vscodeServer.actualPort,
			vscodeServer.requestedPort,
			appState.planModeActive,
			appState.planPhase,
			appState.planId,
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
							liveComponent={appState.liveComponent}
						/>

						{/* Modal Selectors - rendered below chat history */}
						{(appState.isModelSelectionMode ||
							appState.isProviderSelectionMode ||
							appState.isThemeSelectionMode ||
							appState.isModelDatabaseMode ||
							appState.isConfigWizardMode ||
							appState.isTitleShapeSelectionMode ||
							appState.isCheckpointLoadMode) && (
							<ModalSelectors
								isModelSelectionMode={appState.isModelSelectionMode}
								isProviderSelectionMode={appState.isProviderSelectionMode}
								isThemeSelectionMode={appState.isThemeSelectionMode}
								isModelDatabaseMode={appState.isModelDatabaseMode}
								isConfigWizardMode={appState.isConfigWizardMode}
								isCheckpointLoadMode={appState.isCheckpointLoadMode}
								isTitleShapeSelectionMode={appState.isTitleShapeSelectionMode}
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
								onTitleShapeSelect={modeHandlers.handleTitleShapeSelect}
								onTitleShapeSelectionCancel={
									modeHandlers.handleTitleShapeSelectionCancel
								}
								onThemeSelectionCancel={modeHandlers.handleThemeSelectionCancel}
								onModelDatabaseCancel={modeHandlers.handleModelDatabaseCancel}
								onConfigWizardComplete={modeHandlers.handleConfigWizardComplete}
								onConfigWizardCancel={modeHandlers.handleConfigWizardCancel}
								onCheckpointSelect={appHandlers.handleCheckpointSelect}
								onCheckpointCancel={appHandlers.handleCheckpointCancel}
							/>
						)}

						{/* Mode Selection Prompt - shown after plan completion */}
						{appState.isModeSelectionMode && appState.pendingModeSelection && (
							<ModeSelectionPrompt
								onSelect={mode => {
									appState.pendingModeSelection?.onSelect(mode);
									appState.setIsModeSelectionMode(false);
									appState.setPendingModeSelection(null);
								}}
								onCancel={() => {
									appState.pendingModeSelection?.onCancel();
									appState.setIsModeSelectionMode(false);
									appState.setPendingModeSelection(null);
								}}
							/>
						)}

						{/* Plan Review Prompt - shown before plan file is saved */}
						{appState.isPlanReviewMode && appState.pendingPlanReview && (
							<PlanReviewPrompt
								data={appState.pendingPlanReview.data}
								onApprove={() => {
									appState.pendingPlanReview?.onApprove();
									appState.setIsPlanReviewMode(false);
									appState.setPendingPlanReview(null);
								}}
								onReject={() => {
									appState.pendingPlanReview?.onReject();
									appState.setIsPlanReviewMode(false);
									appState.setPendingPlanReview(null);
								}}
							/>
						)}

						{/* Chat Input - only rendered when not in modal mode */}
						{appState.startChat &&
							!(
								appState.isModelSelectionMode ||
								appState.isProviderSelectionMode ||
								appState.isThemeSelectionMode ||
								appState.isModelDatabaseMode ||
								appState.isConfigWizardMode ||
								appState.isTitleShapeSelectionMode ||
								appState.isCheckpointLoadMode ||
								appState.isModeSelectionMode ||
								appState.isPlanReviewMode
							) && (
								<ChatInput
									isCancelling={appState.isCancelling}
									isToolExecuting={appState.isToolExecuting}
									isToolConfirmationMode={appState.isToolConfirmationMode}
									pendingToolCalls={appState.pendingToolCalls}
									currentToolIndex={appState.currentToolIndex}
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
									planModeState={{
										active: appState.planModeActive,
										planId: appState.planId,
										phase: appState.planPhase,
										planFilePath: appState.planFilePath,
									}}
									onToolConfirm={toolHandler.handleToolConfirmation}
									onToolCancel={toolHandler.handleToolConfirmationCancel}
									onSubmit={appHandlers.handleMessageSubmit}
									onCancel={appHandlers.handleCancel}
									onToggleMode={appHandlers.handleToggleDevelopmentMode}
								/>
							)}
					</Box>
				</UIStateProvider>
			</TitleShapeContext.Provider>
		</ThemeContext.Provider>
	);
}
