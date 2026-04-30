import type {DevelopmentMode} from '@/types/core';

/**
 * Valid user-selectable boot modes. Single source of truth — used by the
 * `--mode` CLI parser, the `defaultMode` config loader, and tests.
 */
export const VALID_MODES = ['normal', 'auto-accept', 'yolo', 'plan'] as const;

/**
 * A user-selectable boot mode for the `--mode` CLI flag. Subset of
 * DevelopmentMode (internal-only `scheduler` is excluded). The Extract
 * keeps this in sync with DevelopmentMode — adding a mode there that
 * isn't listed in VALID_MODES will fail to type-check.
 */
export type CliMode = Extract<DevelopmentMode, (typeof VALID_MODES)[number]>;

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
	/**
	 * Skip the first-run directory trust prompt for this run only. Honored
	 * only when `nonInteractiveMode` is true; ignored otherwise. The trust
	 * is ephemeral — preferences are not modified.
	 */
	trustDirectory?: boolean;
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
