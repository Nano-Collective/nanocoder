import {randomBytes} from 'node:crypto';
import React from 'react';
import type {SettingsTabId} from '@/app/components/settings-constants';
import {
	createClearMessagesHandler,
	handleMessageSubmission,
} from '@/app/utils/app-util';
import {stripVSCodeContext} from '@/app/utils/vscode-context';
import {createApprovedPlanMessage} from '@/artifacts/approved-plan';
import {
	ErrorMessage,
	SuccessMessage,
	WarningMessage,
} from '@/components/message-box';
import Status from '@/components/status';
import UserMessage from '@/components/user-message';
import {getAppConfig} from '@/config/index';
import {loadPreferences} from '@/config/preferences';
import {resolveAutoCompactSettings} from '@/conversation/compaction/auto-compact';
import {getLastBuiltPrompt} from '@/conversation/prompt-builder';
import {CustomCommandExecutor} from '@/custom-commands/executor';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {getModelContextLimit} from '@/models/index';
import {bashExecutor} from '@/services/bash-executor';
import {CheckpointManager} from '@/services/checkpoint-manager';
import {
	runLifecycleHooks,
	takePendingHookContext,
} from '@/services/lifecycle-hooks';
import {getProjectRoot} from '@/services/session-cwd';
import {generateKey, setKeyGeneratorSessionId} from '@/session/key-generator';
import {buildSessionHistoryComponents} from '@/session/session-history-renderer';
import type {Session} from '@/session/session-manager';
import {sessionManager} from '@/session/session-manager';
import {createTokenizer} from '@/tokenization/index';
import {
	type GitStatusSummary,
	getGitStatusSummarySync,
} from '@/tools/git/utils';
import {loadTasks} from '@/tools/tasks/storage';
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
import type {ApiCallRecord, ApiUsageSnapshot} from '@/types/core';
import type {ThemePreset} from '@/types/ui';
import type {UpdateInfo} from '@/types/utils';
import {calculateTokenBreakdown} from '@/usage/calculator';
import {describeGapsMessage} from '@/utils/checkpoint-utils';
import {formatError} from '@/utils/error-formatter';
import {getLogger} from '@/utils/logging';
import {bumpReadContentGeneration} from '@/utils/read-tracker';

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
	currentSessionId: string | null;
	ensureCurrentSessionId: () => string;

	// Callbacks
	onClearCounterIncrement?: () => void;

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
	setLiveTaskList: (value: Task[] | null) => void;
	setPlanReviewState: (
		value: {show: boolean; originalMessage: string} | null,
	) => void;
	setPendingPlanProceed: (value: string | null) => void;

	setArchitectReviewState: (
		value: {
			show: boolean;
			checkpointName: string;
			filesChanged: string[];
			filesMissing: string[];
		} | null,
	) => void;

	architectReviewState: {
		show: boolean;
		checkpointName: string;
		filesChanged: string[];
		filesMissing: string[];
	} | null;

	// Callbacks
	addToChatQueue: (component: React.ReactNode) => void;
	setChatComponents: (components: React.ReactNode[]) => void;
	setLiveComponent: (component: React.ReactNode) => void;
	setLiveComponentCapturesInput: (value: boolean) => void;
	client: LLMClient | null;
	getMessageTokens: (message: Message) => number;

	// Mode handlers
	enterModelSelectionMode: () => void;
	enterModelDatabaseMode: () => void;
	enterSettingsMode: (tab?: SettingsTabId) => void;
	enterExplorerMode: () => void;
	enterIdeSelectionMode: () => void;
	enterTune: () => void;
	handleModelSelect: (
		provider: string,
		model: string,
		isProgrammatic?: boolean,
		history?: Message[],
	) => Promise<boolean>;

	// Chat handler
	handleChatMessage: (message: string, displayValue?: string) => Promise<void>;
	lastApiUsage?: ApiUsageSnapshot | null;
	apiCallHistory?: ApiCallRecord[];

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
	applySession: (session: Session) => void;
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
	// Plan review action bar
	handlePlanProceed: () => Promise<void>;
	handleArchitectKeep: () => Promise<void>;
	handleArchitectRevert: () => Promise<void>;
	handleArchitectRevertAndRevise: (instructions: string) => Promise<void>;
	handlePlanAskMore: () => Promise<void>;
	handlePlanModify: () => void;
}

/**
 * Consolidates all app handler setup into a single hook
 */
export function useAppHandlers(props: UseAppHandlersProps): AppHandlers {
	// Destructured once so each handler depends on the values it uses, not on
	// the props object, which the caller rebuilds every render.
	const {
		abortController,
		addToChatQueue,
		apiCallHistory,
		architectReviewState,
		client,
		currentModel,
		currentProvider,
		currentProviderConfig,
		currentSessionId,
		currentTheme,
		customCommandCache,
		customCommandExecutor,
		customCommandLoader,
		customCommandsCount,
		developmentMode,
		dismissActiveEditor,
		ensureCurrentSessionId,
		enterExplorerMode,
		enterIdeSelectionMode,
		enterModelDatabaseMode,
		enterModelSelectionMode,
		enterSettingsMode,
		enterTune,
		getMessageTokens,
		handleChatMessage,
		handleModelSelect,
		lastApiUsage,
		lspServersStatus,
		mcpServersStatus,
		messages,
		onClearCounterIncrement,
		preferencesLoaded,
		setActiveMode,
		setArchitectReviewState,
		setChatComponents,
		setCheckpointLoadData,
		setCurrentSessionId,
		setDevelopmentMode,
		setIsCancelling,
		setIsConversationComplete,
		setIsToolExecuting,
		setLiveComponent,
		setLiveComponentCapturesInput,
		setLiveTaskList,
		setPendingPlanProceed,
		setPlanReviewState,
		setSessionName,
		setShowAllSessions,
		tune,
		updateInfo,
		updateMessages,
	} = props;
	const logger = getLogger();
	// Last mode-switch model toast, so rapid Shift+Tab cycling doesn't stack
	// identical lines in scrollback (the handler races ahead of prop updates).
	const lastModeToastRef = React.useRef<string | null>(null);

	// Clear messages handler
	const clearMessages = React.useMemo(
		() => async () => {
			const baseClear = createClearMessagesHandler(updateMessages, client);
			await baseClear();
			setChatComponents([]);
			setCurrentSessionId(null);
			// Reset the key-generator session ID so keys in the new conversation
			// are not prefixed with the cleared session's ID. A fresh random ID
			// will be lazily generated on the next generateKey() call.
			setKeyGeneratorSessionId(randomBytes(4).toString('hex'));
			setLiveTaskList(null);
			dismissActiveEditor?.();
		},
		[
			updateMessages,
			client,
			setChatComponents,
			setCurrentSessionId,
			setLiveTaskList,
			dismissActiveEditor,
		],
	);

	// Cancel handler
	const handleCancel = React.useCallback(() => {
		// Kill any in-flight bash commands immediately. The auto-execute (yolo/
		// headless) path runs bash without mounting the live BashProgress that
		// owns the escape->cancel handler, so aborting the controller alone would
		// leave the command running until it finished naturally. Cancelling here
		// resolves the bash promise as soon as the command has stopped,
		// regardless of execution path.
		const activeBashIds = bashExecutor.getActiveExecutionIds();
		for (const id of activeBashIds) {
			bashExecutor.cancel(id);
		}

		if (abortController) {
			logger.info('Cancelling current operation', {
				operation: 'user_cancellation',
				hasAbortController: !!abortController,
				activeBashExecutions: activeBashIds.length,
			});

			setIsCancelling(true);
			abortController.abort();
		} else if (activeBashIds.length === 0) {
			logger.debug('Cancel requested but no active operation to cancel');
		}
	}, [abortController, setIsCancelling, logger]);

	// Toggle development mode handler
	const handleToggleDevelopmentMode = React.useCallback(() => {
		// Don't allow toggling out of headless via Shift+Tab: it's a
		// non-interactive mode entered by the daemon, not the user.
		if (developmentMode === 'headless') return;

		const modes: Array<
			'normal' | 'auto-accept' | 'yolo' | 'plan' | 'architect'
		> = ['normal', 'auto-accept', 'yolo', 'plan', 'architect'];
		const currentIndex = modes.indexOf(
			developmentMode as
				| 'normal'
				| 'auto-accept'
				| 'yolo'
				| 'plan'
				| 'architect',
		);
		const nextIndex = (currentIndex + 1) % modes.length;
		const nextMode = modes[nextIndex];

		logger.info('Development mode toggled', {
			previousMode: developmentMode,
			nextMode,
			modeIndex: nextIndex,
			totalModes: modes.length,
		});

		setDevelopmentMode(nextMode);

		// Handle mode-specific provider switching
		const config = getAppConfig();
		const modeConfig = config.modeProviders?.[nextMode];

		void (async () => {
			let targetProvider: string | undefined;
			let targetModel: string | undefined;

			if (modeConfig) {
				targetProvider = modeConfig.provider;
				targetModel = modeConfig.model;
			} else {
				// Restore the user's currently configured default provider/model (stored in preferences)
				const preferences = loadPreferences();
				targetProvider =
					preferences.lastProvider ||
					config.providers?.[0]?.name ||
					'openai-compatible';
				targetModel =
					preferences.providerModels?.[targetProvider] ||
					preferences.lastModel ||
					config.providers?.find(p => p.name === targetProvider)?.models[0] ||
					'';
			}

			if (targetProvider && targetModel) {
				if (
					targetProvider === currentProvider &&
					targetModel === currentModel
				) {
					return;
				}

				// Show a subtle toast when entering a mode that enforces a specific model,
				// since programmatic switches suppress the default "Model changed to..." toast.
				// Landing back on normal only restores the user's own default — the status
				// bar flip is feedback enough, so no toast there.
				const modeToast =
					nextMode === 'normal' ? null : `[${nextMode} mode → ${targetModel}]`;
				if (modeConfig && modeToast && modeToast !== lastModeToastRef.current) {
					lastModeToastRef.current = modeToast;
					addToChatQueue(
						<SuccessMessage
							key={generateKey('mode-model-override')}
							message={modeToast}
							hideBox={true}
						/>,
					);
				}

				await handleModelSelect(targetProvider, targetModel, true);
			}
		})().catch(error => {
			logger.error('Failed to switch model on mode toggle', {
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}, [
		developmentMode,
		setDevelopmentMode,
		handleModelSelect,
		logger,
		currentModel,
		addToChatQueue,
		currentProvider,
	]);

	// Show status handler
	const handleShowStatus = React.useCallback(async () => {
		logger.debug('Status display requested', {
			currentProvider: currentProvider,
			currentModel: currentModel,
			currentTheme: currentTheme,
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
			const contextLimit = await getModelContextLimit(currentModel, {
				providerConfig: client?.getProviderConfig(),
			});
			if (contextLimit && messages.length > 0) {
				const tokenizer = createTokenizer(currentProvider, currentModel);
				try {
					const systemPrompt = getLastBuiltPrompt();
					const systemMessage: Message = {
						role: 'system',
						content: systemPrompt,
					};
					const breakdown = calculateTokenBreakdown(
						[systemMessage, ...messages],
						tokenizer,
						getMessageTokens,
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
				const {enabled, threshold, mode, hasOverrides} =
					resolveAutoCompactSettings(autoCompactConfig);

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

		addToChatQueue(
			<Status
				key={generateKey('status')}
				provider={currentProvider}
				model={currentModel}
				theme={currentTheme}
				updateInfo={updateInfo}
				mcpServersStatus={mcpServersStatus}
				lspServersStatus={lspServersStatus}
				preferencesLoaded={preferencesLoaded}
				customCommandsCount={customCommandsCount}
				contextUsage={contextUsage}
				autoCompactInfo={autoCompactInfo}
				gitStatus={gitStatus}
			/>,
		);
	}, [
		client,
		currentProvider,
		currentModel,
		currentTheme,
		updateInfo,
		mcpServersStatus,
		lspServersStatus,
		preferencesLoaded,
		customCommandsCount,
		messages,
		getMessageTokens,
		addToChatQueue,
		logger,
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
							messages,
							currentProvider,
							currentModel,
						);
					} catch (error) {
						addToChatQueue(
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

				const gaps = await manager.restoreFiles(checkpointData);

				addToChatQueue(
					<SuccessMessage
						key={generateKey('restore-success')}
						message={`✓ Checkpoint '${checkpointName}' restored successfully`}
						hideBox={true}
					/>,
				);

				// A restore that reports only success, when the checkpoint never held
				// every file, leaves the user believing the workspace is back.
				if (gaps.length > 0) {
					addToChatQueue(
						<WarningMessage
							key={generateKey('restore-gaps')}
							message={describeGapsMessage(gaps)}
							hideBox={true}
						/>,
					);
				}
			} catch (error) {
				addToChatQueue(
					<ErrorMessage
						key={generateKey('restore-error')}
						message={`Failed to restore checkpoint: ${formatError(error)}`}
						hideBox={true}
					/>,
				);
			} finally {
				setActiveMode(null);
				setCheckpointLoadData(null);
			}
		},
		[
			messages,
			currentProvider,
			currentModel,
			setActiveMode,
			setCheckpointLoadData,
			addToChatQueue,
		],
	);

	// Checkpoint cancel handler
	const handleCheckpointCancel = React.useCallback(() => {
		setActiveMode(null);
		setCheckpointLoadData(null);
	}, [setActiveMode, setCheckpointLoadData]);

	// Enter checkpoint load mode handler
	const enterCheckpointLoadMode = React.useCallback(
		(checkpoints: CheckpointListItem[], currentMessageCount: number) => {
			setCheckpointLoadData({checkpoints, currentMessageCount});
			setActiveMode('checkpointLoad');
		},
		[setCheckpointLoadData, setActiveMode],
	);

	// Enter session selector mode (for /resume with no args)
	const enterSessionSelectorMode = React.useCallback(
		(showAll?: boolean) => {
			setShowAllSessions(showAll ?? false);
			setActiveMode('sessionSelector');
		},
		[setShowAllSessions, setActiveMode],
	);

	// Load and apply a session's conversation. Provider and model are left to
	// whoever owns the client (resumeSession below, or init at startup): setting
	// the labels here without the client made replies from the old model get
	// labelled, saved and priced as the resumed one.
	const applySession = React.useCallback(
		(session: Session) => {
			updateMessages(session.messages);
			// The resumed history has not seen this process's reads.
			bumpReadContentGeneration();
			setCurrentSessionId(session.id);
			setKeyGeneratorSessionId(session.id);
			void loadTasks(session.id).then(tasks => {
				setLiveTaskList(tasks.length > 0 ? tasks : null);
			});
			// Replay the persisted conversation into scrollback so the user can see
			// what they resumed (prompts, assistant replies, tool activity) instead
			// of an empty screen with only a success line.
			for (const component of buildSessionHistoryComponents(
				session.messages,
				session.model,
			)) {
				addToChatQueue(component);
			}
			addToChatQueue(
				<SuccessMessage
					key={generateKey('resume-success')}
					message={`Resumed session: ${session.title}`}
					hideBox={true}
				/>,
			);
			setActiveMode(null);
		},
		[
			updateMessages,
			setCurrentSessionId,
			setActiveMode,
			addToChatQueue,
			setLiveTaskList,
		],
	);

	// In-app resume (/resume <id> and the session picker): apply the session,
	// then switch the client to its provider and model with the same
	// programmatic switch the mode toggle uses. The conversation goes first so
	// that, between the two steps, autosave pairs the resumed messages with the
	// client still live rather than the old messages with the new labels. If
	// the provider is no longer configured, handleModelSelect reports it and the
	// current client and labels stay.
	const resumeSession = React.useCallback(
		async (session: Session) => {
			applySession(session);
			await handleModelSelect(
				session.provider,
				session.model,
				true,
				session.messages,
			);
		},
		[applySession, handleModelSelect],
	);

	const handleSessionSelect = React.useCallback(
		async (sessionId: string) => {
			try {
				const session = await sessionManager.loadSession(sessionId);
				if (session) {
					await resumeSession(session);
				} else {
					addToChatQueue(
						<ErrorMessage
							key={generateKey('resume-error')}
							message="Session not found"
							hideBox={true}
						/>,
					);
					setActiveMode(null);
				}
			} catch (error) {
				addToChatQueue(
					<ErrorMessage
						key={generateKey('resume-error')}
						message={`Failed to load session: ${formatError(error)}`}
						hideBox={true}
					/>,
				);
				setActiveMode(null);
			}
		},
		[resumeSession, addToChatQueue, setActiveMode],
	);

	const handleSessionCancel = React.useCallback(() => {
		setActiveMode(null);
	}, [setActiveMode]);

	// Plan review action bar handlers
	const handlePlanProceed = React.useCallback(async () => {
		// Approving must always be able to proceed. A missing session id or an
		// unreadable plan artifact degrades to referring to the plan already in
		// the conversation rather than leaving the user stuck on the review bar
		// with "Yes" permanently broken.
		const approvedPlanMessage = currentSessionId
			? await createApprovedPlanMessage(currentSessionId)
			: await createApprovedPlanMessage('');
		// The effect in InteractiveApp waits for this mode change before it
		// submits the persisted plan, preventing a stale plan-mode turn.
		setPlanReviewState(null);
		setDevelopmentMode('normal');
		setPendingPlanProceed(approvedPlanMessage);
	}, [
		currentSessionId,
		setPlanReviewState,
		setDevelopmentMode,
		setPendingPlanProceed,
	]);

	const handlePlanAskMore = React.useCallback(async () => {
		// Hide the review bar and stay in plan mode; the model asks its questions
		// and the user answers before a new plan is produced.
		setIsConversationComplete(false);
		setPlanReviewState(null);
		await handleChatMessage(
			'please ask me any additional clarifying questions before proceeding',
		);
	}, [
		setPlanReviewState,
		handleChatMessage, // Hide the review bar and stay in plan mode; the model asks its questions
		// and the user answers before a new plan is produced.
		setIsConversationComplete,
	]);

	const handlePlanModify = React.useCallback(() => {
		// Return to input without changing mode so the user can request revisions.
		// Keep the queue blocked until that revision turn has completed.
		setIsConversationComplete(false);
		setPlanReviewState(null);
		addToChatQueue(
			<SuccessMessage
				key={generateKey('plan-revision-request')}
				message="Plan Mode remains active. Tell Nanocoder what to change."
				hideBox={true}
			/>,
		);
	}, [
		setPlanReviewState,
		addToChatQueue, // Return to input without changing mode so the user can request revisions.
		// Keep the queue blocked until that revision turn has completed.
		setIsConversationComplete,
	]);

	// Architect review action bar handlers

	/**
	 * Release the turn's checkpoint once the gate has resolved.
	 *
	 * Every exit from the bar runs this. Architect takes a checkpoint per turn,
	 * so leaving them behind fills `/checkpoint list` with machine-named entries
	 * and a full file-and-conversation snapshot each. Failure is not worth
	 * surfacing: the gate is already resolved and the user's files are in the
	 * state they asked for.
	 */
	const releaseArchitectCheckpoint = React.useCallback(
		async (checkpointName: string) => {
			try {
				await new CheckpointManager(getProjectRoot()).deleteCheckpoint(
					checkpointName,
				);
			} catch {
				// Intentionally ignored - see above.
			}
		},
		[],
	);

	/**
	 * Tell the model what the gate did to its work.
	 *
	 * Without this the conversation still says every write succeeded while the
	 * files have moved back underneath it, so the next `string_replace` matches
	 * `old_str` against a state that no longer exists. Appended as a user turn
	 * so it travels with the next request.
	 */
	const appendArchitectRevertNotice = React.useCallback(
		(filesChanged: string[]) => {
			const fileList =
				filesChanged.length > 0
					? ` The following files were restored to their previous contents: ${filesChanged.join(', ')}.`
					: '';

			updateMessages([
				...messages,
				{
					role: 'user',
					content: `[The changes from your previous turn were reverted and are no longer on disk.${fileList} Re-read any file before editing it - your earlier edits are gone.]`,
				},
			]);
		},
		[messages, updateMessages],
	);

	const handleArchitectKeep = React.useCallback(async () => {
		const reviewState = architectReviewState;

		setArchitectReviewState(null);

		if (!reviewState?.checkpointName) {
			return;
		}

		await releaseArchitectCheckpoint(reviewState.checkpointName);

		addToChatQueue(
			<SuccessMessage
				key={generateKey('architect-keep')}
				message={`✓ Kept ${reviewState.filesChanged.length + reviewState.filesMissing.length} changed file(s)`}
				hideBox={true}
			/>,
		);
	}, [
		architectReviewState,
		setArchitectReviewState,
		addToChatQueue,
		releaseArchitectCheckpoint,
	]);

	const handleArchitectRevert = React.useCallback(async () => {
		const reviewState = architectReviewState;

		if (!reviewState?.checkpointName) {
			return;
		}

		try {
			const manager = new CheckpointManager(getProjectRoot());

			const checkpointData = await manager.loadCheckpoint(
				reviewState.checkpointName,
				{
					validateIntegrity: true,
				},
			);

			await manager.restoreFiles(checkpointData);

			setArchitectReviewState(null);
			appendArchitectRevertNotice(reviewState.filesChanged);
			await releaseArchitectCheckpoint(reviewState.checkpointName);

			addToChatQueue(
				<SuccessMessage
					key={generateKey('architect-revert-success')}
					message={`✓ Architect changes reverted successfully`}
					hideBox={true}
				/>,
			);
		} catch (error) {
			addToChatQueue(
				<ErrorMessage
					key={generateKey('architect-revert-error')}
					message={`Failed to revert Architect changes: ${formatError(error)}`}
					hideBox={true}
				/>,
			);
		}
	}, [
		architectReviewState,
		setArchitectReviewState,
		addToChatQueue,
		appendArchitectRevertNotice,
		releaseArchitectCheckpoint,
	]);

	const handleArchitectRevertAndRevise = React.useCallback(
		async (instructions: string) => {
			const reviewState = architectReviewState;

			if (!reviewState?.checkpointName) {
				return;
			}

			try {
				const manager = new CheckpointManager(getProjectRoot());

				const checkpointData = await manager.loadCheckpoint(
					reviewState.checkpointName,
					{
						validateIntegrity: true,
					},
				);

				await manager.restoreFiles(checkpointData);

				// Mark the conversation incomplete before the review bar goes away.
				// Dismissing the bar leaves a render where nothing is generating and
				// the turn still reads complete, and the revise turn below starts
				// through handleChatMessage, which never resets the flag itself. A
				// queued prompt would otherwise drain into that gap.
				setIsConversationComplete(false);
				setArchitectReviewState(null);
				await releaseArchitectCheckpoint(reviewState.checkpointName);

				// Says reverted, not "review the changes you just made" - those
				// changes are gone, and the old wording pointed the model at a
				// disk state that no longer existed.
				await handleChatMessage(
					`Your previous changes were reverted and are no longer on disk. Re-read any file before editing it, then redo the work with these instructions:\n\n${instructions}`,
					instructions,
				);
			} catch (error) {
				addToChatQueue(
					<ErrorMessage
						key={generateKey('architect-revise-error')}
						message={`Failed to revert Architect changes: ${formatError(error)}`}
						hideBox={true}
					/>,
				);
			}
		},
		[
			architectReviewState,
			setArchitectReviewState,
			setIsConversationComplete,
			addToChatQueue,
			releaseArchitectCheckpoint,
			handleChatMessage,
		],
	);

	// Message submit handler
	const handleMessageSubmit = React.useCallback(
		async (
			message: string,
			displayValue?: string,
			images?: ImageAttachment[],
		) => {
			ensureCurrentSessionId();
			// Reset conversation completion flag when starting a new message
			setIsConversationComplete(false);

			// Extract command args for slash commands (used by /rename etc.).
			// The VS Code editor pill is appended at the end of the message
			// (\n\n[@…]<!--vscode-context-->…<!--/vscode-context-->); strip it
			// so it doesn't leak into the parsed args.
			// Trimmed to agree with parseInput, which is what actually routes the
			// message downstream — `  /rename foo` is a slash command there.
			const trimmedMessage = message.trim();
			const isSlashCommand = trimmedMessage.startsWith('/');
			const commandArgs = isSlashCommand
				? stripVSCodeContext(trimmedMessage)
						.slice(1)
						.trim()
						.split(/\s+/)
						.slice(1)
				: undefined;

			// user-prompt-submit hooks gate chat prompts only. A slash command and
			// a `!` bash passthrough are local UI actions: they never reach the
			// model, and prefixing either one breaks the routing that recognises it
			// (handleMessageSubmission dispatches on parseInput, which keys bash off
			// a leading `!`). Both must therefore leave the pending context buffer
			// undrained, so it reaches the next prompt that actually goes to the model.
			//
			// Both checks are trimmed because parseInput trims before testing for
			// either prefix — `  /help` and `  !ls` are still local actions there,
			// so an untrimmed check here would prefix them and reroute them to the
			// model.
			const isLocalAction = isSlashCommand || trimmedMessage.startsWith('!');
			let submittedMessage = message;
			if (!isLocalAction) {
				const gate = await runLifecycleHooks('user-prompt-submit', {
					prompt: message,
				});
				if (gate.blocked) {
					// Echo the prompt first, so the denial that follows has a visible
					// cause in the scrollback instead of appearing on its own.
					addToChatQueue(
						<UserMessage
							key={generateKey('user')}
							message={displayValue ?? message}
							tokenContent={message}
							imageCount={images?.length ?? 0}
						/>,
					);
					addToChatQueue(
						<ErrorMessage
							key={generateKey('hook-blocked-prompt')}
							message={gate.reason ?? 'Prompt blocked by a hook.'}
							hideBox={true}
						/>,
					);
					setIsConversationComplete(true);
					return;
				}

				// Fold in whatever session-start left buffered plus this hook's own
				// stdout. displayValue keeps the user's original text on screen.
				const injected = [await takePendingHookContext(), gate.output]
					.filter(Boolean)
					.join('\n\n');
				if (injected) {
					submittedMessage = `<hook-context>\n${injected}\n</hook-context>\n\n${message}`;
				}
			}

			await handleMessageSubmission(
				submittedMessage,
				{
					customCommandCache: customCommandCache,
					customCommandLoader: customCommandLoader,
					customCommandExecutor: customCommandExecutor,
					onClearMessages: clearMessages,
					onClearCounterIncrement: onClearCounterIncrement,
					onRenameSession: setSessionName,
					commandArgs,
					onEnterModelSelectionMode: enterModelSelectionMode,
					onEnterModelDatabaseMode: enterModelDatabaseMode,
					onEnterSettingsMode: enterSettingsMode,
					onEnterExplorerMode: enterExplorerMode,
					onEnterIdeSelectionMode: enterIdeSelectionMode,
					onEnterTune: enterTune,
					onEnterCheckpointLoadMode: enterCheckpointLoadMode,
					onEnterSessionSelectorMode: enterSessionSelectorMode,
					onResumeSession: resumeSession,
					onShowStatus: handleShowStatus,
					onHandleChatMessage: handleChatMessage,
					onSwitchModel: handleModelSelect,
					onAddToChatQueue: addToChatQueue,
					setLiveComponent: setLiveComponent,
					setLiveComponentCapturesInput: setLiveComponentCapturesInput,
					setIsToolExecuting: setIsToolExecuting,
					onCommandComplete: () => setIsConversationComplete(true),
					setMessages: updateMessages,
					messages: messages,
					provider: currentProvider,
					providerConfig: currentProviderConfig,
					client: client,
					model: currentModel,
					theme: currentTheme,
					updateInfo: updateInfo,
					getMessageTokens: getMessageTokens,
					tune: tune,
					developmentMode: developmentMode,
					lastApiUsage: lastApiUsage,
					apiCallHistory: apiCallHistory,
					sessionId: ensureCurrentSessionId(),
				},
				// Injected hook context must not reach the transcript — fall back to
				// the raw message so the user still sees what they typed.
				displayValue ?? message,
				images,
			);
		},
		[
			setIsConversationComplete,
			customCommandCache,
			customCommandLoader,
			customCommandExecutor,
			enterModelSelectionMode,
			enterModelDatabaseMode,
			enterSettingsMode,
			enterExplorerMode,
			enterIdeSelectionMode,
			enterTune,
			handleChatMessage,
			addToChatQueue,
			setLiveComponent,
			setIsToolExecuting,
			updateMessages,
			messages,
			currentProvider,
			currentProviderConfig,
			currentModel,
			currentTheme,
			updateInfo,
			getMessageTokens,
			tune,
			developmentMode,
			lastApiUsage,
			apiCallHistory,
			ensureCurrentSessionId,
			clearMessages,
			enterCheckpointLoadMode,
			handleShowStatus,
			resumeSession,
			enterSessionSelectorMode,
			onClearCounterIncrement,
			setLiveComponentCapturesInput,
			setSessionName,
			handleModelSelect,
			client,
		],
	);

	// Memoised so dependents (effects, callbacks, memo()'d children) see a new
	// object only when a handler changes, not on every render.
	return React.useMemo(
		() => ({
			clearMessages,
			handleCancel,
			handleToggleDevelopmentMode,
			handleShowStatus,
			handleCheckpointSelect,
			handleCheckpointCancel,
			enterCheckpointLoadMode,
			enterSessionSelectorMode,
			applySession,
			handleSessionSelect,
			handleSessionCancel,
			handleMessageSubmit,
			handlePlanProceed,
			handlePlanAskMore,
			handlePlanModify,
			handleArchitectKeep,
			handleArchitectRevert,
			handleArchitectRevertAndRevise,
		}),
		[
			clearMessages,
			handleCancel,
			handleToggleDevelopmentMode,
			handleShowStatus,
			handleCheckpointSelect,
			handleCheckpointCancel,
			enterCheckpointLoadMode,
			enterSessionSelectorMode,
			applySession,
			handleSessionSelect,
			handleSessionCancel,
			handleMessageSubmit,
			handlePlanProceed,
			handlePlanAskMore,
			handlePlanModify,
			handleArchitectKeep,
			handleArchitectRevert,
			handleArchitectRevertAndRevise,
		],
	);
}
