/**
 * Props for the main App component
 */
export interface AppProps {
	vscodeMode?: boolean;
	vscodePort?: number;
	nonInteractivePrompt?: string;
	nonInteractiveMode?: boolean;
	cliProvider?: string;
	cliModel?: string;
}

/**
 * Reasons for non-interactive mode completion
 */
export type NonInteractiveExitReason =
	| 'complete'
	| 'timeout'
	| 'error'
	| 'tool-approval'
	| null;

/**
 * Result of checking non-interactive mode completion status
 */
export interface NonInteractiveCompletionResult {
	shouldExit: boolean;
	reason: NonInteractiveExitReason;
}

/**
 * State required for checking non-interactive mode completion
 */
export interface NonInteractiveModeState {
	isToolExecuting: boolean;
	isToolConfirmationMode: boolean;
	isConversationComplete: boolean;
	messages: Array<{role: string; content: string}>;
}
