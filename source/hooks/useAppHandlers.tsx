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
import {setCurrentMode as setCurrentModeContext} from '@/context/mode-context';
import {CustomCommandExecutor} from '@/custom-commands/executor';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {getModelContextLimit} from '@/models/index';
import {CheckpointManager} from '@/services/checkpoint-manager';
import {createTokenizer} from '@/tokenization/index';
import type {
	CheckpointListItem,
	DevelopmentMode,
	LLMClient,
	LSPConnectionStatus,
	MCPConnectionStatus,
	Message,
} from '@/types';
import type {CustomCommand} from '@/types/commands';
import type {ThemePreset} from '@/types/ui';
import type {UpdateInfo} from '@/types/utils';
import {calculateTokenBreakdown} from '@/usage/calculator';
import {autoCompactSessionOverrides} from '@/utils/auto-compact';
import {getLogger} from '@/utils/logging';
import {addToMessageQueue} from '@/utils/message-queue';
import {processPromptTemplate} from '@/utils/prompt-processor';

interface UseAppHandlersProps {
	// State
	messages: Message[];
	currentProvider: string;
	currentModel: string;
	currentTheme: ThemePreset;
	abortController: AbortController | null;
	updateInfo: UpdateInfo | null;
	mcpServersStatus: MCPConnectionStatus[] | undefined;
	lspServersStatus: LSPConnectionStatus[];
	preferencesLoaded: boolean;
	customCommandsCount: number;
	getNextComponentKey: () => number;
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
	setIsCheckpointLoadMode: (value: boolean) => void;
	setCheckpointLoadData: (
		value: {
			checkpoints: CheckpointListItem[];
			currentMessageCount: number;
		} | null,
	) => void;

	// Callbacks
	addToChatQueue: (component: React.ReactNode) => void;
	setLiveComponent: (component: React.ReactNode) => void;
	client: LLMClient | null;
	getMessageTokens: (message: Message) => number;

	// Mode handlers
	enterModelSelectionMode: () => void;
	enterProviderSelectionMode: () => void;
	enterModelDatabaseMode: () => void;
	enterConfigWizardMode: () => void;
	enterSettingsMode: () => void;
	enterMcpWizardMode: () => void;
	enterExplorerMode: () => void;

	// Chat handler
	handleChatMessage: (message: string) => Promise<void>;
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
	enterCheckpointLoadMode: (
		checkpoints: CheckpointListItem[],
		currentMessageCount: number,
	) => void;
	handleMessageSubmit: (message: string) => Promise<void>;
}

/**
 * Consolidates all app handler setup into a single hook
 */
export function useAppHandlers(props: UseAppHandlersProps): AppHandlers {
	const logger = getLogger();

	// Clear messages handler
	const clearMessages = React.useMemo(
		() => createClearMessagesHandler(props.updateMessages, props.client),
		[props.updateMessages, props.client],
	);

	// Cancel handler
	const handleCancel = React.useCallback(() => {
		if (props.abortController) {
			logger.info('Cancelling current operation', {
				operation: 'user_cancellation',
				hasAbortController: !!props.abortController,
			});

			props.setIsCancelling(true);
			props.abortController.abort();
		} else {
			logger.debug('Cancel requested but no active operation to cancel');
		}
	}, [props.abortController, props.setIsCancelling, logger]);

	// Toggle development mode handler
	const handleToggleDevelopmentMode = React.useCallback(() => {
		props.setDevelopmentMode(currentMode => {
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
	}, [props.setDevelopmentMode, logger]);

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
			const contextLimit = await getModelContextLimit(props.currentModel);
			if (contextLimit && props.messages.length > 0) {
				const tokenizer = createTokenizer(
					props.currentProvider,
					props.currentModel,
				);
				try {
					const systemPrompt = processPromptTemplate();
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

		props.addToChatQueue(
			<Status
				key={`status-${props.getNextComponentKey()}`}
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
			/>,
		);
	}, [props, logger]);

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
				props.setIsCheckpointLoadMode(false);
				props.setCheckpointLoadData(null);
			}
		},
		[props],
	);

	// Checkpoint cancel handler
	const handleCheckpointCancel = React.useCallback(() => {
		props.setIsCheckpointLoadMode(false);
		props.setCheckpointLoadData(null);
	}, [props.setIsCheckpointLoadMode, props.setCheckpointLoadData]);

	// Enter checkpoint load mode handler
	const enterCheckpointLoadMode = React.useCallback(
		(checkpoints: CheckpointListItem[], currentMessageCount: number) => {
			props.setCheckpointLoadData({checkpoints, currentMessageCount});
			props.setIsCheckpointLoadMode(true);
		},
		[props.setCheckpointLoadData, props.setIsCheckpointLoadMode],
	);

	// Message submit handler
	const handleMessageSubmit = React.useCallback(
		async (message: string) => {
			// Reset conversation completion flag when starting a new message
			props.setIsConversationComplete(false);

			await handleMessageSubmission(message, {
				customCommandCache: props.customCommandCache,
				customCommandLoader: props.customCommandLoader,
				customCommandExecutor: props.customCommandExecutor,
				onClearMessages: clearMessages,
				onEnterModelSelectionMode: props.enterModelSelectionMode,
				onEnterProviderSelectionMode: props.enterProviderSelectionMode,
				onEnterModelDatabaseMode: props.enterModelDatabaseMode,
				onEnterConfigWizardMode: props.enterConfigWizardMode,
				onEnterSettingsMode: props.enterSettingsMode,
				onEnterMcpWizardMode: props.enterMcpWizardMode,
				onEnterExplorerMode: props.enterExplorerMode,
				onEnterCheckpointLoadMode: enterCheckpointLoadMode,
				onShowStatus: handleShowStatus,
				onHandleChatMessage: props.handleChatMessage,
				onAddToChatQueue: props.addToChatQueue,
				setLiveComponent: props.setLiveComponent,
				setIsToolExecuting: props.setIsToolExecuting,
				onCommandComplete: () => props.setIsConversationComplete(true),
				getNextComponentKey: props.getNextComponentKey,
				setMessages: props.updateMessages,
				messages: props.messages,
				provider: props.currentProvider,
				model: props.currentModel,
				theme: props.currentTheme,
				updateInfo: props.updateInfo,
				getMessageTokens: props.getMessageTokens,
			});
		},
		[props, clearMessages, enterCheckpointLoadMode, handleShowStatus],
	);

	return {
		clearMessages,
		handleCancel,
		handleToggleDevelopmentMode,
		handleShowStatus,
		handleCheckpointSelect,
		handleCheckpointCancel,
		enterCheckpointLoadMode,
		handleMessageSubmit,
	};
}
