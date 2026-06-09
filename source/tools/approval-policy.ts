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
 * Resolution order (first match wins; DO NOT reorder):
 *
 *   | # | Condition                          | Result            |
 *   |---|------------------------------------|-------------------|
 *   | 1 | toolName in ctx.alwaysAllow        | no approval       |
 *   | 2 | ctx.mode === 'yolo'                | no approval       |
 *   | 3 | approval is boolean                | that boolean      |
 *   | 4 | approval is (args, mode) => bool   | call it           |
 *   | 5 | otherwise (no explicit policy)     | !readOnly         |
 *
 *   - #2 is the global "yolo runs everything" invariant - kept here once
 *     rather than re-implemented in each tool's policy (see CLAUDE.md).
 *   - #5 means read-only tools default to no approval; anything else (or an
 *     unknown tool) defaults to requiring it.
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
