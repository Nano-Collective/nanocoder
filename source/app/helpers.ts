import {
	TOOL_APPROVAL_REQUIRED_KIND,
	TOOL_APPROVAL_REQUIRED_PREFIX,
} from '@/constants';
import type {
	NonInteractiveCompletionResult,
	NonInteractiveExitReason,
	NonInteractiveModeState,
} from './types';

/**
 * Helper function to determine if non-interactive mode processing is complete
 */
export function isNonInteractiveModeComplete(
	appState: NonInteractiveModeState,
	startTime: number,
	maxExecutionTimeMs: number,
): NonInteractiveCompletionResult {
	const isComplete =
		!appState.isToolExecuting && !appState.isToolConfirmationMode;
	const hasTimedOut = Date.now() - startTime > maxExecutionTimeMs;

	// Check for error messages in the messages array (only check role, not content)
	const hasErrorMessages = appState.messages.some(
		(message: {role: string; content: string}) => message.role === 'error',
	);

	// Check for tool approval required messages. The notice is display-only
	// chrome, so match the shared prefix its producer uses rather than a loose
	// literal that a reword would silently invalidate.
	const hasToolApprovalRequired = appState.messages.some(
		(message: {role: string; content: string}) =>
			typeof message.content === 'string' &&
			message.content.includes(TOOL_APPROVAL_REQUIRED_PREFIX),
	);

	if (hasTimedOut) {
		return {shouldExit: true, reason: 'timeout'};
	}

	if (hasToolApprovalRequired) {
		return {shouldExit: true, reason: TOOL_APPROVAL_REQUIRED_KIND};
	}

	if (hasErrorMessages) {
		return {shouldExit: true, reason: 'error'};
	}

	// Exit when conversation is complete and either:
	// - We have messages in history (for chat/bash commands), OR
	// - Conversation is marked complete (for display-only commands like /mcp)
	if (isComplete && appState.isConversationComplete) {
		return {shouldExit: true, reason: 'complete'};
	}

	return {shouldExit: false, reason: null};
}

/**
 * Maps a non-interactive exit reason to the corresponding process exit code.
 * Used by the Ink runtime (`useNonInteractiveMode`) for the interactive
 * non-interactive path. The headless plain shell (`runPlainShell`) has its
 * own intentionally distinct mapping (exit 2 for tool-approval-required).
 */
export function getExitCodeForReason(reason: NonInteractiveExitReason): number {
	return reason === 'error' || reason === TOOL_APPROVAL_REQUIRED_KIND ? 1 : 0;
}
