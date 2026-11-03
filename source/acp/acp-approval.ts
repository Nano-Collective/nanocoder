import {resolveToolApproval} from '@/tools/approval-policy';
import type {ToolManager} from '@/tools/tool-manager';
import type {DevelopmentMode} from '@/types/core';

/**
 * The offered tools an allow-list lets skip the permission prompt: the
 * top-level `alwaysAllow`, or the `alwaysAllow` of the MCP server that owns the
 * tool, which the tool's own approval policy already applies in `normal` mode.
 */
export async function getAlwaysAllowedTools(
	toolManager: Pick<
		ToolManager,
		'getAvailableToolNames' | 'getMCPToolInfo' | 'getToolEntry'
	>,
	mode: DevelopmentMode,
	alwaysAllow: readonly string[],
	/** Tools the session does not offer; the user's own list included, as it replaces the default. */
	disabledTools?: readonly string[],
): Promise<string[]> {
	const allowed: string[] = [];
	for (const name of toolManager.getAvailableToolNames(
		undefined,
		mode,
		disabledTools,
	)) {
		if (
			alwaysAllow.includes(name) ||
			(!(await resolveToolApproval(
				name,
				toolManager.getToolEntry(name),
				undefined,
				{mode: 'normal'},
			)) &&
				toolManager.getMCPToolInfo(name).isMCPTool)
		) {
			allowed.push(name);
		}
	}
	return allowed;
}
