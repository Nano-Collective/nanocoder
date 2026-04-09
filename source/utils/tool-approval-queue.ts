/**
 * Global tool approval queue for subagent tool calls.
 *
 * When a subagent encounters a tool that needs user approval,
 * it calls signalToolApproval() which pauses execution until
 * the UI handler resolves the promise with the user's decision.
 *
 * Pattern mirrors question-queue.ts: a module-level singleton handler
 * set by App.tsx, called from the subagent executor.
 */

import type {ToolCall} from '@/types/core';

export interface PendingToolApproval {
	/** The tool call that needs approval */
	toolCall: ToolCall;
	/** Name of the subagent requesting approval */
	subagentName: string;
}

// The handler set by App.tsx. Returns a Promise<boolean> that resolves
// to true (approved) or false (denied) when the user responds.
let globalToolApprovalHandler:
	| ((approval: PendingToolApproval) => Promise<boolean>)
	| null = null;

/**
 * Called once from App.tsx to wire up the UI handler.
 */
export function setGlobalToolApprovalHandler(
	handler: (approval: PendingToolApproval) => Promise<boolean>,
): void {
	globalToolApprovalHandler = handler;
}

/**
 * Called from the subagent executor when a tool needs user approval.
 * Returns a Promise that resolves to true (approved) or false (denied).
 */
export async function signalToolApproval(
	approval: PendingToolApproval,
): Promise<boolean> {
	if (!globalToolApprovalHandler) {
		// No handler — default to denied (safe fallback)
		return false;
	}
	return globalToolApprovalHandler(approval);
}
