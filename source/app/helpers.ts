import {TOOL_APPROVAL_REQUIRED_PREFIX} from '@/constants';
import type {
	NonInteractiveCompletionResult,
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
		return {shouldExit: true, reason: 'tool-approval'};
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
