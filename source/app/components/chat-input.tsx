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
import type {DevelopmentMode, ToolCall, TuneConfig} from '@/types';
import type {PendingQuestion} from '@/utils/question-queue';
import type {PendingToolApproval} from '@/utils/tool-approval-queue';
import {LiveCompactCounts} from '@/utils/tool-result-display';

export interface ChatInputProps {
	// Execution state
	isCancelling: boolean;
	isToolExecuting: boolean;
	isToolConfirmationMode: boolean;
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

	// Client state
	mcpInitialized: boolean;
	client: unknown | null;

	// Non-interactive mode
	nonInteractivePrompt?: string;
	nonInteractiveLoadingMessage: string | null;

	// Input state
	customCommands: string[];
	inputDisabled: boolean;
	developmentMode: DevelopmentMode;
	contextPercentUsed: number | null;

	// Tool display
	compactToolCounts?: Record<string, number> | null;
	onToggleCompactDisplay?: () => void;
	compactToolDisplay?: boolean;
	liveTaskList?: Task[] | null;

	// Handlers
	onToolConfirm: (confirmed: boolean) => void;
	onToolCancel: () => void;
	onSubmit: (message: string) => Promise<void>;
	onCancel: () => void;
	onToggleMode: () => void;
	tune?: TuneConfig;
}

/**
 * Chat input component that handles user input and tool interactions.
 *
 * Unlike ChatHistory, this component CAN be conditionally mounted/unmounted.
 * It does not contain ink's Static component, so it's safe to hide when
 * modal dialogs are shown.
 */
export function ChatInput({
	isCancelling,
	isToolExecuting,
	isToolConfirmationMode,
	isQuestionMode,
	pendingToolCalls,
	currentToolIndex,
	pendingQuestion,
	onQuestionAnswer,
	pendingSubagentApproval,
	onSubagentToolApproval,
	mcpInitialized,
	client,
	nonInteractivePrompt,
	nonInteractiveLoadingMessage,
	customCommands,
	inputDisabled,
	developmentMode,
	contextPercentUsed,
	compactToolCounts,
	onToggleCompactDisplay,
	compactToolDisplay,
	liveTaskList,
	onToolConfirm,
	onToolCancel,
	onSubmit,
	onCancel,
	onToggleMode,
	tune,
}: ChatInputProps): React.ReactElement {
	const {colors} = useTheme();

	const loadingLabel = nonInteractivePrompt
		? (nonInteractiveLoadingMessage ?? 'Loading...')
		: 'Loading...';

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
			) : /* Tool Confirmation */
			isToolConfirmationMode && pendingToolCalls[currentToolIndex] ? (
				<ToolConfirmation
					toolCall={pendingToolCalls[currentToolIndex]}
					onConfirm={onToolConfirm}
					onCancel={onToolCancel}
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
			mcpInitialized && client && !nonInteractivePrompt ? (
				<UserInput
					customCommands={customCommands}
					onSubmit={msg => void onSubmit(msg)}
					disabled={inputDisabled}
					onCancel={onCancel}
					onToggleMode={onToggleMode}
					onToggleCompactDisplay={onToggleCompactDisplay}
					compactToolDisplay={compactToolDisplay}
					developmentMode={developmentMode}
					contextPercentUsed={contextPercentUsed}
					tune={tune}
				/>
			) : /* Client Missing */
			mcpInitialized && !client ? (
				<></>
			) : /* Non-Interactive Complete */
			nonInteractivePrompt && !nonInteractiveLoadingMessage ? (
				<Text color={colors.secondary}>Completed. Exiting.</Text>
			) : (
				/* Loading */
				<Text color={colors.secondary}>
					<Spinner type="dots" /> {loadingLabel}
				</Text>
			)}
		</Box>
	);
}
