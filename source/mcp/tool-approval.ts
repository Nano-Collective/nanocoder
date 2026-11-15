import type {DevelopmentMode, MCPServer} from '@/types/index';

/** Whether the user's `alwaysAllow` list for this server covers the tool. */
export function isToolAutoApproved(
	serverConfig: MCPServer | undefined,
	toolName: string,
): boolean {
	if (!serverConfig?.alwaysAllow) {
		return false;
	}

	return serverConfig.alwaysAllow.includes(toolName);
}

/**
 * Approval policy for one MCP tool.
 *
 * MCP tools take the same mode posture as built-in tools:
 *   - headless runs unattended — it is daemon-driven, so there is
 *     no foreground prompt to answer (execute_bash runs there
 *     too); `"enabled": false` is the server-level opt-out;
 *   - auto-accept runs server-annotated readers and alwaysAllow-ed
 *     tools, and prompts for the rest. An MCP tool can be as
 *     capable as execute_bash (shell, database and deploy
 *     servers), and auto-accept still prompts for bash, so an
 *     arbitrary MCP tool must not skip what bash cannot. The
 *     readOnlyHint gets the same trust plan mode gives it;
 *   - plan inspects without side effects, so a server's
 *     alwaysAllow entry must not short-circuit it; only a
 *     server-annotated reader is safe to run there;
 *   - normal prompts unless alwaysAllow covers the tool.
 * readOnly deliberately does NOT skip approval in normal mode:
 * `readOnlyHint` is a hint supplied by the very server being
 * gated, so it must not be able to silence its own prompt.
 * alwaysAllow — set by the user, not the server — stays the only
 * way to skip a normal-mode prompt, exactly as
 * docs/configuration/mcp-configuration.md describes.
 * (Yolo is bypassed centrally by resolveToolApproval.)
 *
 * For the same reason the hint is not copied onto the tool entry as
 * `readOnly`: that field feeds ToolManager.isReadOnly, which
 * gates ACP checkpoint capture and parallel batching. It stays
 * on MCPClient.getToolMapping(), which only plan-mode filtering reads.
 */
export function createMCPToolApproval({
	readOnly,
	autoApproved,
}: {
	readOnly: boolean;
	autoApproved: boolean;
}): (args: unknown, mode: DevelopmentMode) => boolean {
	return (_args, mode) => {
		if (mode === 'headless') return false;
		if (mode === 'plan') return !readOnly;
		if (mode === 'auto-accept') return !(readOnly || autoApproved);
		return !autoApproved;
	};
}
