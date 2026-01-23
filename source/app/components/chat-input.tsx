import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import React from 'react';
import CancellingIndicator from '@/components/cancelling-indicator';
import ToolConfirmation from '@/components/tool-confirmation';
import ToolExecutionIndicator from '@/components/tool-execution-indicator';
import UserInput from '@/components/user-input';
import {useTheme} from '@/hooks/useTheme';
import type {DevelopmentMode, PlanModeState, ToolCall} from '@/types';

export interface ChatInputProps {
	// Execution state
	isCancelling: boolean;
	isToolExecuting: boolean;
	isToolConfirmationMode: boolean;

	// Tool state
	pendingToolCalls: ToolCall[];
	currentToolIndex: number;

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
	planModeState: PlanModeState;

	// Handlers
	onToolConfirm: (confirmed: boolean) => void;
	onToolCancel: () => void;
	onSubmit: (message: string) => Promise<void>;
	onCancel: () => void;
	onToggleMode: () => void;
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
	pendingToolCalls,
	currentToolIndex,
	mcpInitialized,
	client,
	nonInteractivePrompt,
	nonInteractiveLoadingMessage,
	customCommands,
	inputDisabled,
	developmentMode,
	planModeState,
	onToolConfirm,
	onToolCancel,
	onSubmit,
	onCancel,
	onToggleMode,
}: ChatInputProps): React.ReactElement {
	const {colors} = useTheme();

	const loadingLabel = nonInteractivePrompt
		? (nonInteractiveLoadingMessage ?? 'Loading...')
		: 'Loading...';

	return (
		<Box flexDirection="column" marginLeft={-1}>
			{isCancelling && <CancellingIndicator />}

			{/* Tool Confirmation */}
			{isToolConfirmationMode && pendingToolCalls[currentToolIndex] ? (
				<ToolConfirmation
					toolCall={pendingToolCalls[currentToolIndex]}
					onConfirm={onToolConfirm}
					onCancel={onToolCancel}
				/>
			) : /* Tool Execution - skip indicator for streaming tools (they show their own progress) */
			isToolExecuting &&
				pendingToolCalls[currentToolIndex] &&
				pendingToolCalls[currentToolIndex].function.name !== 'execute_bash' ? (
				<ToolExecutionIndicator
					toolName={pendingToolCalls[currentToolIndex].function.name}
					currentIndex={currentToolIndex}
					totalTools={pendingToolCalls.length}
				/>
			) : /* User Input */
			mcpInitialized && client && !nonInteractivePrompt ? (
				<UserInput
					customCommands={customCommands}
					onSubmit={msg => void onSubmit(msg)}
					disabled={inputDisabled}
					onCancel={onCancel}
					onToggleMode={onToggleMode}
					developmentMode={developmentMode}
					planModeState={planModeState}
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
