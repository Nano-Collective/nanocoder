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

import type {DevelopmentMode, LLMClient, ToolCall} from '@/types/core';
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

/**
 * How one ACP session surfaces its subagents' tool calls to its client. The
 * slot above has a single owner, so two sessions mid-turn would answer each
 * other's prompts; a bridge is looked up by session id instead.
 */
export interface SubagentToolBridge {
	/** The session's mode right now, so approvals match the top-level loop. */
	getMode(): DevelopmentMode;
	/** Tools the session does not offer or run, which its subagents must not either. */
	getDisabledTools?(): readonly string[];
	/**
	 * The client the session's turn runs on. A subagent inherits its provider and
	 * model from this one, not from the executor's startup client, so a model the
	 * session picked reaches its subagents.
	 */
	getClient?(): LLMClient | undefined;
	/** Announce a call before it is approved or run. */
	begin(toolCall: ToolCall, subagentName: string): Promise<void>;
	/** Ask the client to approve a call, naming the subagent run that made it. */
	approve(
		toolCall: ToolCall,
		abortSignal?: AbortSignal,
		subagentRunId?: string,
	): Promise<'approved' | 'denied' | 'cancelled'>;
	/** Settle the announced call with what actually happened. */
	end(
		toolCall: ToolCall,
		outcome: {content: string; failed: boolean},
	): Promise<void>;
}

const subagentToolBridges = new Map<string, SubagentToolBridge>();

/**
 * Route a session's subagent tool calls through `bridge`. Returns a disposer
 * that removes it, unless the session has registered a newer one since.
 */
export function registerSubagentToolBridge(
	sessionId: string,
	bridge: SubagentToolBridge,
): () => void {
	subagentToolBridges.set(sessionId, bridge);
	return () => {
		if (subagentToolBridges.get(sessionId) === bridge) {
			subagentToolBridges.delete(sessionId);
		}
	};
}

/** The bridge for a session, if its client takes subagent tool calls. */
export function getSubagentToolBridge(
	sessionId: string | undefined,
): SubagentToolBridge | undefined {
	return sessionId ? subagentToolBridges.get(sessionId) : undefined;
}
