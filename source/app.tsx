import {Box, Text, useApp} from 'ink';
import WelcomeMessage from '@/components/welcome-message';
import React, {useEffect, useMemo} from 'react';
import {getThemeColors} from '@/config/themes';
import {ThemeContext} from '@/hooks/useTheme';
import UserInput from '@/components/user-input';
import Status from '@/components/status';
import ChatQueue from '@/components/chat-queue';
import ModelSelector from '@/components/model-selector';
import ProviderSelector from '@/components/provider-selector';
import ThemeSelector from '@/components/theme-selector';
import CheckpointSelector from '@/components/checkpoint-selector';
import CancellingIndicator from '@/components/cancelling-indicator';
import ToolConfirmation from '@/components/tool-confirmation';
import ToolExecutionIndicator from '@/components/tool-execution-indicator';
import BashExecutionIndicator from '@/components/bash-execution-indicator';
import {setGlobalMessageQueue, addToMessageQueue} from '@/utils/message-queue';
import Spinner from 'ink-spinner';
import SecurityDisclaimer from '@/components/security-disclaimer';
import {ModelDatabaseDisplay} from '@/commands/model-database';
import {ConfigWizard} from '@/wizard/config-wizard';
import {CheckpointManager} from '@/services/checkpoint-manager';
import SuccessMessage from '@/components/success-message';
import WarningMessage from '@/components/warning-message';
import ErrorMessage from '@/components/error-message';
import {
	VSCodeExtensionPrompt,
	shouldPromptExtensionInstall,
} from '@/components/vscode-extension-prompt';
import {setCurrentMode as setCurrentModeContext} from '@/context/mode-context';
import {
	getLogger,
	withNewCorrelationContext,
	generateCorrelationId,
	startMetrics,
	endMetrics,
	calculateMemoryDelta,
	formatMemoryUsage,
} from '@/utils/logging';

// Import extracted hooks and utilities
import {useAppState} from '@/hooks/useAppState';
import {useChatHandler} from '@/hooks/useChatHandler';
import {useToolHandler} from '@/hooks/useToolHandler';
import {useModeHandlers} from '@/hooks/useModeHandlers';
import {useAppInitialization} from '@/hooks/useAppInitialization';
import {useDirectoryTrust} from '@/hooks/useDirectoryTrust';
import {useVSCodeServer} from '@/hooks/useVSCodeServer';
import {
	createClearMessagesHandler,
	handleMessageSubmission,
} from '@/app/utils/appUtils';

// Provide shared UI state to components
import {UIStateProvider} from '@/hooks/useUIState';
import {createPinoLogger} from '@/utils/logging/pino-logger';
import type {LoggingCliConfig} from '@/utils/logging/types';

interface AppProps {
	vscodeMode?: boolean;
	vscodePort?: number;
	nonInteractivePrompt?: string;
	nonInteractiveMode?: boolean;
	loggingConfig?: LoggingCliConfig;
}

export function shouldRenderWelcome(nonInteractiveMode?: boolean) {
	return !nonInteractiveMode;
}

/**
 * Helper function to determine if non-interactive mode processing is complete
 */
export function isNonInteractiveModeComplete(
	appState: {
		isToolExecuting: boolean;
		isBashExecuting: boolean;
		isToolConfirmationMode: boolean;
		isConversationComplete: boolean;
		messages: Array<{role: string; content: string}>;
	},
	startTime: number,
	maxExecutionTimeMs: number,
): {
	shouldExit: boolean;
	reason: 'complete' | 'timeout' | 'error' | 'tool-approval' | null;
} {
	const isComplete =
		!appState.isToolExecuting &&
		!appState.isBashExecuting &&
		!appState.isToolConfirmationMode;
	const _hasMessages = appState.messages.length > 0;
	const hasTimedOut = Date.now() - startTime > maxExecutionTimeMs;

	// Check for error messages in the messages array
	const hasErrorMessages = appState.messages.some(
		(message: {role: string; content: string}) =>
			message.role === 'error' ||
			(typeof message.content === 'string' &&
				message.content.toLowerCase().includes('error')),
	);

	// Check for tool approval required messages
	const hasToolApprovalRequired = appState.messages.some(
		(message: {role: string; content: string}) =>
			typeof message.content === 'string' &&
			message.content.includes('Tool approval required'),
	);

	if (hasTimedOut) {
		return {shouldExit: true, reason: 'timeout'};
	}

	if (hasToolApprovalRequired) {
		return {shouldExit: true, reason: 'tool-approval'};
	}

	if (hasErrorMessages) {
		return {shouldExit: true, reason: 'error'};
	}

	// Exit when conversation is complete and either:
	// - We have messages in history (for chat/bash commands), OR
	// - Conversation is marked complete (for display-only commands like /mcp)
	if (isComplete && appState.isConversationComplete) {
		return {shouldExit: true, reason: 'complete'};
	}

	return {shouldExit: false, reason: null};
}

export default function App({
	vscodeMode = false,
	vscodePort,
	nonInteractivePrompt,
	nonInteractiveMode = false,
	loggingConfig = {},
}: AppProps) {
	// Memoize the logger to prevent recreation on every render
	const logger = useMemo(
		() => createPinoLogger(undefined, loggingConfig),
		[loggingConfig],
	);

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
			previousMode: undefined, // Could track previous state if needed
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

	// VS Code server integration - handles prompts from VS Code extension
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

			// Build enhanced prompt with context if available
			let enhancedPrompt = prompt;
			if (context?.filePath) {
				enhancedPrompt = `[Context: ${context.filePath}${
					context.selection ? ` (selection)` : ''
				}]\n\n${prompt}`;
			}
			// This will be connected to chat handler after initialization
			// For now, store it for processing
			logger.debug('VS Code enhanced prompt prepared', {
				enhancedPromptLength: enhancedPrompt.length,
				correlationId,
			});
		},
		[logger],
	);

	// Setup VS Code server (returns connection status and methods)
	// The server handles prompts via callback and exposes methods for sending messages
	const _vsCodeServer = useVSCodeServer({
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
		componentKeyCounter: appState.componentKeyCounter,
		abortController: appState.abortController,
		setAbortController: appState.setAbortController,
		developmentMode: appState.developmentMode,
		nonInteractiveMode,
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
		onConversationComplete: () => {
			// Signal that the conversation has completed
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
		componentKeyCounter: appState.componentKeyCounter,
		resetToolConfirmationState: appState.resetToolConfirmationState,
		onProcessAssistantResponse: chatHandler.processAssistantResponse,
		client: appState.client,
		currentProvider: appState.currentProvider,
		setDevelopmentMode: appState.setDevelopmentMode,
	});

	// Log when application is fully ready and interface is active
	useEffect(() => {
		// Only log when we have a fully initialized application ready for user interaction
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
							chatHandler.isStreaming ||
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
		appState.developmentMode,
		chatHandler.isStreaming,
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
		componentKeyCounter: appState.componentKeyCounter,
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
		componentKeyCounter: appState.componentKeyCounter,
		reinitializeMCPServers: appInitialization.reinitializeMCPServers,
	});

	// Memoize handlers to prevent unnecessary re-renders
	const clearMessages = React.useMemo(
		() => createClearMessagesHandler(appState.updateMessages, appState.client),
		[appState.updateMessages, appState.client],
	);

	const handleCancel = React.useCallback(() => {
		if (appState.abortController) {
			logger.info('Cancelling current operation', {
				operation: 'user_cancellation',
				hasAbortController: !!appState.abortController,
			});

			appState.setIsCancelling(true);
			appState.abortController.abort();
		} else {
			logger.debug('Cancel requested but no active operation to cancel');
		}
	}, [appState, logger]);

	const handleToggleDevelopmentMode = React.useCallback(() => {
		appState.setDevelopmentMode(currentMode => {
			const modes: Array<'normal' | 'auto-accept' | 'plan'> = [
				'normal',
				'auto-accept',
				'plan',
			];
			const currentIndex = modes.indexOf(currentMode);
			const nextIndex = (currentIndex + 1) % modes.length;
			const nextMode = modes[nextIndex];

			logger.info('Development mode toggled', {
				previousMode: currentMode,
				nextMode,
				modeIndex: nextIndex,
				totalModes: modes.length,
			});

			// Sync global mode context for tool needsApproval logic
			setCurrentModeContext(nextMode);

			return nextMode;
		});
	}, [appState, logger]);

	const handleShowStatus = React.useCallback(() => {
		logger.debug('Status display requested', {
			currentProvider: appState.currentProvider,
			currentModel: appState.currentModel,
			currentTheme: appState.currentTheme,
			componentKeyCounter: appState.componentKeyCounter,
		});

		appState.addToChatQueue(
			<Status
				key={`status-${appState.componentKeyCounter}`}
				provider={appState.currentProvider}
				model={appState.currentModel}
				theme={appState.currentTheme}
				updateInfo={appState.updateInfo}
				mcpServersStatus={appState.mcpServersStatus}
				lspServersStatus={appState.lspServersStatus}
				preferencesLoaded={appState.preferencesLoaded}
				customCommandsCount={appState.customCommandsCount}
			/>,
		);
	}, [appState]);

	// Checkpoint selection handlers
	const handleCheckpointSelect = React.useCallback(
		async (checkpointName: string, createBackup: boolean) => {
			try {
				const manager = new CheckpointManager();

				if (createBackup) {
					try {
						await manager.saveCheckpoint(
							`backup-${new Date().toISOString().replace(/[:.]/g, '-')}`,
							appState.messages,
							appState.currentProvider,
							appState.currentModel,
						);
					} catch (error) {
						addToMessageQueue(
							<WarningMessage
								key={`backup-warning-${Date.now()}`}
								message={`Warning: Failed to create backup: ${
									error instanceof Error ? error.message : 'Unknown error'
								}`}
								hideBox={true}
							/>,
						);
					}
				}

				const checkpointData = await manager.loadCheckpoint(checkpointName, {
					validateIntegrity: true,
				});

				await manager.restoreFiles(checkpointData);

				addToMessageQueue(
					<SuccessMessage
						key={`restore-success-${Date.now()}`}
						message={`✓ Checkpoint '${checkpointName}' restored successfully`}
						hideBox={true}
					/>,
				);
			} catch (error) {
				addToMessageQueue(
					<ErrorMessage
						key={`restore-error-${Date.now()}`}
						message={`Failed to restore checkpoint: ${
							error instanceof Error ? error.message : 'Unknown error'
						}`}
						hideBox={true}
					/>,
				);
			} finally {
				appState.setIsCheckpointLoadMode(false);
				appState.setCheckpointLoadData(null);
			}
		},
		[appState],
	);

	const handleCheckpointCancel = React.useCallback(() => {
		appState.setIsCheckpointLoadMode(false);
		appState.setCheckpointLoadData(null);
	}, [appState]);

	const enterCheckpointLoadMode = React.useCallback(
		(
			checkpoints: import('@/types/checkpoint').CheckpointListItem[],
			currentMessageCount: number,
		) => {
			appState.setCheckpointLoadData({checkpoints, currentMessageCount});
			appState.setIsCheckpointLoadMode(true);
		},
		[appState],
	);

	const handleMessageSubmit = React.useCallback(
		async (message: string) => {
			// Reset conversation completion flag when starting a new message
			appState.setIsConversationComplete(false);

			await handleMessageSubmission(message, {
				customCommandCache: appState.customCommandCache,
				customCommandLoader: appState.customCommandLoader,
				customCommandExecutor: appState.customCommandExecutor,
				onClearMessages: clearMessages,
				onEnterModelSelectionMode: modeHandlers.enterModelSelectionMode,
				onEnterProviderSelectionMode: modeHandlers.enterProviderSelectionMode,
				onEnterThemeSelectionMode: modeHandlers.enterThemeSelectionMode,
				onEnterModelDatabaseMode: modeHandlers.enterModelDatabaseMode,
				onEnterConfigWizardMode: modeHandlers.enterConfigWizardMode,
				onEnterCheckpointLoadMode: enterCheckpointLoadMode,
				onShowStatus: handleShowStatus,
				onHandleChatMessage: chatHandler.handleChatMessage,
				onAddToChatQueue: appState.addToChatQueue,
				onCommandComplete: () => appState.setIsConversationComplete(true),
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
			});
		},
		[
			appState,
			clearMessages,
			modeHandlers.enterModelSelectionMode,
			modeHandlers.enterProviderSelectionMode,
			modeHandlers.enterThemeSelectionMode,
			modeHandlers.enterModelDatabaseMode,
			modeHandlers.enterConfigWizardMode,
			enterCheckpointLoadMode,
			handleShowStatus,
			chatHandler.handleChatMessage,
		],
	);

	// Handle non-interactive mode - automatically submit prompt and exit when done
	const [nonInteractiveSubmitted, setNonInteractiveSubmitted] =
		React.useState(false);
	React.useEffect(() => {
		if (
			nonInteractivePrompt &&
			appState.mcpInitialized &&
			appState.client &&
			!nonInteractiveSubmitted
		) {
			setNonInteractiveSubmitted(true);
			// Set auto-accept mode for non-interactive execution
			appState.setDevelopmentMode('auto-accept');
			// Submit the prompt
			void handleMessageSubmit(nonInteractivePrompt);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		nonInteractivePrompt,
		appState.mcpInitialized,
		appState.client,
		nonInteractiveSubmitted,
		handleMessageSubmit,
		appState.setDevelopmentMode,
	]);

	// Exit in non-interactive mode when all processing is complete
	const OUTPUT_FLUSH_DELAY_MS = 1000;
	const MAX_EXECUTION_TIME_MS = 300000; // 5 minutes
	const [startTime] = React.useState(Date.now());

	React.useEffect(() => {
		if (nonInteractivePrompt && nonInteractiveSubmitted) {
			const {shouldExit, reason} = isNonInteractiveModeComplete(
				appState,
				startTime,
				MAX_EXECUTION_TIME_MS,
			);

			if (shouldExit) {
				if (reason === 'timeout') {
					console.error('Non-interactive mode timed out');
				} else if (reason === 'error') {
					console.error('Non-interactive mode encountered errors');
				} else if (reason === 'tool-approval') {
					// Exit with error code when tool approval is required
					// Error message already printed by useChatHandler
				}
				// Wait a bit to ensure all output is flushed
				const timer = setTimeout(() => {
					process.exit(
						reason === 'error' || reason === 'tool-approval' ? 1 : 0,
					);
				}, OUTPUT_FLUSH_DELAY_MS);

				return () => clearTimeout(timer);
			}
		}
	}, [
		nonInteractivePrompt,
		nonInteractiveSubmitted,
		appState,
		startTime,
		exit,
	]);

	const shouldShowWelcome = shouldRenderWelcome(nonInteractiveMode);
	const pendingToolCallCount = appState.pendingToolCalls.length;

	const nonInteractiveLoadingMessage = React.useMemo(() => {
		if (!nonInteractivePrompt) {
			return null;
		}

		// Don't show loading message when conversation is complete (about to exit)
		if (appState.isConversationComplete) {
			return null;
		}

		if (!appState.mcpInitialized || !appState.client) {
			return 'Waiting for MCP servers...';
		}

		if (
			appState.isToolExecuting ||
			appState.isToolConfirmationMode ||
			pendingToolCallCount > 0
		) {
			return 'Waiting for tooling...';
		}

		if (appState.isBashExecuting) {
			return 'Waiting for bash execution...';
		}

		return 'Waiting for chat to complete...';
	}, [
		nonInteractivePrompt,
		appState.isConversationComplete,
		appState.mcpInitialized,
		appState.client,
		appState.isToolExecuting,
		appState.isToolConfirmationMode,
		pendingToolCallCount,
		appState.isBashExecuting,
	]);

	const loadingLabel = nonInteractivePrompt
		? nonInteractiveLoadingMessage ?? 'Loading...'
		: 'Loading...';

	// Memoize static components to prevent unnecessary re-renders
	const staticComponents = React.useMemo(() => {
		const components: React.ReactNode[] = [];
		if (shouldShowWelcome) {
			components.push(<WelcomeMessage key="welcome" />);
		}
		components.push(
			<Status
				key="status"
				provider={appState.currentProvider}
				model={appState.currentModel}
				theme={appState.currentTheme}
				updateInfo={appState.updateInfo}
				mcpServersStatus={appState.mcpServersStatus}
				lspServersStatus={appState.lspServersStatus}
				preferencesLoaded={appState.preferencesLoaded}
				customCommandsCount={appState.customCommandsCount}
			/>,
		);
		return components;
	}, [
		shouldShowWelcome,
		appState.currentProvider,
		appState.currentModel,
		appState.currentTheme,
		appState.updateInfo,
		appState.mcpServersStatus,
		appState.lspServersStatus,
		appState.preferencesLoaded,
		appState.customCommandsCount,
	]);

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

	return (
		<ThemeContext.Provider value={themeContextValue}>
			<UIStateProvider>
				<Box flexDirection="column" padding={1} width="100%">
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
							{appState.isCancelling && <CancellingIndicator />}
							{/* Show streaming content while it's being streamed */}
							{chatHandler.isStreaming && chatHandler.streamingContent && (
								<Box flexDirection="column" marginBottom={1}>
									<Box marginBottom={1}>
										<Text color={themeContextValue.colors.primary} bold>
											{appState.currentModel}:
										</Text>
									</Box>
									<Text>{chatHandler.streamingContent}</Text>
								</Box>
							)}
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
							) : appState.isModelDatabaseMode ? (
								<ModelDatabaseDisplay
									onCancel={modeHandlers.handleModelDatabaseCancel}
								/>
							) : appState.isConfigWizardMode ? (
								<ConfigWizard
									projectDir={process.cwd()}
									onComplete={configPath =>
										void modeHandlers.handleConfigWizardComplete(configPath)
									}
									onCancel={modeHandlers.handleConfigWizardCancel}
								/>
							) : appState.isCheckpointLoadMode &&
							  appState.checkpointLoadData ? (
								<CheckpointSelector
									checkpoints={appState.checkpointLoadData.checkpoints}
									currentMessageCount={
										appState.checkpointLoadData.currentMessageCount
									}
									onSelect={(name, backup) =>
										void handleCheckpointSelect(name, backup)
									}
									onCancel={handleCheckpointCancel}
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
							) : appState.mcpInitialized &&
							  appState.client &&
							  !nonInteractivePrompt ? (
								<UserInput
									customCommands={Array.from(
										appState.customCommandCache.keys(),
									)}
									onSubmit={msg => void handleMessageSubmit(msg)}
									disabled={
										chatHandler.isStreaming ||
										appState.isToolExecuting ||
										appState.isBashExecuting
									}
									onCancel={handleCancel}
									onToggleMode={handleToggleDevelopmentMode}
									developmentMode={appState.developmentMode}
								/>
							) : appState.mcpInitialized && !appState.client ? (
								<></>
							) : nonInteractivePrompt && !nonInteractiveLoadingMessage ? (
								// Show completion message when non-interactive mode is done
								<Text color={themeContextValue.colors.secondary}>
									Completed. Exiting.
								</Text>
							) : (
								<Text color={themeContextValue.colors.secondary}>
									<Spinner type="dots" /> {loadingLabel}
								</Text>
							)}
						</Box>
					)}
				</Box>
			</UIStateProvider>
		</ThemeContext.Provider>
	);
}
