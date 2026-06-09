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
import {createGlobalHandlerSlot} from '@/utils/global-handler-slot';

export interface PendingToolApproval {
	/** The tool call that needs approval */
	toolCall: ToolCall;
	/** Name of the subagent requesting approval */
	subagentName: string;
}

// No handler — default to denied (safe fallback).
const approvalSlot = createGlobalHandlerSlot<PendingToolApproval, boolean>(
	() => false,
);

/** Called once from App.tsx to wire up the UI handler. */
export const setGlobalToolApprovalHandler = approvalSlot.set;

/**
 * Called from the subagent executor when a tool needs user approval.
 * Returns a Promise that resolves to true (approved) or false (denied).
 */
export const signalToolApproval = approvalSlot.signal;
