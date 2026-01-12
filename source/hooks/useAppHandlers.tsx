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
import {
	getCurrentMode,
	resetPlanModeState,
	setCurrentMode as setCurrentModeContext,
	setPlanFilePath as setPlanFilePathContext,
	setPlanId as setPlanIdContext,
	setPlanPhase as setPlanPhaseContext,
} from '@/context/mode-context';
import {CustomCommandExecutor} from '@/custom-commands/executor';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {CheckpointManager} from '@/services/checkpoint-manager';
import {createPlanManager} from '@/services/plan-manager';
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
import {getLogger} from '@/utils/logging';
import {addToMessageQueue} from '@/utils/message-queue';

// Define modes array outside the callback for use in both places
const MODES: Array<'normal' | 'auto-accept' | 'plan'> = [
	'normal',
	'auto-accept',
	'plan',
];

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
	// Plan mode state setters
	setPlanModeActive: (value: boolean) => void;
	setPlanId: (planId: string | null) => void;
	setPlanPhase: (phase: import('@/types/core').PlanPhase) => void;
	setPlanFilePath: (filePath: string) => void;

	// Callbacks
	addToChatQueue: (component: React.ReactNode) => void;
	setLiveComponent: (component: React.ReactNode) => void;
	client: LLMClient | null;
	getMessageTokens: (message: Message) => number;

	// Mode handlers
	enterModelSelectionMode: () => void;
	enterProviderSelectionMode: () => void;
	enterThemeSelectionMode: () => void;
	enterTitleShapeSelectionMode: () => void;
	enterModelDatabaseMode: () => void;
	enterConfigWizardMode: () => void;

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
	const handleToggleDevelopmentMode = React.useCallback(async () => {
		props.setDevelopmentMode(currentMode => {
			const currentIndex = MODES.indexOf(currentMode);
			const nextIndex = (currentIndex + 1) % MODES.length;
			const nextMode = MODES[nextIndex];

			logger.info('Development mode toggled', {
				previousMode: currentMode,
				nextMode,
				modeIndex: nextIndex,
				totalModes: MODES.length,
			});

			// Reset plan mode state when toggling away from plan mode
			if (currentMode === 'plan' && nextMode !== 'plan') {
				resetPlanModeState();
				props.setPlanModeActive(false);
				props.setPlanId(null);
			}

			// Sync global mode context for tool needsApproval logic
			setCurrentModeContext(nextMode);

			return nextMode;
		});

		// After mode is set, check if we need to trigger structured Plan Mode workflow
		// We need to read the new state after setState completes
		// For simplicity, we'll trigger the async workflow after a brief delay
		setTimeout(async () => {
			// Read the updated mode from context
			const newMode = getCurrentMode();

			// Auto-trigger structured Plan Mode workflow when cycling to 'plan' mode
			if (newMode === 'plan') {
				try {
					// Create plan manager for current working directory
					const cwd = process.cwd();
					const planManager = createPlanManager(cwd);

					// Validate directory
					const validationResult = await planManager.validateDirectory();
					if (!validationResult.valid) {
						// Show error and don't enter plan mode
						props.addToChatQueue(
							<ErrorMessage
								key={`plan-mode-error-${Date.now()}`}
								message={`Cannot enter plan mode: ${validationResult.reason}`}
								hideBox={true}
							/>,
						);
						// Revert to previous mode
						const previousMode =
							MODES[
								(MODES.indexOf(newMode) - 1 + MODES.length) % MODES.length
							];
						setCurrentModeContext(previousMode);
						props.setDevelopmentMode(previousMode);
						return;
					}

					// Create new plan
					const {planId, planPath} = await planManager.createPlan();

					// Update global mode context
					setPlanIdContext(planId);
					setPlanPhaseContext('understanding');
					setPlanFilePathContext(planPath);

					// Update React state
					props.setPlanModeActive(true);
					props.setPlanId(planId);
					props.setPlanPhase('understanding');
					props.setPlanFilePath(planPath);

					// Show success message
					props.addToChatQueue(
						<SuccessMessage
							key={`plan-mode-enter-${Date.now()}`}
							message={`⏸ Entered Plan Mode\n\nPlan ID: ${planId}\nPlan File: ${planPath}\nPhase: Understanding\n\nUse read-only tools to explore the codebase and write findings to the plan file.`}
							hideBox={true}
						/>,
					);

					logger.info(`Entered plan mode with plan ID: ${planId}`);
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					props.addToChatQueue(
						<ErrorMessage
							key={`plan-mode-error-${Date.now()}`}
							message={`Failed to enter plan mode: ${errorMessage}`}
							hideBox={true}
						/>,
					);
					// Revert to previous mode
					props.setDevelopmentMode('normal');
					setCurrentModeContext('normal');
				}
			}
		}, 0);
	}, [
		props.setDevelopmentMode,
		props.setPlanModeActive,
		props.setPlanId,
		props.setPlanPhase,
		props.setPlanFilePath,
		props.addToChatQueue,
		logger,
	]);

	// Show status handler
	const handleShowStatus = React.useCallback(() => {
		logger.debug('Status display requested', {
			currentProvider: props.currentProvider,
			currentModel: props.currentModel,
			currentTheme: props.currentTheme,
		});

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
				onEnterThemeSelectionMode: props.enterThemeSelectionMode,
				onEnterModelDatabaseMode: props.enterModelDatabaseMode,
				onEnterConfigWizardMode: props.enterConfigWizardMode,
				onEnterCheckpointLoadMode: enterCheckpointLoadMode,
				onEnterTitleShapeSelectionMode: props.enterTitleShapeSelectionMode,
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
