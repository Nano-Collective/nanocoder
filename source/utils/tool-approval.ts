import {isNanocoderToolAlwaysAllowed} from '@/config/nanocoder-tools-config';
import type {DevelopmentMode} from '@/types/core';

/**
 * Every tool whose approval runs through `createFileToolApproval`, which is
 * the same thing as every tool that mutates files.
 *
 * Architect mode reads this to decide what to checkpoint. Keeping one set for
 * both questions is the point: architect waives approval for this exact group,
 * so anything added to it is auto-executed, and a hand-maintained capture list
 * would silently leave new members unrevertable. `lsp_format_document` and
 * every custom file tool joined the group this way.
 */
const fileMutationToolNames = new Set<string>();

/**
 * Whether `toolName` mutates files, by virtue of having been registered
 * through `createFileToolApproval`.
 *
 * Only true once the tool's module has been imported. Built-ins are pulled in
 * by the tool manager and custom tools register as they are built, both of
 * which happen before a conversation turn can call them.
 */
export function isFileMutationTool(toolName: string): boolean {
	return fileMutationToolNames.has(toolName);
}

interface FileToolApprovalOptions<Args> {
	/**
	 * Whether a call destroys something that cannot be reviewed or undone, such
	 * as a delete or an overwrite of an existing file. Auto-accept waives
	 * approval for file edits, but these calls still prompt there, the same as
	 * `execute_bash` (an `rm` through bash already asks). Headless has no one to
	 * ask, and architect checkpoints every file mutation before it runs, so
	 * neither is affected.
	 */
	isIrreversible?: (args: Args) => boolean;
}

/**
 * Creates an approval policy for file-mutation tools.
 * Returns false (no approval) if the tool is always-allowed or the current
 * mode is auto-accept/headless/architect; otherwise requires approval. In
 * auto-accept, a call `isIrreversible` flags still requires approval.
 * `alwaysAllow` deliberately wins over `isIrreversible`: pre-authorizing a
 * tool covers all of its calls. resolveToolApproval checks the list before it
 * reaches this policy, and the check here covers callers that skip it. (Yolo
 * is bypassed centrally by resolveToolApproval.)
 *
 * Mode is supplied by the caller (the central approval resolver), never read
 * from a global.
 */
export function createFileToolApproval<Args = unknown>(
	toolName: string,
	{isIrreversible}: FileToolApprovalOptions<Args> = {},
): (args: Args, mode: DevelopmentMode) => boolean {
	fileMutationToolNames.add(toolName);

	return (args, mode) => {
		if (isNanocoderToolAlwaysAllowed(toolName)) return false;
		if (mode === 'auto-accept') return isIrreversible?.(args) ?? false;
		return mode !== 'headless' && mode !== 'architect';
	};
}
