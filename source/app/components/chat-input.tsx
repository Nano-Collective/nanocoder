import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import React from 'react';
import CancellingIndicator from '@/components/cancelling-indicator';
import QuestionPrompt from '@/components/question-prompt';
import {TaskListDisplay} from '@/components/task-list-display';
import ToolConfirmation from '@/components/tool-confirmation';
import ToolExecutionIndicator from '@/components/tool-execution-indicator';
import UserInput from '@/components/user-input';
import {useTheme} from '@/hooks/useTheme';
import type {Task} from '@/tools/tasks/types';
import type {
	ContextSource,
	DevelopmentMode,
	ImageAttachment,
	ToolCall,
	TuneConfig,
} from '@/types';
import type {PendingQuestion} from '@/utils/question-queue';
import type {PendingToolApproval} from '@/utils/tool-approval-queue';
import type {PendingToolConfirmation} from '@/utils/tool-confirm-queue';
import {LiveCompactCounts} from '@/utils/tool-result-display';
import type {ActiveEditorState} from '@/vscode/vscode-server';

export interface ChatInputProps {
	// Execution state
	isCancelling: boolean;
	isToolExecuting: boolean;
	isQuestionMode: boolean;

	// Tool state
	pendingToolCalls: ToolCall[];
	currentToolIndex: number;

	// Question state (ask_question tool)
	pendingQuestion: PendingQuestion | null;
	onQuestionAnswer: (answer: string) => void;

	// Subagent tool approval
	pendingSubagentApproval: PendingToolApproval | null;
	onSubagentToolApproval: (confirmed: boolean) => void;

	// Main agent tool confirmation (the unified inline approval gate)
	pendingToolConfirmation: PendingToolConfirmation | null;
	onToolConfirmation: (confirmed: boolean) => void;

	// Client state
	mcpInitialized: boolean;
	client: unknown | null;

	// Input state
	customCommands: string[];
	inputDisabled: boolean;
	// True when in-flight work makes Escape a cancel; lets UserInput defer to
	// the section-level global cancel handler instead of clearing the input.
	isBusy: boolean;
	developmentMode: DevelopmentMode;
	contextPercentUsed: number | null;
	contextSource: ContextSource | null;
	sessionName?: string;

	// Tool display
	compactToolCounts?: Record<string, number> | null;
	onToggleCompactDisplay?: () => void;
	compactToolDisplay?: boolean;
	liveTaskList?: Task[] | null;

	// Handlers
	onSubmit: (
		message: string,
		displayValue: string,
		images?: ImageAttachment[],
	) => Promise<void>;
	onToggleMode: () => void;
	onToggleReasoningExpanded: () => void;
	tune?: TuneConfig;
	currentModel?: string;

	// VS Code active editor pushed from the extension (filename + optional selection)
	activeEditor?: ActiveEditorState | null;
	onDismissActiveEditor?: () => void;
}

/**
 * Interactive chat input. Renders user input, tool confirmation prompts,
 * question prompts, and in-flight indicators.
 *
 * Non-interactive (`run`) mode does not route through this component —
 * see NonInteractiveShell.
 *
 * Unlike ChatHistory, this component CAN be conditionally mounted/unmounted.
 * It does not contain ink's Static component, so it's safe to hide when
 * modal dialogs are shown.
 */
export function ChatInput({
	isCancelling,
	isToolExecuting,
	isQuestionMode,
	pendingToolCalls,
	currentToolIndex,
	pendingQuestion,
	onQuestionAnswer,
	pendingSubagentApproval,
	onSubagentToolApproval,
	pendingToolConfirmation,
	onToolConfirmation,
	mcpInitialized,
	client,
	customCommands,
	inputDisabled,
	isBusy,
	developmentMode,
	contextPercentUsed,
	contextSource,
	sessionName,
	compactToolCounts,
	onToggleCompactDisplay,
	compactToolDisplay,
	liveTaskList,
	onSubmit,
	onToggleMode,
	onToggleReasoningExpanded,
	tune,
	currentModel,
	activeEditor,
	onDismissActiveEditor,
}: ChatInputProps): React.ReactElement {
	const {colors} = useTheme();

	return (
		<Box flexDirection="column" marginLeft={-1}>
			{/* Live compact tool counts - running tally during auto-execution */}
			{compactToolCounts && Object.keys(compactToolCounts).length > 0 && (
				<LiveCompactCounts counts={compactToolCounts} />
			)}

			{/* Live task list - updates in-place below tool counts, above spinner */}
			{liveTaskList && liveTaskList.length > 0 && (
				<TaskListDisplay tasks={liveTaskList} title="Tasks" />
			)}

			{isCancelling && <CancellingIndicator />}

			{/* Subagent Tool Approval — takes priority since subagent is blocked */}
			{pendingSubagentApproval ? (
				<ToolConfirmation
					toolCall={pendingSubagentApproval.toolCall}
					onConfirm={onSubagentToolApproval}
					onCancel={() => onSubagentToolApproval(false)}
				/>
			) : /* Main agent tool confirmation (unified inline approval gate) */
			pendingToolConfirmation ? (
				<ToolConfirmation
					toolCall={pendingToolConfirmation.toolCall}
					onConfirm={onToolConfirmation}
					onCancel={() => onToolConfirmation(false)}
				/>
			) : /* Tool Execution - skip indicator for streaming tools (they show their own progress) */
			isToolExecuting &&
				pendingToolCalls[currentToolIndex] &&
				pendingToolCalls[currentToolIndex].function.name !== 'execute_bash' &&
				pendingToolCalls[currentToolIndex].function.name !== 'agent' ? (
				<ToolExecutionIndicator
					toolName={pendingToolCalls[currentToolIndex].function.name}
					currentIndex={currentToolIndex}
					totalTools={pendingToolCalls.length}
				/>
			) : /* Question Prompt (ask_question tool) */
			isQuestionMode && pendingQuestion ? (
				<QuestionPrompt
					question={pendingQuestion}
					onAnswer={onQuestionAnswer}
				/>
			) : /* User Input */
			mcpInitialized && client ? (
				<UserInput
					customCommands={customCommands}
					onSubmit={(msg, display, images) =>
						void onSubmit(msg, display, images)
					}
					disabled={inputDisabled}
					isBusy={isBusy}
					onToggleMode={onToggleMode}
					onToggleReasoningExpanded={onToggleReasoningExpanded}
					onToggleCompactDisplay={onToggleCompactDisplay}
					compactToolDisplay={compactToolDisplay}
					developmentMode={developmentMode}
					contextPercentUsed={contextPercentUsed}
					contextSource={contextSource}
					sessionName={sessionName}
					tune={tune}
					currentModel={currentModel}
					activeEditor={activeEditor}
					onDismissActiveEditor={onDismissActiveEditor}
				/>
			) : /* Client Missing */
			mcpInitialized && !client ? (
				<></>
			) : (
				/* Loading */
				<Text color={colors.secondary}>
					<Spinner type="dots" /> Loading...
				</Text>
			)}
		</Box>
	);
}
