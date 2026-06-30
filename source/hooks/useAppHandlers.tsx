import {randomBytes} from 'node:crypto';
import React from 'react';
import {
	createClearMessagesHandler,
	handleMessageSubmission,
} from '@/app/utils/app-util';
import {
	ErrorMessage,
	SuccessMessage,
	WarningMessage,
} from '@/components/message-box';
import Status from '@/components/status';
import {getAppConfig} from '@/config/index';
import {CustomCommandExecutor} from '@/custom-commands/executor';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {getModelContextLimit} from '@/models/index';
import {bashExecutor} from '@/services/bash-executor';
import {CheckpointManager} from '@/services/checkpoint-manager';
import {generateKey, setKeyGeneratorSessionId} from '@/session/key-generator';
import {buildSessionHistoryComponents} from '@/session/session-history-renderer';
import type {Session} from '@/session/session-manager';
import {sessionManager} from '@/session/session-manager';
import {createTokenizer} from '@/tokenization/index';
import {
	type GitStatusSummary,
	getGitStatusSummarySync,
} from '@/tools/git/utils';
import type {Task} from '@/tools/tasks/types';
import type {
	CheckpointListItem,
	DevelopmentMode,
	ImageAttachment,
	LLMClient,
	LSPConnectionStatus,
	MCPConnectionStatus,
	Message,
} from '@/types';
import type {CustomCommand} from '@/types/commands';
import type {TuneConfig} from '@/types/config';
import type {ThemePreset} from '@/types/ui';
import type {UpdateInfo} from '@/types/utils';
import {calculateTokenBreakdown} from '@/usage/calculator';
import {autoCompactSessionOverrides} from '@/utils/auto-compact';
import {formatError} from '@/utils/error-formatter';
import {getLogger} from '@/utils/logging';
import {getLastBuiltPrompt} from '@/utils/prompt-builder';

interface UseAppHandlersProps {
	// State
	messages: Message[];
	currentProvider: string;
	currentProviderConfig: import('@/types/config').AIProviderConfig | null;
	currentModel: string;
	currentTheme: ThemePreset;
	developmentMode: DevelopmentMode;
	tune: TuneConfig | undefined;
	abortController: AbortController | null;
	updateInfo: UpdateInfo | null;
	mcpServersStatus: MCPConnectionStatus[] | undefined;
	lspServersStatus: LSPConnectionStatus[];
	preferencesLoaded: boolean;
	customCommandsCount: number;
	customCommandCache: Map<string, CustomCommand>;
	customCommandLoader: CustomCommandLoader | null;
	customCommandExecutor: CustomCommandExecutor | null;

	// State setters
	updateMessages: (newMessages: Message[]) => void;
	setIsCancelling: (value: boolean) => void;
	setDevelopmentMode: (
		updater: DevelopmentMode | ((prev: DevelopmentMode) => DevelopmentMode),
	) => void;
	setIsConversationComplete: (value: boolean) => void;
	setIsToolExecuting: (value: boolean) => void;
	setActiveMode: (mode: import('@/hooks/useAppState').ActiveMode) => void;
	setCheckpointLoadData: (
		value: {
			checkpoints: CheckpointListItem[];
			currentMessageCount: number;
		} | null,
	) => void;
	setShowAllSessions: (value: boolean) => void;
	setCurrentSessionId: (value: string | null) => void;
	setSessionName: (value: string) => void;
	setCurrentProvider: (value: string) => void;
	setCurrentModel: (value: string) => void;
	setLiveTaskList: (value: Task[] | null) => void;

	// Callbacks
	addToChatQueue: (component: React.ReactNode) => void;
	setChatComponents: (components: React.ReactNode[]) => void;
	setLiveComponent: (component: React.ReactNode) => void;
	client: LLMClient | null;
	getMessageTokens: (message: Message) => number;

	// Mode handlers
	enterModelSelectionMode: () => void;
	enterModelDatabaseMode: () => void;
	enterConfigWizardMode: () => void;
	enterSettingsMode: () => void;
	enterMcpWizardMode: () => void;
	enterExplorerMode: () => void;
	enterIdeSelectionMode: () => void;
	enterTune: () => void;
	handleModelSelect: (provider: string, model: string) => Promise<boolean>;

	// Chat handler
	handleChatMessage: (message: string, displayValue?: string) => Promise<void>;

	// VS Code active editor dismissal (dropped on /clear)
	dismissActiveEditor?: () => void;
}

export interface AppHandlers {
	clearMessages: () => Promise<void>;
	handleCancel: () => void;
	handleToggleDevelopmentMode: () => void;
	handleShowStatus: () => void;
	handleCheckpointSelect: (
		checkpointName: string,
		createBackup: boolean,
	) => Promise<void>;
	handleCheckpointCancel: () => void;
	enterSessionSelectorMode: (showAll?: boolean) => void;
	handleSessionSelect: (sessionId: string) => Promise<void>;
	handleSessionCancel: () => void;
	enterCheckpointLoadMode: (
		checkpoints: CheckpointListItem[],
		currentMessageCount: number,
	) => void;
	handleMessageSubmit: (
		message: string,
		displayValue?: string,
		images?: ImageAttachment[],
	) => Promise<void>;
}

/**
 * Consolidates all app handler setup into a single hook
 */
export function useAppHandlers(props: UseAppHandlersProps): AppHandlers {
	const logger = getLogger();

	// Clear messages handler
	const clearMessages = React.useMemo(
		() => async () => {
			const baseClear = createClearMessagesHandler(
				props.updateMessages,
				props.client,
			);
			await baseClear();
			props.setChatComponents([]);
			props.setCurrentSessionId(null);
			// Reset the key-generator session ID so keys in the new conversation
			// are not prefixed with the cleared session's ID. A fresh random ID
			// will be lazily generated on the next generateKey() call.
			setKeyGeneratorSessionId(randomBytes(4).toString('hex'));
			props.setLiveTaskList(null);
			props.dismissActiveEditor?.();
		},
		[
			props.updateMessages,
			props.client,
			props.setChatComponents,
			props.setCurrentSessionId,
			props,
		],
	);

	// Cancel handler
	const handleCancel = React.useCallback(() => {
		// Kill any in-flight bash commands immediately. The auto-execute (yolo/
		// headless) path runs bash without mounting the live BashProgress that
		// owns the escape->cancel handler, so aborting the controller alone would
		// leave the command running until it finished naturally. Cancelling here
		// resolves the bash promise right away regardless of execution path.
		const activeBashIds = bashExecutor.getActiveExecutionIds();
		for (const id of activeBashIds) {
			bashExecutor.cancel(id);
		}

		if (props.abortController) {
			logger.info('Cancelling current operation', {
				operation: 'user_cancellation',
				hasAbortController: !!props.abortController,
				activeBashExecutions: activeBashIds.length,
			});

			props.setIsCancelling(true);
			props.abortController.abort();
		} else if (activeBashIds.length === 0) {
			logger.debug('Cancel requested but no active operation to cancel');
		}
	}, [props.abortController, props.setIsCancelling, logger, props]);

	// Toggle development mode handler
	const handleToggleDevelopmentMode = React.useCallback(() => {
		props.setDevelopmentMode(currentMode => {
			// Don't allow toggling out of headless via Shift+Tab: it's a
			// non-interactive mode entered by the daemon, not the user.
			if (currentMode === 'headless') return currentMode;

			const modes: Array<'normal' | 'auto-accept' | 'yolo' | 'plan'> = [
				'normal',
				'auto-accept',
				'yolo',
				'plan',
			];
			const currentIndex = modes.indexOf(
				currentMode as 'normal' | 'auto-accept' | 'yolo' | 'plan',
			);
			const nextIndex = (currentIndex + 1) % modes.length;
			const nextMode = modes[nextIndex];

			logger.info('Development mode toggled', {
				previousMode: currentMode,
				nextMode,
				modeIndex: nextIndex,
				totalModes: modes.length,
			});

			return nextMode;
		});
	}, [props.setDevelopmentMode, logger, props]);

	// Show status handler
	const handleShowStatus = React.useCallback(async () => {
		logger.debug('Status display requested', {
			currentProvider: props.currentProvider,
			currentModel: props.currentModel,
			currentTheme: props.currentTheme,
		});

		// Calculate context usage and auto-compact info
		let contextUsage:
			| {
					currentTokens: number;
					contextLimit: number | null;
					percentUsed: number;
			  }
			| undefined;
		let autoCompactInfo:
			| {
					enabled: boolean;
					threshold: number;
					mode: string;
					hasOverrides: boolean;
			  }
			| undefined;

		try {
			// Calculate context usage
			const contextLimit = await getModelContextLimit(props.currentModel, {
				providerConfig: props.client?.getProviderConfig(),
			});
			if (contextLimit && props.messages.length > 0) {
				const tokenizer = createTokenizer(
					props.currentProvider,
					props.currentModel,
				);
				try {
					const systemPrompt = getLastBuiltPrompt();
					const systemMessage: Message = {
						role: 'system',
						content: systemPrompt,
					};
					const breakdown = calculateTokenBreakdown(
						[systemMessage, ...props.messages],
						tokenizer,
						props.getMessageTokens,
					);
					const percentUsed = (breakdown.total / contextLimit) * 100;
					contextUsage = {
						currentTokens: breakdown.total,
						contextLimit,
						percentUsed,
					};
				} finally {
					if (tokenizer.free) {
						tokenizer.free();
					}
				}
			}

			// Get auto-compact info
			const config = getAppConfig();
			const autoCompactConfig = config.autoCompact;
			if (autoCompactConfig) {
				const enabled =
					autoCompactSessionOverrides.enabled !== null
						? autoCompactSessionOverrides.enabled
						: autoCompactConfig.enabled;
				const threshold =
					autoCompactSessionOverrides.threshold !== null
						? autoCompactSessionOverrides.threshold
						: autoCompactConfig.threshold;
				const mode =
					autoCompactSessionOverrides.mode !== null
						? autoCompactSessionOverrides.mode
						: autoCompactConfig.mode;
				const hasOverrides =
					autoCompactSessionOverrides.enabled !== null ||
					autoCompactSessionOverrides.threshold !== null ||
					autoCompactSessionOverrides.mode !== null;

				autoCompactInfo = {
					enabled,
					threshold,
					mode,
					hasOverrides,
				};
			}
		} catch (error) {
			logger.debug('Failed to calculate status info', {error});
			// Continue without context usage/auto-compact info
		}

		// Resolve the current git branch for the /status panel. The sync
		// helper reads the .git filesystem directly — same code path as the
		// boot summary, so the two surfaces can't drift. Failures degrade
		// to omitting the line.
		let gitStatus: GitStatusSummary | null = null;
		try {
			gitStatus = getGitStatusSummarySync();
		} catch (error) {
			logger.debug('Failed to resolve git status for /status panel', {error});
		}

		props.addToChatQueue(
			<Status
				key={generateKey('status')}
				provider={props.currentProvider}
				model={props.currentModel}
				theme={props.currentTheme}
				updateInfo={props.updateInfo}
				mcpServersStatus={props.mcpServersStatus}
				lspServersStatus={props.lspServersStatus}
				preferencesLoaded={props.preferencesLoaded}
				customCommandsCount={props.customCommandsCount}
				contextUsage={contextUsage}
				autoCompactInfo={autoCompactInfo}
				gitStatus={gitStatus}
			/>,
		);
	}, [
		props.client,
		props.currentProvider,
		props.currentModel,
		props.currentTheme,
		props.updateInfo,
		props.mcpServersStatus,
		props.lspServersStatus,
		props.preferencesLoaded,
		props.customCommandsCount,
		props.messages,
		props.getMessageTokens,
		props.addToChatQueue,
		logger,
		props,
	]);

	// Checkpoint select handler
	const handleCheckpointSelect = React.useCallback(
		async (checkpointName: string, createBackup: boolean) => {
			try {
				const manager = new CheckpointManager();

				if (createBackup) {
					try {
						await manager.saveCheckpoint(
							`backup-${new Date().toISOString().replace(/[:.]/g, '-')}`,
							props.messages,
							props.currentProvider,
							props.currentModel,
						);
					} catch (error) {
						props.addToChatQueue(
							<WarningMessage
								key={generateKey('backup-warning')}
								message={`Warning: Failed to create backup: ${formatError(
									error,
								)}`}
								hideBox={true}
							/>,
						);
					}
				}

				const checkpointData = await manager.loadCheckpoint(checkpointName, {
					validateIntegrity: true,
				});

				await manager.restoreFiles(checkpointData);

				props.addToChatQueue(
					<SuccessMessage
						key={generateKey('restore-success')}
						message={`✓ Checkpoint '${checkpointName}' restored successfully`}
						hideBox={true}
					/>,
				);
			} catch (error) {
				props.addToChatQueue(
					<ErrorMessage
						key={generateKey('restore-error')}
						message={`Failed to restore checkpoint: ${formatError(error)}`}
						hideBox={true}
					/>,
				);
			} finally {
				props.setActiveMode(null);
				props.setCheckpointLoadData(null);
			}
		},
		[
			props.messages,
			props.currentProvider,
			props.currentModel,
			props.setActiveMode,
			props.setCheckpointLoadData,
			props.addToChatQueue,
			props,
		],
	);

	// Checkpoint cancel handler
	const handleCheckpointCancel = React.useCallback(() => {
		props.setActiveMode(null);
		props.setCheckpointLoadData(null);
	}, [props.setActiveMode, props.setCheckpointLoadData, props]);

	// Enter checkpoint load mode handler
	const enterCheckpointLoadMode = React.useCallback(
		(checkpoints: CheckpointListItem[], currentMessageCount: number) => {
			props.setCheckpointLoadData({checkpoints, currentMessageCount});
			props.setActiveMode('checkpointLoad');
		},
		[props.setCheckpointLoadData, props.setActiveMode, props],
	);

	// Enter session selector mode (for /resume with no args)
	const enterSessionSelectorMode = React.useCallback(
		(showAll?: boolean) => {
			props.setShowAllSessions(showAll ?? false);
			props.setActiveMode('sessionSelector');
		},
		[props.setShowAllSessions, props.setActiveMode, props],
	);

	// Load and apply a session (messages, provider, model)
	const applySession = React.useCallback(
		(session: Session) => {
			props.updateMessages(session.messages);
			props.setCurrentProvider(session.provider);
			props.setCurrentModel(session.model);
			props.setCurrentSessionId(session.id);
			setKeyGeneratorSessionId(session.id);
			// Replay the persisted conversation into scrollback so the user can see
			// what they resumed (prompts, assistant replies, tool activity) instead
			// of an empty screen with only a success line.
			for (const component of buildSessionHistoryComponents(
				session.messages,
				session.model,
			)) {
				props.addToChatQueue(component);
			}
			props.addToChatQueue(
				<SuccessMessage
					key={generateKey('resume-success')}
					message={`Resumed session: ${session.title}`}
					hideBox={true}
				/>,
			);
			props.setActiveMode(null);
		},
		[
			props.updateMessages,
			props.setCurrentProvider,
			props.setCurrentModel,
			props.setCurrentSessionId,
			props.setActiveMode,
			props.addToChatQueue,
			props,
		],
	);

	const handleSessionSelect = React.useCallback(
		async (sessionId: string) => {
			try {
				const session = await sessionManager.loadSession(sessionId);
				if (session) {
					applySession(session);
				} else {
					props.addToChatQueue(
						<ErrorMessage
							key={generateKey('resume-error')}
							message="Session not found"
							hideBox={true}
						/>,
					);
					props.setActiveMode(null);
				}
			} catch (error) {
				props.addToChatQueue(
					<ErrorMessage
						key={generateKey('resume-error')}
						message={`Failed to load session: ${formatError(error)}`}
						hideBox={true}
					/>,
				);
				props.setActiveMode(null);
			}
		},
		[applySession, props.addToChatQueue, props.setActiveMode, props],
	);

	const handleSessionCancel = React.useCallback(() => {
		props.setActiveMode(null);
	}, [props.setActiveMode, props]);

	// Message submit handler
	const handleMessageSubmit = React.useCallback(
		async (
			message: string,
			displayValue?: string,
			images?: ImageAttachment[],
		) => {
			// Reset conversation completion flag when starting a new message
			props.setIsConversationComplete(false);

			// Extract command args for slash commands (used by /rename etc.).
			// The VS Code editor pill is appended at the end of the message
			// (\n\n[@…]<!--vscode-context-->…<!--/vscode-context-->); strip it
			// so it doesn't leak into the parsed args.
			const commandArgs = message.startsWith('/')
				? message
						.replace(
							/\n\n\[@[^\]]+\]<!--vscode-context-->[\s\S]*?<!--\/vscode-context-->\s*$/,
							'',
						)
						.slice(1)
						.trim()
						.split(/\s+/)
						.slice(1)
				: undefined;

			await handleMessageSubmission(
				message,
				{
					customCommandCache: props.customCommandCache,
					customCommandLoader: props.customCommandLoader,
					customCommandExecutor: props.customCommandExecutor,
					onClearMessages: clearMessages,
					onRenameSession: props.setSessionName,
					commandArgs,
					onEnterModelSelectionMode: props.enterModelSelectionMode,
					onEnterModelDatabaseMode: props.enterModelDatabaseMode,
					onEnterConfigWizardMode: props.enterConfigWizardMode,
					onEnterSettingsMode: props.enterSettingsMode,
					onEnterMcpWizardMode: props.enterMcpWizardMode,
					onEnterExplorerMode: props.enterExplorerMode,
					onEnterIdeSelectionMode: props.enterIdeSelectionMode,
					onEnterTune: props.enterTune,
					onEnterCheckpointLoadMode: enterCheckpointLoadMode,
					onEnterSessionSelectorMode: enterSessionSelectorMode,
					onResumeSession: session => applySession(session),
					onShowStatus: handleShowStatus,
					onHandleChatMessage: props.handleChatMessage,
					onSwitchModel: props.handleModelSelect,
					onAddToChatQueue: props.addToChatQueue,
					setLiveComponent: props.setLiveComponent,
					setIsToolExecuting: props.setIsToolExecuting,
					onCommandComplete: () => props.setIsConversationComplete(true),
					setMessages: props.updateMessages,
					messages: props.messages,
					provider: props.currentProvider,
					providerConfig: props.currentProviderConfig,
					client: props.client,
					model: props.currentModel,
					theme: props.currentTheme,
					updateInfo: props.updateInfo,
					getMessageTokens: props.getMessageTokens,
					tune: props.tune,
					developmentMode: props.developmentMode,
				},
				displayValue,
				images,
			);
		},
		[
			props.setIsConversationComplete,
			props.customCommandCache,
			props.customCommandLoader,
			props.customCommandExecutor,
			props.enterModelSelectionMode,
			props.enterModelDatabaseMode,
			props.enterConfigWizardMode,
			props.enterSettingsMode,
			props.enterMcpWizardMode,
			props.enterExplorerMode,
			props.enterIdeSelectionMode,
			props.enterTune,
			props.handleChatMessage,
			props.addToChatQueue,
			props.setLiveComponent,
			props.setIsToolExecuting,
			props.updateMessages,
			props.messages,
			props.currentProvider,
			props.currentProviderConfig,
			props.currentModel,
			props.currentTheme,
			props.updateInfo,
			props.getMessageTokens,
			props.tune,
			props.developmentMode,
			clearMessages,
			enterCheckpointLoadMode,
			handleShowStatus,
			applySession,
			enterSessionSelectorMode,
			props,
		],
	);

	return {
		clearMessages,
		handleCancel,
		handleToggleDevelopmentMode,
		handleShowStatus,
		handleCheckpointSelect,
		handleCheckpointCancel,
		enterCheckpointLoadMode,
		enterSessionSelectorMode,
		handleSessionSelect,
		handleSessionCancel,
		handleMessageSubmit,
	};
}
