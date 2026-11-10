import {evaluatePermissionRules} from '@/tools/command-permissions';
import type {PermissionsConfig} from '@/types/config';
import type {DevelopmentMode, ToolApprovalPolicy} from '@/types/core';
import {parseToolArguments} from '@/utils/tool-args-parser';

/**
 * Context for an approval decision. `mode` is always explicit so no code path
 * has to consult a mutable global to learn the current development mode.
 */
export interface ApprovalContext {
	mode: DevelopmentMode;
	/**
	 * Tool names the caller has pre-authorized (the top-level
	 * `nanocoder.alwaysAllow` list). Membership short-circuits to "no approval".
	 */
	alwaysAllow?: readonly string[];
	/**
	 * Command-level `nanocoder.permissions` rules. Deny wins over allow, over
	 * `alwaysAllow`, and over every development mode; allow skips the prompt
	 * only when it covers every simple command in the call.
	 */
	permissions?: PermissionsConfig;
}

/** The slice of a tool entry the resolver needs to make its decision. */
export interface ApprovalTarget {
	approval?: ToolApprovalPolicy;
	readOnly?: boolean;
}

/**
 * What the permission resolver decided for one call.
 *
 * `allow` runs it unattended, `ask` shows the approval prompt, and `deny`
 * refuses the call outright. Callers that can only handle a prompt treat
 * `deny` as `ask`; the interactive, plain, ACP and subagent loops all check
 * for `deny` explicitly so a deny rule cannot be approved by hand.
 */
export interface ToolPermissionResult {
	decision: 'allow' | 'ask' | 'deny';
	/** Present only for `deny`; safe to show to the user and the model. */
	reason?: string;
}

/**
 * Single authority for "does this tool call need user approval?" and for
 * command-level allow/deny rules.
 *
 * Every execution path - the interactive conversation loop, subagents, ACP,
 * and the plain shell - routes its approval decision through here, so the
 * policy lives in exactly one place and the development mode is always
 * supplied explicitly (never read from a mutable global).
 *
 * Resolution order (first match wins; DO NOT reorder):
 *
 *   | # | Condition                          | Result            |
 *   |---|------------------------------------|-------------------|
 *   | 1 | a `permissions.deny` rule matches  | deny              |
 *   | 2 | a `permissions.allow` rule matches | no approval       |
 *   | 3 | toolName in ctx.alwaysAllow        | no approval       |
 *   | 4 | ctx.mode === 'yolo'                | no approval       |
 *   | 5 | approval is boolean                | that boolean      |
 *   | 6 | approval is (args, mode) => bool   | call it           |
 *   | 7 | otherwise (no explicit policy)     | !readOnly         |
 *
 *   - #1 runs before the yolo bypass on purpose: a deny rule is a hard "never"
 *     and still applies in yolo and headless runs. #2 is evaluated before
 *     `alwaysAllow` so a per-command allow is not shadowed by a tool-level
 *     entry, and both are evaluated before the mode so they act as overrides.
 *   - #4 is the global "yolo runs everything" invariant - kept here once
 *     rather than re-implemented in each tool's policy (see CLAUDE.md).
 *   - #7 means read-only tools default to no approval; anything else (or an
 *     unknown tool) defaults to requiring it.
 *
 * Fails safe: an unknown tool, or a policy function that throws, requires
 * approval.
 */
export async function resolveToolPermission(
	toolName: string,
	target: ApprovalTarget | undefined,
	rawArguments: unknown,
	ctx: ApprovalContext,
): Promise<ToolPermissionResult> {
	const command = commandForPermissionRules(toolName, rawArguments);
	const ruleDecision = evaluatePermissionRules(
		toolName,
		command,
		ctx.permissions,
	);

	if (ruleDecision.deniedReason !== undefined) {
		return {decision: 'deny', reason: ruleDecision.deniedReason};
	}
	if (ruleDecision.allowed) {
		return {decision: 'allow'};
	}

	// Caller pre-authorization (the alwaysAllow list) wins next.
	if (ctx.alwaysAllow?.includes(toolName)) {
		return {decision: 'allow'};
	}

	// Yolo executes every tool without exception (unless a deny rule above
	// said otherwise).
	if (ctx.mode === 'yolo') {
		return {decision: 'allow'};
	}

	const approval = target?.approval;

	if (typeof approval === 'boolean') {
		return {decision: approval ? 'ask' : 'allow'};
	}

	if (typeof approval === 'function') {
		try {
			const parsedArgs = parseToolArguments(rawArguments);
			return {
				decision: (await approval(parsedArgs, ctx.mode)) ? 'ask' : 'allow',
			};
		} catch {
			// Fail safe: if we can't decide, require approval.
			return {decision: 'ask'};
		}
	}

	// No explicit policy: read-only tools are safe to run unattended.
	return {decision: target?.readOnly ? 'allow' : 'ask'};
}

/**
 * Boolean view of the same decision. A denied call is reported as needing
 * approval so callers that have no way to surface a refusal still do not run
 * it. Paths that can refuse should call `resolveToolPermission` instead.
 */
export async function resolveToolApproval(
	toolName: string,
	target: ApprovalTarget | undefined,
	rawArguments: unknown,
	ctx: ApprovalContext,
): Promise<boolean> {
	const result = await resolveToolPermission(
		toolName,
		target,
		rawArguments,
		ctx,
	);
	return result.decision !== 'allow';
}

/** Extract the shell command a `tool(pattern)` rule applies to. */
function commandForPermissionRules(
	toolName: string,
	rawArguments: unknown,
): string | undefined {
	if (toolName !== 'execute_bash') return undefined;
	const parsed = parseToolArguments<Record<string, unknown>>(rawArguments);
	if (!parsed || typeof parsed !== 'object') return undefined;
	return typeof parsed.command === 'string' ? parsed.command : undefined;
}
