import type {DevelopmentMode} from '@/types/core';

/**
 * A user-selectable boot mode for the `--mode` CLI flag. Subset of
 * DevelopmentMode (internal-only `scheduler` is excluded).
 */
export type CliMode = Extract<
	DevelopmentMode,
	'normal' | 'auto-accept' | 'yolo' | 'plan'
>;

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
	/**
	 * Development mode requested via `--mode`. When set, overrides the
	 * default initial mode for both interactive and non-interactive runs.
	 */
	cliMode?: CliMode;
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
