import type {DevelopmentMode, ToolApprovalPolicy} from '@/types/core';
import {parseToolArguments} from '@/utils/tool-args-parser';

/**
 * Context for an approval decision. `mode` is always explicit so no code path
 * has to consult a mutable global to learn the current development mode.
 */
export interface ApprovalContext {
	mode: DevelopmentMode;
	/**
	 * Tool names the caller has pre-authorized (e.g. the non-interactive
	 * `alwaysAllow` list). Membership short-circuits to "no approval".
	 */
	alwaysAllow?: readonly string[];
}

/** The slice of a tool entry the resolver needs to make its decision. */
export interface ApprovalTarget {
	approval?: ToolApprovalPolicy;
	readOnly?: boolean;
}

/**
 * Single authority for "does this tool call need user approval?".
 *
 * Every execution path - the interactive conversation loop, subagents, and the
 * plain shell - routes its approval decision through here, so the policy lives
 * in exactly one place and the development mode is always supplied explicitly
 * (never read from a mutable global).
 *
 * Resolution order:
 *   1. Caller pre-authorization (`alwaysAllow`) -> no approval.
 *   2. Yolo mode -> no approval. Yolo executes every tool without exception
 *      (see CLAUDE.md), so this global invariant lives here once rather than
 *      being re-implemented in each tool's policy.
 *   3. The tool's explicit `approval` policy (boolean or `(args, mode)` fn).
 *   4. Default: `!readOnly` - read-only tools have no side effects so they
 *      never need approval; anything else (or an unknown tool) does.
 *
 * Fails safe: an unknown tool, or a policy function that throws, requires
 * approval.
 */
export async function resolveToolApproval(
	toolName: string,
	target: ApprovalTarget | undefined,
	rawArguments: unknown,
	ctx: ApprovalContext,
): Promise<boolean> {
	// Caller pre-authorization (non-interactive alwaysAllow) wins first.
	if (ctx.alwaysAllow?.includes(toolName)) {
		return false;
	}

	// Yolo executes every tool without exception.
	if (ctx.mode === 'yolo') {
		return false;
	}

	const approval = target?.approval;

	if (typeof approval === 'boolean') {
		return approval;
	}

	if (typeof approval === 'function') {
		try {
			const parsedArgs = parseToolArguments(rawArguments);
			return await approval(parsedArgs, ctx.mode);
		} catch {
			// Fail safe: if we can't decide, require approval.
			return true;
		}
	}

	// No explicit policy: read-only tools are safe to run unattended.
	return !target?.readOnly;
}
