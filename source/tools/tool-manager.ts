import {getAppConfig} from '@/config/index';
import {getBraveSearchApiKey} from '@/config/nanocoder-tools-config';
import {buildToolEntry} from '@/custom-tools/build-tool';
import {CustomToolLoader} from '@/custom-tools/loader';
// Type-only import — the `MCPClient` runtime value is loaded dynamically
// inside `initializeMCP()` so sessions without MCP servers never pay the
// cost of the @modelcontextprotocol/sdk import graph.
import type {MCPClient} from '@/mcp/mcp-client';
import {allToolExports} from '@/tools/index';
import {getToolsForProfile} from '@/tools/tool-profiles';
import {ToolRegistry} from '@/tools/tool-registry';
import type {TuneConfig} from '@/types/config';
import type {CustomToolApprovalPolicy} from '@/types/custom-tools';
import type {
	AISDKCoreTool,
	DevelopmentMode,
	MCPInitResult,
	MCPServer,
	MCPTool,
	StreamingFormatter,
	ToolEntry,
	ToolFormatter,
	ToolHandler,
	ToolValidator,
} from '@/types/index';
import {getShutdownManager} from '@/utils/shutdown';

/**
 * Filter knob for tool access methods. Default behavior hides scoped
 * skill tools; pass `forSkill` to opt back in for tools owned by that
 * skill (typically by its own subagent).
 */
export interface ToolVisibilityOptions {
	forSkill?: string;
}

// Tools to exclude per development mode
const MODE_EXCLUDED_TOOLS: Record<DevelopmentMode, string[]> = {
	normal: [],
	'auto-accept': [],
	yolo: [],
	plan: [
		// No mutation tools — plan mode is read-only exploration
		'write_file',
		'string_replace',
		'delete_file',
		'move_file',
		'copy_file',
		'create_directory',
		'execute_bash',
		// No task tools — plan mode produces the plan itself
		'create_task',
		'update_task',
		'delete_task',
		'list_tasks',
		// No git mutation tools — keep read-only git tools
		'git_add',
		'git_commit',
		'git_push',
		'git_pull',
		'git_branch',
		'git_stash',
		'git_reset',
	],
	headless: ['ask_user', 'agent'],
};

/**
 * Manages built-in tools, MCP tools, and file-based custom tools.
 * Single authority for tool availability, filtering, and approval policy.
 */
export class ToolManager {
	private registry: ToolRegistry;
	private mcpClient: MCPClient | null = null;
	private customTools = new Map<
		string,
		{
			approval: CustomToolApprovalPolicy;
			readOnly: boolean;
			source: 'personal' | 'project';
			filePath: string;
			subscribe?: import('@/types/skills').SkillTrigger[];
		}
	>();

	constructor() {
		this.registry = ToolRegistry.fromToolExports(allToolExports);

		// Remove web_search if no Brave Search API key is configured
		if (!getBraveSearchApiKey()) {
			this.registry.unregister('web_search');
		}
	}

	/**
	 * Initialize MCP servers and register their tools
	 */
	async initializeMCP(
		servers: MCPServer[],
		onProgress?: (result: MCPInitResult) => void,
	): Promise<MCPInitResult[]> {
		if (servers && servers.length > 0) {
			// Dynamic import — only paid for by sessions with configured MCP servers.
			const {MCPClient} = await import('@/mcp/mcp-client');
			this.mcpClient = new MCPClient();

			getShutdownManager().register({
				name: 'mcp-client',
				priority: 20,
				handler: async () => {
					await this.disconnectMCP();
				},
			});

			const results = await this.mcpClient.connectToServers(
				servers,
				onProgress,
			);

			const mcpToolEntries = this.mcpClient.getToolEntries();
			this.registry.registerMany(mcpToolEntries);

			return results;
		}
		return [];
	}

	/**
	 * Load file-based custom tools from `.nanocoder/tools/` (project) and
	 * the personal tools directory. Project tools override personal ones.
	 * Custom tools whose name collides with a built-in or already-registered
	 * MCP tool are skipped with an error. Returns a per-tool load summary so
	 * callers can surface counts/errors at startup.
	 */
	initializeCustomTools(projectRoot?: string): {
		loaded: string[];
		errors: Array<{file: string; error: string}>;
	} {
		const loader = new CustomToolLoader(projectRoot ?? process.cwd());
		const {tools, errors} = loader.load();
		const loaded: string[] = [];
		const collisions: Array<{file: string; error: string}> = [];

		for (const t of tools) {
			if (this.registry.hasTool(t.metadata.name)) {
				collisions.push({
					file: t.filePath,
					error: `Tool name "${t.metadata.name}" collides with a built-in or MCP tool — skipping.`,
				});
				continue;
			}
			const entry = buildToolEntry(t, loader.getProjectRoot());
			this.registry.register(entry);
			this.customTools.set(t.metadata.name, {
				approval: t.metadata.approval,
				readOnly: t.metadata.readOnly,
				source: t.source,
				filePath: t.filePath,
				subscribe: t.subscribe,
			});
			loaded.push(t.metadata.name);
		}

		return {loaded, errors: [...errors, ...collisions]};
	}

	// =========================================================================
	// Tool availability — single source of truth
	// =========================================================================

	/**
	 * Get the list of tool names available given the current mode and tune config.
	 * This is the single authority used by both prompt building and runtime.
	 */
	getAvailableToolNames(
		tuneConfig?: TuneConfig,
		developmentMode?: DevelopmentMode,
		disabledTools?: string[],
	): string[] {
		let names = this.getToolNames();

		if (tuneConfig?.enabled && tuneConfig.toolProfile !== 'full') {
			const profileTools = getToolsForProfile(tuneConfig.toolProfile);
			if (profileTools.length > 0) {
				names = profileTools;
			}
		}

		// Apply mode-based exclusions
		if (developmentMode) {
			const excluded = MODE_EXCLUDED_TOOLS[developmentMode];
			if (excluded.length > 0) {
				const excludeSet = new Set(excluded);
				names = names.filter(n => !excludeSet.has(n));
			}

			// Custom tools follow the same posture as built-ins but with policy
			// applied per-tool from their approval/readOnly metadata.
			if (developmentMode === 'plan' || developmentMode === 'headless') {
				names = names.filter(n => {
					const meta = this.customTools.get(n);
					if (!meta) return true;
					if (developmentMode === 'headless') {
						return meta.approval === 'never';
					}
					// plan mode: only read-only tools with no approval are safe
					return meta.approval === 'never' && meta.readOnly;
				});
			}
		}

		// Apply user-configured disable list (intersects with profile + mode).
		// Defaults to global app config; callers may pass an override (mainly
		// for tests). This is global policy every caller should observe.
		const disabled = disabledTools ?? getAppConfig().disabledTools;
		if (disabled && disabled.length > 0) {
			const disabledSet = new Set(disabled);
			names = names.filter(n => !disabledSet.has(n));
		}

		return names;
	}

	/**
	 * Get the tools the model sees for a turn (schemas only, execute stripped).
	 *
	 * Approval is NOT encoded here: the SDK never auto-executes these tools, so
	 * approval is decided entirely by `resolveToolApproval` at the call sites
	 * (which apply the non-interactive alwaysAllow list and the current mode).
	 */
	getEffectiveTools(
		availableToolNames: string[],
	): Record<string, AISDKCoreTool> {
		return this.getFilteredToolsWithoutExecute(availableToolNames);
	}

	// =========================================================================
	// Tool access — delegates to ToolRegistry
	// =========================================================================

	getAllTools(opts?: ToolVisibilityOptions): Record<string, AISDKCoreTool> {
		return this.applyVisibility(this.registry.getNativeTools(), opts);
	}

	getAllToolsWithoutExecute(
		opts?: ToolVisibilityOptions,
	): Record<string, AISDKCoreTool> {
		return this.applyVisibility(
			this.registry.getNativeToolsWithoutExecute(),
			opts,
		);
	}

	getFilteredTools(
		allowedToolNames: string[],
		opts?: ToolVisibilityOptions,
	): Record<string, AISDKCoreTool> {
		const all = this.applyVisibility(this.registry.getNativeTools(), opts);
		return this.filterByNames(all, allowedToolNames);
	}

	getFilteredToolsWithoutExecute(
		allowedToolNames: string[],
		opts?: ToolVisibilityOptions,
	): Record<string, AISDKCoreTool> {
		const all = this.applyVisibility(
			this.registry.getNativeToolsWithoutExecute(),
			opts,
		);
		return this.filterByNames(all, allowedToolNames);
	}

	/**
	 * Drop scoped tools unless the caller opts in by passing the owning
	 * skill's name. Tools without `scoped` set (built-ins, MCP, custom
	 * tools, single-file skill tools) pass through untouched.
	 */
	private applyVisibility(
		tools: Record<string, AISDKCoreTool>,
		opts?: ToolVisibilityOptions,
	): Record<string, AISDKCoreTool> {
		const result: Record<string, AISDKCoreTool> = {};
		for (const [name, tool] of Object.entries(tools)) {
			const entry = this.registry.getEntry(name);
			if (entry?.scoped) {
				if (entry.ownerSkill && entry.ownerSkill === opts?.forSkill) {
					result[name] = tool;
				}
				continue;
			}
			result[name] = tool;
		}
		return result;
	}

	private filterByNames(
		tools: Record<string, AISDKCoreTool>,
		allowedNames: string[],
	): Record<string, AISDKCoreTool> {
		const nameSet = new Set(allowedNames);
		const filtered: Record<string, AISDKCoreTool> = {};
		for (const [name, tool] of Object.entries(tools)) {
			if (nameSet.has(name)) {
				filtered[name] = tool;
			}
		}
		return filtered;
	}

	getToolRegistry(): Record<string, ToolHandler> {
		return this.registry.getHandlers();
	}

	getToolHandler(toolName: string): ToolHandler | undefined {
		return this.registry.getHandler(toolName);
	}

	getToolFormatter(toolName: string): ToolFormatter | undefined {
		return this.registry.getFormatter(toolName);
	}

	getToolValidator(toolName: string): ToolValidator | undefined {
		return this.registry.getValidator(toolName);
	}

	getStreamingFormatter(toolName: string): StreamingFormatter | undefined {
		return this.registry.getStreamingFormatter(toolName);
	}

	isReadOnly(toolName: string): boolean {
		return this.registry.getEntry(toolName)?.readOnly === true;
	}

	hasTool(toolName: string): boolean {
		return this.registry.hasTool(toolName);
	}

	/**
	 * Register a skill-provided tool. Wraps the registry call so the
	 * registrar doesn't have to reach through `ToolManager` into
	 * `ToolRegistry`. The entry's `ownerSkill` tag is preserved.
	 */
	registerSkillTool(entry: ToolEntry): void {
		this.registry.register(entry);
	}

	/**
	 * Unregister a previously-registered skill-provided tool. Returns true
	 * if the tool was found and removed.
	 */
	unregisterSkillTool(toolName: string): boolean {
		if (!this.registry.hasTool(toolName)) return false;
		this.registry.unregister(toolName);
		return true;
	}

	/**
	 * Return the tool entry's `ownerSkill` tag, if any. Used by callers
	 * (e.g. `/tools`, scoped-visibility filters) to attribute a tool back
	 * to the skill that registered it.
	 */
	getOwnerSkill(toolName: string): string | undefined {
		return this.registry.getEntry(toolName)?.ownerSkill;
	}

	isCustomTool(toolName: string): boolean {
		return this.customTools.has(toolName);
	}

	getCustomToolInfo(toolName: string):
		| {
				approval: CustomToolApprovalPolicy;
				readOnly: boolean;
				source: 'personal' | 'project';
				filePath: string;
				subscribe?: import('@/types/skills').SkillTrigger[];
		  }
		| undefined {
		return this.customTools.get(toolName);
	}

	getCustomToolNames(): string[] {
		return Array.from(this.customTools.keys());
	}

	getMCPToolInfo(toolName: string): {isMCPTool: boolean; serverName?: string} {
		if (!this.mcpClient) {
			return {isMCPTool: false};
		}

		const toolMapping = this.mcpClient.getToolMapping();
		const mapping = toolMapping.get(toolName);

		if (mapping) {
			return {
				isMCPTool: true,
				serverName: mapping.serverName,
			};
		}

		return {isMCPTool: false};
	}

	async disconnectMCP(): Promise<void> {
		if (this.mcpClient) {
			const mcpTools = this.mcpClient.getNativeToolsRegistry();
			const mcpToolNames = Object.keys(mcpTools);

			this.registry.unregisterMany(mcpToolNames);
			await this.mcpClient.disconnect();

			// Reset registry to only static tools
			this.registry = ToolRegistry.fromToolExports(allToolExports);
			this.customTools.clear();
			this.mcpClient = null;
		}

		getShutdownManager().unregister('mcp-client');
	}

	getToolEntry(toolName: string): ToolEntry | undefined {
		return this.registry.getEntry(toolName);
	}

	getToolNames(): string[] {
		return this.registry.getToolNames();
	}

	getToolCount(): number {
		return this.registry.getToolCount();
	}

	getConnectedServers(): string[] {
		return this.mcpClient?.getConnectedServers() || [];
	}

	getServerTools(serverName: string): MCPTool[] {
		return this.mcpClient?.getServerTools(serverName) || [];
	}

	getServerInfo(serverName: string) {
		return this.mcpClient?.getServerInfo(serverName);
	}

	getMCPClient() {
		return this.mcpClient;
	}
}
