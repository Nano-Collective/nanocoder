import {parseToolArguments} from '@/tools/runtime/tool-args-parser';
import type {
	DevelopmentMode,
	ExternalToolSource,
	ToolApprovalPolicy,
} from '@/types/core';

/**
 * Whether external content is in the model's view this run, and whether the
 * user opted into escalating for it (`nanocoder.untrustedContent.escalate`).
 *
 * The caller supplies both: the presence comes from the request view, the
 * switch from config. Keeping them in the context rather than reading a global
 * is what lets the policy stay a pure function of its inputs.
 */
export interface ExternalContentApproval {
	inContext: boolean;
	escalate: boolean;
}

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
	/** Set when the model has read text from outside the workspace. */
	externalContent?: ExternalContentApproval;
}

/** The slice of a tool entry the resolver needs to make its decision. */
export interface ApprovalTarget {
	approval?: ToolApprovalPolicy;
	readOnly?: boolean;
	/** Set on tools whose output comes from outside the workspace. */
	externalSource?: ExternalToolSource;
}

/**
 * The modes where escalating changes an answer: the two that otherwise waive
 * file edits. `normal` already asks, `plan` runs nothing, `headless` has nobody
 * to ask, and `yolo` means "never ask" - the resolver has already returned by
 * the time this is reached.
 */
const ESCALATION_MODES: ReadonlySet<DevelopmentMode> = new Set<DevelopmentMode>(
	['auto-accept', 'architect'],
);

/**
 * Whether a call can act on the world rather than just read the workspace.
 *
 * A read-only tool is excluded - reading is what the model is supposed to do
 * with the page it was asked to summarise. Two exceptions matter: a read-only
 * tool whose output comes from outside is also the tool that reaches outside
 * (`fetch_url` is exactly this), and an MCP tool's `readOnly` is the server's
 * own claim about itself.
 */
function actsOutsideWorkspace(target: ApprovalTarget | undefined): boolean {
	if (target?.readOnly !== true) return true;
	return target.externalSource !== undefined;
}

/**
 * Whether reading external content is what is making this call need approval.
 *
 * Exported because the confirmation prompt has to name the reason, and it must
 * only do so when this rule is the one that fired - recomputing the condition
 * separately would let the prompt and the decision drift apart.
 */
export function escalatedByExternalContent(
	target: ApprovalTarget | undefined,
	mode: DevelopmentMode,
	ctx: ApprovalContext,
): boolean {
	const external = ctx.externalContent;
	if (!external?.inContext || !external.escalate) return false;
	if (!ESCALATION_MODES.has(mode)) return false;
	return actsOutsideWorkspace(target);
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
 *   | 1 | ctx.mode === 'yolo'                | no approval       |
 *   | 2 | external content is in context     | approval          |
 *   | 3 | toolName in ctx.alwaysAllow        | no approval       |
 *   | 4 | approval is boolean                | that boolean      |
 *   | 5 | approval is (args, mode) => bool   | call it           |
 *   | 6 | otherwise (no explicit policy)     | !readOnly         |
 *
 *   - #1 is the global "yolo runs everything" invariant - kept first so the
 *     mode means what it says: nothing below it can raise a prompt in yolo.
 *   - #2 covers only auto-accept and architect, and only tools that act outside
 *     the workspace (see `escalatedByExternalContent`). It sits *above* the
 *     pre-authorization list on purpose: `alwaysAllow` was granted before any
 *     attacker-controlled text existed, and it is exactly what an injected
 *     instruction reaches for. This is the same stance `mcp/tool-approval.ts`
 *     takes about a server-supplied `readOnlyHint`. The global switch is the
 *     escape hatch; there is deliberately no per-tool one.
 *   - #3 lets a caller pre-authorize a tool for the calls #2 does not escalate.
 *   - #6 means read-only tools default to no approval; anything else (or an
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
	// Yolo executes every tool without exception.
	if (ctx.mode === 'yolo') {
		return false;
	}

	// External content is in the model's view: a call that can act on the world
	// waits for the user even where the mode would have waived it.
	if (escalatedByExternalContent(target, ctx.mode, ctx)) {
		return true;
	}

	// Caller pre-authorization (the alwaysAllow list) wins next.
	if (ctx.alwaysAllow?.includes(toolName)) {
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
