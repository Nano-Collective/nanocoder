import {getBraveSearchApiKey} from '@/config/nanocoder-tools-config';
// Type-only import — the `MCPClient` runtime value is loaded dynamically
// inside `initializeMCP()` so sessions without MCP servers never pay the
// cost of the @modelcontextprotocol/sdk import graph.
import type {MCPClient} from '@/mcp/mcp-client';
import {allToolExports} from '@/tools/index';
import {getToolsForProfile} from '@/tools/tool-profiles';
import {ToolRegistry} from '@/tools/tool-registry';
import type {TuneConfig} from '@/types/config';
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
	scheduler: ['ask_user', 'agent'],
};

/**
 * Manages both static tools and dynamic MCP tools.
 * Single authority for tool availability, filtering, and approval policy.
 */
export class ToolManager {
	private registry: ToolRegistry;
	private mcpClient: MCPClient | null = null;

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
		}

		return names;
	}

	/**
	 * Get effective tools with non-interactive approval overrides applied.
	 * Resolves all approval policy in one place so chat-handler doesn't mutate tools.
	 */
	getEffectiveTools(
		availableToolNames: string[],
		options?: {
			nonInteractiveAlwaysAllow?: string[];
		},
	): Record<string, AISDKCoreTool> {
		const tools = this.getFilteredToolsWithoutExecute(availableToolNames);

		if (
			options?.nonInteractiveAlwaysAllow &&
			options.nonInteractiveAlwaysAllow.length > 0
		) {
			const allowSet = new Set(options.nonInteractiveAlwaysAllow);
			return Object.fromEntries(
				Object.entries(tools).map(([name, toolDef]) => {
					if (allowSet.has(name)) {
						return [name, {...toolDef, needsApproval: false} as AISDKCoreTool];
					}
					return [name, toolDef];
				}),
			);
		}

		return tools;
	}

	// =========================================================================
	// Tool access — delegates to ToolRegistry
	// =========================================================================

	getAllTools(): Record<string, AISDKCoreTool> {
		return this.registry.getNativeTools();
	}

	getAllToolsWithoutExecute(): Record<string, AISDKCoreTool> {
		return this.registry.getNativeToolsWithoutExecute();
	}

	getFilteredTools(allowedToolNames: string[]): Record<string, AISDKCoreTool> {
		const all = this.registry.getNativeTools();
		return this.filterByNames(all, allowedToolNames);
	}

	getFilteredToolsWithoutExecute(
		allowedToolNames: string[],
	): Record<string, AISDKCoreTool> {
		const all = this.registry.getNativeToolsWithoutExecute();
		return this.filterByNames(all, allowedToolNames);
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
