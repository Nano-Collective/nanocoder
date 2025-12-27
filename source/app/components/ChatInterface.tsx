import BashExecutionIndicator from '@/components/bash-execution-indicator';
import CancellingIndicator from '@/components/cancelling-indicator';
import ChatQueue from '@/components/chat-queue';
import ToolConfirmation from '@/components/tool-confirmation';
import ToolExecutionIndicator from '@/components/tool-execution-indicator';
import UserInput from '@/components/user-input';
import {useTheme} from '@/hooks/useTheme';
import type {DevelopmentMode, ToolCall} from '@/types';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import React from 'react';

export interface ChatInterfaceProps {
	// Chat state
	startChat: boolean;
	staticComponents: React.ReactNode[];
	queuedComponents: React.ReactNode[];

	// Execution state
	isCancelling: boolean;
	isToolExecuting: boolean;
	isToolConfirmationMode: boolean;
	isBashExecuting: boolean;
	currentBashCommand: string;

	// Tool state
	pendingToolCalls: ToolCall[];
	currentToolIndex: number;

	// Client state
	mcpInitialized: boolean;
	client: unknown | null; // LLMClient type, but kept as unknown to avoid import

	// Non-interactive mode
	nonInteractivePrompt?: string;
	nonInteractiveLoadingMessage: string | null;

	// Input state
	customCommands: string[];
	inputDisabled: boolean;
	developmentMode: DevelopmentMode;
	hideInput?: boolean;

	// Handlers
	onToolConfirm: (confirmed: boolean) => void;
	onToolCancel: () => void;
	onSubmit: (message: string) => Promise<void>;
	onCancel: () => void;
	onToggleMode: () => void;
}

/**
 * Main chat interface component that renders the chat queue and input area
 */
export function ChatInterface({
	startChat,
	staticComponents,
	queuedComponents,
	isCancelling,
	isToolExecuting,
	isToolConfirmationMode,
	isBashExecuting,
	currentBashCommand,
	pendingToolCalls,
	currentToolIndex,
	mcpInitialized,
	client,
	nonInteractivePrompt,
	nonInteractiveLoadingMessage,
	customCommands,
	inputDisabled,
	developmentMode,
	hideInput,
	onToolConfirm,
	onToolCancel,
	onSubmit,
	onCancel,
	onToggleMode,
}: ChatInterfaceProps): React.ReactElement {
	const {colors} = useTheme();

	const loadingLabel = nonInteractivePrompt
		? (nonInteractiveLoadingMessage ?? 'Loading...')
		: 'Loading...';

	return (
		<>
			{/* Chat Queue */}
			<Box flexGrow={1} flexDirection="column" minHeight={0}>
				{startChat && (
					<ChatQueue
						staticComponents={staticComponents}
						queuedComponents={queuedComponents}
					/>
				)}
			</Box>

			{/* Input Area - hidden when in modal mode to prevent re-renders */}
			{startChat && !hideInput && (
				<Box flexDirection="column" marginLeft={-1}>
					{isCancelling && <CancellingIndicator />}

					{/* Tool Confirmation */}
					{isToolConfirmationMode && pendingToolCalls[currentToolIndex] ? (
						<ToolConfirmation
							toolCall={pendingToolCalls[currentToolIndex]}
							onConfirm={onToolConfirm}
							onCancel={onToolCancel}
						/>
					) : /* Tool Execution */
					isToolExecuting && pendingToolCalls[currentToolIndex] ? (
						<ToolExecutionIndicator
							toolName={pendingToolCalls[currentToolIndex].function.name}
							currentIndex={currentToolIndex}
							totalTools={pendingToolCalls.length}
						/>
					) : /* Bash Execution */
					isBashExecuting ? (
						<BashExecutionIndicator command={currentBashCommand} />
					) : /* User Input */
					mcpInitialized && client && !nonInteractivePrompt ? (
						<UserInput
							customCommands={customCommands}
							onSubmit={msg => void onSubmit(msg)}
							disabled={inputDisabled}
							onCancel={onCancel}
							onToggleMode={onToggleMode}
							developmentMode={developmentMode}
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
			)}
		</>
	);
}
