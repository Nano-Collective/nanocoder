import {Box, Text, useApp} from 'ink';
import WelcomeMessage from '@/components/welcome-message';
import React from 'react';
import {getThemeColors} from '@/config/themes';
import {ThemeContext} from '@/hooks/useTheme';
import UserInput from '@/components/user-input';
import Status from '@/components/status';
import ChatQueue from '@/components/chat-queue';
import ModelSelector from '@/components/model-selector';
import ProviderSelector from '@/components/provider-selector';
import ThemeSelector from '@/components/theme-selector';
import ThinkingIndicator from '@/components/thinking-indicator';
import CancellingIndicator from '@/components/cancelling-indicator';
import ToolConfirmation from '@/components/tool-confirmation';
import ToolExecutionIndicator from '@/components/tool-execution-indicator';
import BashExecutionIndicator from '@/components/bash-execution-indicator';
import {setGlobalMessageQueue} from '@/utils/message-queue';
import Spinner from 'ink-spinner';
import SecurityDisclaimer from '@/components/security-disclaimer';
import {RecommendationsDisplay} from '@/commands/recommendations';
import {ConfigWizard} from '@/wizard/config-wizard';
import SessionSelector from '@/components/session-selector';
import SessionSavingIndicator from '@/components/session-saving-indicator';

// Import extracted hooks and utilities
import {useAppState} from '@/hooks/useAppState';
import {useChatHandler} from '@/hooks/useChatHandler';
import {useToolHandler} from '@/hooks/useToolHandler';
import {useModeHandlers} from '@/hooks/useModeHandlers';
import {useAppInitialization} from '@/hooks/useAppInitialization';
import {useDirectoryTrust} from '@/hooks/useDirectoryTrust';
import {
	createClearMessagesHandler,
	handleMessageSubmission,
} from '@/app/utils/appUtils';

// Provide shared UI state to components
import {UIStateProvider} from '@/hooks/useUIState';

export default function App() {
	// Use extracted hooks
	const appState = useAppState();
	const {exit} = useApp();
	const {isTrusted, handleConfirmTrust, isTrustLoading, isTrustedError} =
		useDirectoryTrust();

	const handleExit = () => {
		exit();
	};

	// Create theme context value
	const themeContextValue = {
		currentTheme: appState.currentTheme,
		colors: getThemeColors(appState.currentTheme),
		setCurrentTheme: appState.setCurrentTheme,
	};

	// Initialize global message queue on component mount
	React.useEffect(() => {
		setGlobalMessageQueue(appState.addToChatQueue);
	}, [appState.addToChatQueue]);

	// Setup chat handler
	const chatHandler = useChatHandler({
		client: appState.client,
		toolManager: appState.toolManager,
	messages: appState.messages,
		setMessages: appState.updateMessages,
		currentModel: appState.currentModel,
		setIsThinking: appState.setIsThinking,
		setIsCancelling: appState.setIsCancelling,
		addToChatQueue: appState.addToChatQueue,
		componentKeyCounter: appState.componentKeyCounter,
		abortController: appState.abortController,
		setAbortController: appState.setAbortController,
		developmentMode: appState.developmentMode,
	onStartToolConfirmationFlow: (
			toolCalls,
			updatedMessages,
			assistantMsg,
			systemMessage,
		) => {
			appState.setPendingToolCalls(toolCalls);
			appState.setCurrentToolIndex(0);
			appState.setCompletedToolResults([]);
			appState.setCurrentConversationContext({
				updatedMessages,
				assistantMsg,
				systemMessage,
			});
			appState.setIsToolConfirmationMode(true);
		},
		// Session management
		currentSession: appState.currentSession,
		sessionManager: appState.sessionManager,
		saveSessionDebounced: appState.saveSessionDebounced,
		convertMessageToSessionFormat: appState.convertMessageToSessionFormat,
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
		componentKeyCounter: appState.componentKeyCounter,
		resetToolConfirmationState: appState.resetToolConfirmationState,
		onProcessAssistantResponse: chatHandler.processAssistantResponse,
		client: appState.client,
		currentProvider: appState.currentProvider,
		setDevelopmentMode: appState.setDevelopmentMode,
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
			setIsRecommendationsMode: appState.setIsRecommendationsMode,
			setIsConfigWizardMode: appState.setIsConfigWizardMode,
			setIsSessionSelectionMode: appState.setIsSessionSelectionMode,
			addToChatQueue: appState.addToChatQueue,
			componentKeyCounter: appState.componentKeyCounter,
		});

	// Setup initialization
	useAppInitialization({
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
		addToChatQueue: appState.addToChatQueue,
		componentKeyCounter: appState.componentKeyCounter,
		customCommandCache: appState.customCommandCache,
		setIsConfigWizardMode: appState.setIsConfigWizardMode,
	});

	// Memoize handlers to prevent unnecessary re-renders
	const clearMessages = React.useMemo(
		() => createClearMessagesHandler(appState.updateMessages, appState.client),
		[appState.updateMessages, appState.client],
	);

	const handleCancel = React.useCallback(() => {
		if (appState.abortController) {
			appState.setIsCancelling(true);
			appState.abortController.abort();
		}
	}, [appState]);

	const handleToggleDevelopmentMode = React.useCallback(() => {
		appState.setDevelopmentMode(currentMode => {
			const modes: Array<'normal' | 'auto-accept' | 'plan'> = [
				'normal',
				'auto-accept',
				'plan',
			];
			const currentIndex = modes.indexOf(currentMode);
			const nextIndex = (currentIndex + 1) % modes.length;
			return modes[nextIndex];
		});
	}, [appState]);

	const handleShowStatus = React.useCallback(() => {
		appState.addToChatQueue(
			<Status
				key={`status-${appState.componentKeyCounter}`}
				provider={appState.currentProvider}
				model={appState.currentModel}
				theme={appState.currentTheme}
				updateInfo={appState.updateInfo}
			/>,
		);
	}, [appState]);

	const handleMessageSubmit = React.useCallback(
		async (message: string) => {
			await handleMessageSubmission(message, {
					customCommandCache: appState.customCommandCache,
					customCommandLoader: appState.customCommandLoader,
					customCommandExecutor: appState.customCommandExecutor,
					onClearMessages: clearMessages,
					onEnterModelSelectionMode: modeHandlers.enterModelSelectionMode,
					onEnterProviderSelectionMode: modeHandlers.enterProviderSelectionMode,
					onEnterThemeSelectionMode: modeHandlers.enterThemeSelectionMode,
					onEnterRecommendationsMode: modeHandlers.enterRecommendationsMode,
					onEnterConfigWizardMode: modeHandlers.enterConfigWizardMode,
				onEnterSessionSelectionMode: modeHandlers.enterSessionSelectionMode,
					onShowStatus: handleShowStatus,
					onHandleChatMessage: chatHandler.handleChatMessage,
					onAddToChatQueue: appState.addToChatQueue,
					componentKeyCounter: appState.componentKeyCounter,
					setMessages: appState.updateMessages,
					messages: appState.messages,
					setIsBashExecuting: appState.setIsBashExecuting,
					setCurrentBashCommand: appState.setCurrentBashCommand,
					provider: appState.currentProvider,
					model: appState.currentModel,
					theme: appState.currentTheme,
					updateInfo: appState.updateInfo,
					getMessageTokens: appState.getMessageTokens,
				sessionManager: appState.sessionManager,
				convertSessionMessageToAppFormat: appState.convertSessionMessageToAppFormat,
				convertMessageToSessionFormat: appState.convertMessageToSessionFormat,
				setCurrentProvider: appState.setCurrentProvider,
				setCurrentModel: appState.setCurrentModel,
				setCurrentSession: appState.setCurrentSession,
			});
		},
		[
			appState.customCommandCache,
			appState.customCommandLoader,
			appState.customCommandExecutor,
			clearMessages,
			modeHandlers.enterModelSelectionMode,
			modeHandlers.enterProviderSelectionMode,
			modeHandlers.enterThemeSelectionMode,
			modeHandlers.enterRecommendationsMode,
			modeHandlers.enterConfigWizardMode,
			handleShowStatus,
			chatHandler.handleChatMessage,
			appState.addToChatQueue,
			appState.componentKeyCounter,
			appState.updateMessages,
			appState.messages,
			appState.setIsBashExecuting,
			appState.setCurrentBashCommand,
			appState.currentProvider,
			appState.currentModel,
			appState.currentTheme,
			appState.updateInfo,
			appState.getMessageTokens,
		],
	);

	// Memoize static components to prevent unnecessary re-renders
	const staticComponents = React.useMemo(
		() => [
			<WelcomeMessage key="welcome" />,
			<Status
				key="status"
				provider={appState.currentProvider}
				model={appState.currentModel}
				theme={appState.currentTheme}
				updateInfo={appState.updateInfo}
			/>,
		],
		[
			appState.currentProvider,
			appState.currentModel,
			appState.currentTheme,
			appState.updateInfo,
		],
	);

	// Handle loading state for directory trust check
	if (isTrustLoading) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color={themeContextValue.colors.secondary}>
					<Spinner type="dots2" /> Checking directory trust...
				</Text>
			</Box>
		);
	}

	// Handle error state for directory trust
	if (isTrustedError) {
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
		return (
			<SecurityDisclaimer onConfirm={handleConfirmTrust} onExit={handleExit} />
		);
	}

	return (
		<ThemeContext.Provider value={themeContextValue}>
			<UIStateProvider>
				<Box flexDirection="column" padding={1} width="100%">
					<SessionSavingIndicator
						status={appState.sessionSaveStatus}
						sessionTitle={appState.lastSavedSessionTitle || undefined}
						saveTime={appState.lastSaveTime || undefined}
						error={appState.saveError || undefined}
					/>
					{/* Use natural flexGrow layout - Static components prevent re-renders */}
					<Box flexGrow={1} flexDirection="column" minHeight={0}>
						{appState.startChat && (
							<ChatQueue
								staticComponents={staticComponents}
								queuedComponents={appState.chatComponents}
							/>
						)}
					</Box>
					{appState.startChat && (
						<Box flexDirection="column" marginLeft={-1}>
							{appState.isCancelling ? (
								<CancellingIndicator />
							) : appState.isThinking ? (
								<ThinkingIndicator />
							) : null}
							{appState.isModelSelectionMode ? (
								<ModelSelector
									client={appState.client}
									currentModel={appState.currentModel}
									onModelSelect={model =>
										void modeHandlers.handleModelSelect(model)
									}
									onCancel={modeHandlers.handleModelSelectionCancel}
								/>
							) : appState.isProviderSelectionMode ? (
								<ProviderSelector
									currentProvider={appState.currentProvider}
									onProviderSelect={provider =>
										void modeHandlers.handleProviderSelect(provider)
									}
									onCancel={modeHandlers.handleProviderSelectionCancel}
								/>
							) : appState.isThemeSelectionMode ? (
								<ThemeSelector
									onThemeSelect={modeHandlers.handleThemeSelect}
									onCancel={modeHandlers.handleThemeSelectionCancel}
								/>
							) : appState.isRecommendationsMode ? (
								<RecommendationsDisplay
									onCancel={modeHandlers.handleRecommendationsCancel}
								/>
							) : appState.isConfigWizardMode ? (
								<ConfigWizard
									projectDir={process.cwd()}
									onComplete={configPath =>
										void modeHandlers.handleConfigWizardComplete(configPath)
									}
									onCancel={modeHandlers.handleConfigWizardCancel}
								/>
							) : appState.isSessionSelectionMode ? (
								<SessionSelector
									sessionManager={appState.sessionManager!}
									onSessionSelect={async (sessionId: string | null) => {
										if (sessionId) {
											try {
												const session = await appState.sessionManager!.loadSession(sessionId);
												if (session) {
													// Convert session messages to app format
													const appMessages = session.messages.map(appState.convertSessionMessageToAppFormat);
													
													// Restore provider/model from session metadata if available
													if (session.metadata?.provider) {
														appState.setCurrentProvider(session.metadata.provider);
													}
													if (session.metadata?.model) {
														appState.setCurrentModel(session.metadata.model);
													}
													
													// Update messages with the session's messages
													appState.updateMessages(appMessages);
													
													// Set current session
													appState.setCurrentSession(session);
													
													// Update session state to indicate existing session
													appState.setSessionState('existing');
													
													appState.addToChatQueue(
														<Text key={`session-resumed-${Date.now()}`}>
															Session "{session.title}" resumed.
														</Text>
													);
												} else {
													appState.addToChatQueue(
														<Text key={`session-not-found-${Date.now()}`}>
															Session not found.
														</Text>
													);
												}
											} catch (error) {
												appState.addToChatQueue(
													<Text key={`session-error-${Date.now()}`}>
														Error loading session: {String(error)}
													</Text>
												);
											}
										} else {
											appState.addToChatQueue(
												<Text key={`session-cancelled-${Date.now()}`}>
													Session selection cancelled.
												</Text>
											);
										}
										
										// Exit session selection mode
										appState.setIsSessionSelectionMode(false);
									}}
									onCancel={() => {
										appState.setIsSessionSelectionMode(false);
										appState.addToChatQueue(
											<Text key={`session-cancelled-${Date.now()}`}>
												Session selection cancelled.
											</Text>
										);
									}}
								/>
							) : appState.isToolConfirmationMode &&
							  appState.pendingToolCalls[appState.currentToolIndex] ? (
								<ToolConfirmation
									toolCall={
										appState.pendingToolCalls[appState.currentToolIndex]
									}
									onConfirm={toolHandler.handleToolConfirmation}
									onCancel={toolHandler.handleToolConfirmationCancel}
								/>
							) : appState.isToolExecuting &&
							  appState.pendingToolCalls[appState.currentToolIndex] ? (
								<ToolExecutionIndicator
									toolName={
										appState.pendingToolCalls[appState.currentToolIndex]
											.function.name
									}
									currentIndex={appState.currentToolIndex}
									totalTools={appState.pendingToolCalls.length}
								/>
							) : appState.isBashExecuting ? (
								<BashExecutionIndicator command={appState.currentBashCommand} />
							) : appState.mcpInitialized && appState.client ? (
								<UserInput
									customCommands={Array.from(
										appState.customCommandCache.keys(),
									)}
									onSubmit={msg => void handleMessageSubmit(msg)}
									disabled={
										appState.isThinking ||
										appState.isToolExecuting ||
										appState.isBashExecuting
									}
									onCancel={handleCancel}
									onToggleMode={handleToggleDevelopmentMode}
									developmentMode={appState.developmentMode}
								/>
							) : appState.mcpInitialized && !appState.client ? (
								<></>
							) : (
								<Text color={themeContextValue.colors.secondary}>
									<Spinner type="dots2" /> Loading...
								</Text>
							)}
						</Box>
					)}
				</Box>
			</UIStateProvider>
		</ThemeContext.Provider>
	);
}
