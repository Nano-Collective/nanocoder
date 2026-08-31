import {isAutoDiagnosticsMessage} from '@/hooks/chat-handler/conversation/auto-diagnostics';
import type {Message, ToolCall} from '@/types/core';
import {isApprovedPlanMessage} from './approved-plan';

const INTERNAL_WALKTHROUGH_PREFIX = '<nanocoder-internal-walkthrough>';

export interface WalkthroughLifecycle {
	required: boolean;
	written: boolean;
	fallbackAttempted: boolean;
}

/**
 * Decide whether the turn about to run owes a walkthrough.
 *
 * "Did this turn start from an approved plan?" is the question, so we look for
 * the most recent message the *user* actually sent. The conversation loop
 * injects several `role: 'user'` messages of its own mid-turn — the post-edit
 * diagnostics prompt, the walkthrough nudge itself — and those must not be
 * mistaken for the user changing the subject, or approving a plan and then
 * editing files would silently drop the requirement.
 *
 * Callers should build this once per user turn and thread it through the
 * loop's recursions rather than rebuilding it from the message tail.
 */
export function createWalkthroughLifecycle(
	messages: Message[],
): WalkthroughLifecycle {
	let latestUserMessage: Message | undefined;
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (
			message?.role === 'user' &&
			!isInternalWalkthroughMessage(message) &&
			!isAutoDiagnosticsMessage(message)
		) {
			latestUserMessage = message;
			break;
		}
	}
	return {
		required: latestUserMessage
			? isApprovedPlanMessage(latestUserMessage)
			: false,
		written: false,
		fallbackAttempted: false,
	};
}

export function observeSuccessfulLifecycleTool(
	lifecycle: WalkthroughLifecycle,
	toolCall: ToolCall,
): void {
	if (toolCall.function.name === 'write_walkthrough') {
		lifecycle.written = true;
	}
}

export function takeWalkthroughFallback(
	lifecycle: WalkthroughLifecycle,
	toolAvailable: boolean,
): Message | null {
	if (
		!toolAvailable ||
		!lifecycle.required ||
		lifecycle.written ||
		lifecycle.fallbackAttempted
	) {
		return null;
	}

	lifecycle.fallbackAttempted = true;
	return {
		role: 'user',
		content:
			`${INTERNAL_WALKTHROUGH_PREFIX}\n` +
			'Before ending this complex implementation, call write_walkthrough with the files actually changed, tests actually run, and verification steps. ' +
			'After saving it, reply with only a concise confirmation and do not repeat your previous answer.\n' +
			'</nanocoder-internal-walkthrough>',
	};
}

export function isInternalWalkthroughMessage(message: Message): boolean {
	return (
		message.role === 'user' &&
		message.content.startsWith(INTERNAL_WALKTHROUGH_PREFIX)
	);
}
