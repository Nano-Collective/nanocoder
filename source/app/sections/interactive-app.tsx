import {Box, useInput} from 'ink';
import React from 'react';
import {ChatHistory} from '@/app/components/chat-history';
import {ChatInput} from '@/app/components/chat-input';
import {ModalSelectors} from '@/app/components/modal-selectors';
import {FileExplorer} from '@/components/file-explorer';
import {IdeSelector} from '@/components/ide-selector';
import PlanReviewPrompt from '@/components/plan-review-prompt';
import type {useChatHandler} from '@/hooks/chat-handler';
import type {AppHandlers} from '@/hooks/useAppHandlers';
import type {useAppState} from '@/hooks/useAppState';
import type {useModeHandlers} from '@/hooks/useModeHandlers';
import type {useUserMessageQueue} from '@/hooks/useUserMessageQueue';
import type {useVSCodeServer} from '@/hooks/useVSCodeServer';
import type {ImageAttachment} from '@/types/core';
import type {RestoredInputDraft, SubmittedInputDraft} from '@/types/hooks';
import type {PendingToolApproval} from '@/utils/tool-approval-queue';
import type {PendingToolConfirmation} from '@/utils/tool-confirm-queue';
import {displayCompactCountsSummary} from '@/utils/tool-result-display';

interface InteractiveAppProps {
	appState: ReturnType<typeof useAppState>;
	chatHandler: ReturnType<typeof useChatHandler>;
	modeHandlers: ReturnType<typeof useModeHandlers>;
	appHandlers: AppHandlers;
	vscodeServer: ReturnType<typeof useVSCodeServer>;
	staticComponents: React.ReactNode[];
	liveComponent: React.ReactNode;
	pendingSubagentApproval: PendingToolApproval | null;
	handleSubagentToolApproval: (confirmed: boolean) => void;
	pendingToolConfirmation: PendingToolConfirmation | null;
	handleToolConfirmation: (confirmed: boolean) => void;
	handleQuestionAnswer: (answer: string) => void;
	handleUserSubmit: (
		message: string,
		displayValue: string,
		images?: ImageAttachment[],
	) => Promise<void>;
	userMessageQueue: ReturnType<typeof useUserMessageQueue>;
	handleIdeSelect: (ide: string) => void;
}

/**
 * The full interactive render tree: chat history + transient modals + chat
 * input. Lifted out of `App.tsx` so the orchestrator can stay focused on
 * hook composition rather than JSX wiring. Every interactive surface that
 * the user can see during a normal session lives here.
 */
export function InteractiveApp({
	appState,
	chatHandler,
	modeHandlers,
	appHandlers,
	vscodeServer,
	staticComponents,
	liveComponent,
	pendingSubagentApproval,
	handleSubagentToolApproval,
	pendingToolConfirmation,
	handleToolConfirmation,
	handleQuestionAnswer,
	handleUserSubmit,
	userMessageQueue,
	handleIdeSelect,
}: InteractiveAppProps): React.ReactElement {
	const nextRestoredDraftIdRef = React.useRef(1);
	const [submittedDraft, setSubmittedDraft] =
		React.useState<SubmittedInputDraft | null>(null);
	const [restoredDraft, setRestoredDraft] =
		React.useState<RestoredInputDraft | null>(null);

	// Gate: track whether we have already shown the bar for the current
	// completed turn, so Modify/Dismiss can't trigger an immediate re-show.
	const planReviewShownRef = React.useRef(false);

	const handleToggleCompactDisplay = () => {
		const expanding = appState.compactToolDisplay;
		appState.setCompactToolDisplay(!expanding);

		// When expanding, flush accumulated counts to static
		if (expanding) {
			const counts = appState.compactToolCountsRef.current;
			if (Object.keys(counts).length > 0) {
				displayCompactCountsSummary(counts, appState.addToChatQueue);
				appState.compactToolCountsRef.current = {};
				appState.setCompactToolCounts(null);
			}
		}
	};

	const handleToggleReasoningExpanded = () => {
		appState.setReasoningExpanded(!appState.reasoningExpanded);
	};

	const showModalSelectors =
		(appState.activeMode !== null &&
			appState.activeMode !== 'explorer' &&
			appState.activeMode !== 'ideSelection') ||
		appState.isSettingsMode;

	// Show the plan review bar when the current plan-mode turn has just completed.
	// planReviewShownRef gates the effect so it fires once per completed turn;
	// Modify/Dismiss only null planReviewState — without the gate the effect would
	// immediately re-fire and bring the bar straight back.
	React.useEffect(() => {
		if (
			appState.isConversationComplete &&
			appState.developmentMode === 'plan' &&
			!appState.planReviewState &&
			!planReviewShownRef.current
		) {
			planReviewShownRef.current = true;
			// Capture the last user message so Proceed can include it as context.
			// Ignore the synthetic "Ask More" message so we don't pollute the context.
			const lastUserMsg = [...appState.messages]
				.reverse()
				.find(
					m =>
						m.role === 'user' &&
						m.content !==
							'please ask me any additional clarifying questions before proceeding',
				);
			const originalMessage =
				typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
			appState.setPlanReviewState({show: true, originalMessage});
		}
	}, [
		appState.isConversationComplete,
		appState.developmentMode,
		appState.planReviewState,
		appState.messages,
		appState.setPlanReviewState,
		appState,
	]);

	// Reset the per-turn gate when the conversation starts a new turn so the
	// bar can appear again after the next plan completes.
	React.useEffect(() => {
		if (!appState.isConversationComplete) {
			planReviewShownRef.current = false;
		}
	}, [appState.isConversationComplete]);

	// Whether there is in-flight work that Escape should immediately cancel.
	// Decision states (tool confirmation, question prompt, subagent approval)
	// own their own Escape handling and must NOT be hijacked into a generation
	// abort, so they are excluded here.
	const cancellable =
		!appState.isToolConfirmationMode &&
		!appState.isQuestionMode &&
		pendingSubagentApproval === null &&
		pendingToolConfirmation === null &&
		(appState.isCancelling ||
			chatHandler.isGenerating ||
			appState.isToolExecuting ||
			appState.abortController !== null);

	const recallableSubmittedDraft =
		cancellable &&
		chatHandler.isGenerating &&
		chatHandler.streamingContent === '' &&
		!appState.isToolExecuting &&
		submittedDraft !== null;

	React.useEffect(() => {
		if (!submittedDraft) return;

		if (!cancellable || chatHandler.streamingContent !== '') {
			setSubmittedDraft(null);
		}
	}, [cancellable, chatHandler.streamingContent, submittedDraft]);

	const handleSubmittedDraft = React.useCallback(
		(draft: SubmittedInputDraft) => {
			setSubmittedDraft({
				inputState: {
					displayValue: draft.inputState.displayValue,
					placeholderContent: {...draft.inputState.placeholderContent},
				},
				attachments: [...draft.attachments],
			});
		},
		[],
	);

	const handleRecallSubmittedDraft = React.useCallback(() => {
		if (!submittedDraft) {
			appHandlers.handleCancel();
			return;
		}

		appHandlers.handleCancel();

		if (appState.messages[appState.messages.length - 1]?.role === 'user') {
			appState.updateMessages(appState.messages.slice(0, -1));

			if (appState.chatComponents.length > 0) {
				appState.setChatComponents(appState.chatComponents.slice(0, -1));
			}
		}

		appState.setIsCancelling(false);
		appState.setAbortController(null);
		setRestoredDraft({
			id: nextRestoredDraftIdRef.current++,
			inputState: {
				displayValue: submittedDraft.inputState.displayValue,
				placeholderContent: {...submittedDraft.inputState.placeholderContent},
			},
			attachments: [...submittedDraft.attachments],
		});
		setSubmittedDraft(null);
	}, [
		appHandlers,
		appState.messages,
		appState.updateMessages,
		appState.chatComponents,
		appState.setChatComponents,
		appState.setIsCancelling,
		appState.setAbortController,
		submittedDraft,
	]);

	// Single, always-mounted authority for Escape -> cancel. Because this lives
	// at the section level (never swapped out like the ChatInput children), it
	// fires on the FIRST press no matter what is running: an LLM message, a
	// regular tool behind ToolExecutionIndicator, a bash command, or a subagent.
	// `isActive` keeps it dormant when there's nothing to cancel, so idle Escape
	// still drives the clear-input behaviour in UserInput.
	useInput(
		(_input, key) => {
			if (key.escape) {
				if (recallableSubmittedDraft) {
					handleRecallSubmittedDraft();
					return;
				}

				appHandlers.handleCancel();
			}
		},
		{isActive: cancellable},
	);

	return (
		<Box flexDirection="column" padding={1} width="100%">
			{/* Chat History - ALWAYS rendered to keep Static content stable */}
			<ChatHistory
				startChat={appState.startChat}
				staticComponents={staticComponents}
				queuedComponents={appState.chatComponents}
				liveComponent={liveComponent}
				renderLastQueuedComponentLive={recallableSubmittedDraft}
			/>

			{appState.planReviewState?.show && (
				<PlanReviewPrompt
					onProceed={() =>
						void appHandlers.handlePlanProceed(
							appState.planReviewState?.originalMessage ?? '',
						)
					}
					onAskMore={() => void appHandlers.handlePlanAskMore()}
					onModify={appHandlers.handlePlanModify}
					onDismiss={appHandlers.handlePlanModify}
				/>
			)}

			{appState.isExplorerMode && (
				<Box marginLeft={-1} flexDirection="column">
					<FileExplorer onClose={modeHandlers.handleExplorerCancel} />
				</Box>
			)}

			{appState.isIdeSelectionMode && (
				<Box marginLeft={-1} flexDirection="column">
					<IdeSelector
						onSelect={handleIdeSelect}
						onCancel={modeHandlers.handleIdeSelectionCancel}
					/>
				</Box>
			)}

			{showModalSelectors && (
				<Box marginLeft={-1} flexDirection="column">
					<ModalSelectors
						activeMode={appState.activeMode}
						isSettingsMode={appState.isSettingsMode}
						showAllSessions={appState.showAllSessions}
						currentModel={appState.currentModel}
						currentProvider={appState.currentProvider}
						checkpointLoadData={appState.checkpointLoadData}
						onModelSelect={modeHandlers.handleModelSelect}
						onModelSelectionCancel={modeHandlers.handleModelSelectionCancel}
						onModelDatabaseCancel={modeHandlers.handleModelDatabaseCancel}
						onConfigWizardComplete={modeHandlers.handleConfigWizardComplete}
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
			)}

			{appState.startChat &&
				appState.activeMode === null &&
				!appState.isSettingsMode &&
				!appState.planReviewState?.show && (
					<ChatInput
						isCancelling={appState.isCancelling}
						isToolExecuting={appState.isToolExecuting}
						isQuestionMode={appState.isQuestionMode}
						pendingToolCalls={appState.pendingToolCalls}
						currentToolIndex={appState.currentToolIndex}
						pendingQuestion={appState.pendingQuestion}
						onQuestionAnswer={handleQuestionAnswer}
						mcpInitialized={appState.mcpInitialized}
						client={appState.client}
						customCommands={Array.from(appState.customCommandCache.keys())}
						inputDisabled={false}
						onSubmittedDraft={handleSubmittedDraft}
						restoreSubmittedDraft={restoredDraft}
						queuedMessages={userMessageQueue.queuedMessages}
						onQueueMessage={userMessageQueue.enqueueMessage}
						onRemoveQueuedMessage={userMessageQueue.removeMessage}
						isBusy={cancellable}
						developmentMode={appState.developmentMode}
						contextPercentUsed={appState.contextPercentUsed}
						contextSource={appState.contextSource}
						sessionName={appState.sessionName || undefined}
						compactToolCounts={appState.compactToolCounts}
						compactToolDisplay={appState.compactToolDisplay}
						liveTaskList={appState.liveTaskList}
						onToggleCompactDisplay={handleToggleCompactDisplay}
						pendingSubagentApproval={pendingSubagentApproval}
						onSubagentToolApproval={handleSubagentToolApproval}
						pendingToolConfirmation={pendingToolConfirmation}
						onToolConfirmation={handleToolConfirmation}
						onSubmit={handleUserSubmit}
						activeEditor={vscodeServer.activeEditor}
						onDismissActiveEditor={vscodeServer.dismissActiveEditor}
						onToggleMode={appHandlers.handleToggleDevelopmentMode}
						onToggleReasoningExpanded={handleToggleReasoningExpanded}
						tune={appState.tune}
						currentModel={appState.currentModel}
					/>
				)}
		</Box>
	);
}
