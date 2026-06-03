import {Box} from 'ink';
import React from 'react';
import {ChatHistory} from '@/app/components/chat-history';
import {ChatInput} from '@/app/components/chat-input';
import {ModalSelectors} from '@/app/components/modal-selectors';
import {FileExplorer} from '@/components/file-explorer';
import {IdeSelector} from '@/components/ide-selector';
import type {useChatHandler} from '@/hooks/chat-handler';
import type {AppHandlers} from '@/hooks/useAppHandlers';
import type {useAppState} from '@/hooks/useAppState';
import type {useModeHandlers} from '@/hooks/useModeHandlers';
import type {useToolHandler} from '@/hooks/useToolHandler';
import type {useVSCodeServer} from '@/hooks/useVSCodeServer';
import type {PendingToolApproval} from '@/utils/tool-approval-queue';
import {displayCompactCountsSummary} from '@/utils/tool-result-display';

interface InteractiveAppProps {
	appState: ReturnType<typeof useAppState>;
	chatHandler: ReturnType<typeof useChatHandler>;
	toolHandler: ReturnType<typeof useToolHandler>;
	modeHandlers: ReturnType<typeof useModeHandlers>;
	appHandlers: AppHandlers;
	vscodeServer: ReturnType<typeof useVSCodeServer>;
	staticComponents: React.ReactNode[];
	liveComponent: React.ReactNode;
	pendingSubagentApproval: PendingToolApproval | null;
	handleSubagentToolApproval: (confirmed: boolean) => void;
	handleQuestionAnswer: (answer: string) => void;
	handleUserSubmit: (message: string) => Promise<void>;
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
	toolHandler,
	modeHandlers,
	appHandlers,
	vscodeServer,
	staticComponents,
	liveComponent,
	pendingSubagentApproval,
	handleSubagentToolApproval,
	handleQuestionAnswer,
	handleUserSubmit,
	handleIdeSelect,
}: InteractiveAppProps): React.ReactElement {
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

	return (
		<Box flexDirection="column" padding={1} width="100%">
			{/* Chat History - ALWAYS rendered to keep Static content stable */}
			<ChatHistory
				startChat={appState.startChat}
				staticComponents={staticComponents}
				queuedComponents={appState.chatComponents}
				liveComponent={liveComponent}
			/>

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
				!appState.isSettingsMode && (
					<ChatInput
						isCancelling={appState.isCancelling}
						isToolExecuting={appState.isToolExecuting}
						isToolConfirmationMode={appState.isToolConfirmationMode}
						isQuestionMode={appState.isQuestionMode}
						pendingToolCalls={appState.pendingToolCalls}
						currentToolIndex={appState.currentToolIndex}
						pendingQuestion={appState.pendingQuestion}
						onQuestionAnswer={handleQuestionAnswer}
						mcpInitialized={appState.mcpInitialized}
						client={appState.client}
						customCommands={Array.from(appState.customCommandCache.keys())}
						inputDisabled={chatHandler.isGenerating || appState.isToolExecuting}
						developmentMode={appState.developmentMode}
						contextPercentUsed={appState.contextPercentUsed}
						sessionName={appState.sessionName || undefined}
						compactToolCounts={appState.compactToolCounts}
						compactToolDisplay={appState.compactToolDisplay}
						liveTaskList={appState.liveTaskList}
						onToggleCompactDisplay={handleToggleCompactDisplay}
						pendingSubagentApproval={pendingSubagentApproval}
						onSubagentToolApproval={handleSubagentToolApproval}
						onToolConfirm={toolHandler.handleToolConfirmation}
						onToolCancel={toolHandler.handleToolConfirmationCancel}
						onSubmit={handleUserSubmit}
						activeEditor={vscodeServer.activeEditor}
						onDismissActiveEditor={vscodeServer.dismissActiveEditor}
						onCancel={appHandlers.handleCancel}
						onToggleMode={appHandlers.handleToggleDevelopmentMode}
						onToggleReasoningExpanded={handleToggleReasoningExpanded}
						tune={appState.tune}
						currentModel={appState.currentModel}
					/>
				)}
		</Box>
	);
}
