/**
 * Global confirmation queue for the MAIN agent's tool calls.
 *
 * When the conversation loop reaches a tool that needs user approval, it calls
 * signalToolConfirm() which suspends until the UI resolves the promise with the
 * user's decision (true = approved, false = declined). This lets the single
 * tool-execution routine gate each call inline instead of handing off to a
 * separate confirmation state machine.
 *
 * Mirrors tool-approval-queue.ts (subagent approvals) and question-queue.ts —
 * a module-level singleton handler set by the UI, called from the loop. A
 * separate slot from the subagent queue: a subagent's tool can need approval
 * while the parent agent is mid-turn, so the two must not collide.
 */

import type {ToolCall} from '@/types/core';
import {createGlobalHandlerSlot} from '@/utils/global-handler-slot';

export interface PendingToolConfirmation {
	/** The tool call awaiting the user's approve/decline decision. */
	toolCall: ToolCall;
}

// No handler registered (e.g. non-interactive contexts) → default to declined.
const confirmSlot = createGlobalHandlerSlot<PendingToolConfirmation, boolean>(
	() => false,
);

/** Called once from the UI to wire up the confirmation handler. */
export const setGlobalToolConfirmHandler = confirmSlot.set;

/**
 * Called from the conversation loop when a tool needs approval.
 * Returns a Promise that resolves to true (approved) or false (declined).
 */
export const signalToolConfirm = confirmSlot.signal;
