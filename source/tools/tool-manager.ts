import {MCPClient} from '@/mcp/mcp-client';
import {
	nativeToolsRegistry as staticNativeToolsRegistry,
	toolFormatters as staticToolFormatters,
	toolRegistry as staticToolRegistry,
	toolStreamingFormatters as staticToolStreamingFormatters,
	toolValidators as staticToolValidators,
} from '@/tools/index';
import {ToolRegistry} from '@/tools/tool-registry';
import {
	getCurrentMode,
	getPlanId,
	getPlanModeState,
} from '@/context/mode-context';
import type {
	AISDKCoreTool,
	MCPInitResult,
	MCPServer,
	MCPTool,
	StreamingFormatter,
	ToolEntry,
	ToolFormatter,
	ToolHandler,
	ToolValidator,
} from '@/types/index';

/**
 * Manages both static tools and dynamic MCP tools
 * All tools are stored in unified ToolEntry format via ToolRegistry
 */
export class ToolManager {
	/**
	 * Unified tool registry using ToolRegistry helper class
	 */
	private registry: ToolRegistry;

	/**
	 * MCP client for dynamic tool discovery and execution
	 */
	private mcpClient: MCPClient | null = null;

	constructor() {
		// Initialize with static tools using ToolRegistry factory method
		this.registry = ToolRegistry.fromRegistries(
			staticToolRegistry,
			staticNativeToolsRegistry,
			staticToolFormatters,
			staticToolValidators,
			staticToolStreamingFormatters,
		);
	}

	/**
	 * Initialize MCP servers and register their tools
	 */
	async initializeMCP(
		servers: MCPServer[],
		onProgress?: (result: MCPInitResult) => void,
	): Promise<MCPInitResult[]> {
		if (servers && servers.length > 0) {
			this.mcpClient = new MCPClient();

			const results = await this.mcpClient.connectToServers(
				servers,
				onProgress,
			);

			// Register MCP tools using ToolRegistry
			// getToolEntries() returns structured ToolEntry objects
			const mcpToolEntries = this.mcpClient.getToolEntries();
			this.registry.registerMany(mcpToolEntries);

			return results;
		}
		return [];
	}

	/**
	 * Get all available native AI SDK tools (static + MCP)
	 */
	getAllTools(): Record<string, AISDKCoreTool> {
		return this.registry.getNativeTools();
	}

	/**
	 * Get all tool handlers
	 */
	getToolRegistry(): Record<string, ToolHandler> {
		return this.registry.getHandlers();
	}

	/**
	 * Get a specific tool handler
	 */
	getToolHandler(toolName: string): ToolHandler | undefined {
		return this.registry.getHandler(toolName);
	}

	/**
	 * Get a specific tool formatter
	 */
	getToolFormatter(toolName: string): ToolFormatter | undefined {
		return this.registry.getFormatter(toolName);
	}

	/**
	 * Get a specific tool validator
	 */
	getToolValidator(toolName: string): ToolValidator | undefined {
		return this.registry.getValidator(toolName);
	}

	/**
	 * Get a specific streaming formatter
	 */
	getStreamingFormatter(toolName: string): StreamingFormatter | undefined {
		return this.registry.getStreamingFormatter(toolName);
	}

	/**
	 * Check if a tool exists
	 */
	hasTool(toolName: string): boolean {
		return this.registry.hasTool(toolName);
	}

	/**
	 * Check if a tool is an MCP tool and get server info
	 */
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

	/**
	 * Disconnect from MCP servers and remove their tools
	 */
	async disconnectMCP(): Promise<void> {
		if (this.mcpClient) {
			// Get list of MCP tool names
			const mcpTools = this.mcpClient.getNativeToolsRegistry();
			const mcpToolNames = Object.keys(mcpTools);

			// Remove all MCP tools from registry in one operation
			this.registry.unregisterMany(mcpToolNames);

			// Disconnect from servers
			await this.mcpClient.disconnect();

			// Reset registry to only static tools
			this.registry = ToolRegistry.fromRegistries(
				staticToolRegistry,
				staticNativeToolsRegistry,
				staticToolFormatters,
				staticToolValidators,
				staticToolStreamingFormatters,
			);

			this.mcpClient = null;
		}
	}

	/**
	 * Get a complete tool entry (all metadata)
	 *
	 * Returns the full ToolEntry with all components (tool, handler, formatter, validator)
	 */
	getToolEntry(toolName: string): ToolEntry | undefined {
		return this.registry.getEntry(toolName);
	}

	/**
	 * Get all registered tool names
	 */
	getToolNames(): string[] {
		return this.registry.getToolNames();
	}

	/**
	 * Get total number of registered tools
	 */
	getToolCount(): number {
		return this.registry.getToolCount();
	}

	/**
	 * Get connected MCP servers
	 */
	getConnectedServers(): string[] {
		return this.mcpClient?.getConnectedServers() || [];
	}

	/**
	 * Get tools for a specific MCP server
	 */
	getServerTools(serverName: string): MCPTool[] {
		return this.mcpClient?.getServerTools(serverName) || [];
	}

	/**
	 * Get server information including transport type and URL
	 */
	getServerInfo(serverName: string) {
		return this.mcpClient?.getServerInfo(serverName);
	}

	/**
	 * Get the MCP client instance
	 */
	getMCPClient() {
		return this.mcpClient;
	}

	/**
	 * Check if a tool is allowed to execute in plan mode
	 * This provides centralized plan mode permission filtering
	 *
	 * @param toolName - The name of the tool to check
	 * @returns true if the tool can be used in plan mode, false otherwise
	 */
	isToolAllowedInPlanMode(toolName: string): boolean {
		// Tools that are always allowed in plan mode (read-only operations)
		const alwaysAllowedTools = [
			'read_file',
			'find_files',
			'search_file_contents',
			'list_directory',
			'web_search',
			'fetch_url',
			'lsp_get_diagnostics',
			'enter-plan-mode',
			'exit-plan-mode',
		];

		// Check if tool is in the always-allowed list
		if (alwaysAllowedTools.includes(toolName)) {
			return true;
		}

		// write_file is conditionally allowed (only for plan files)
		// This is handled by the tool's needsApproval callback
		if (toolName === 'write_file') {
			return true;
		}

		// All other tools are blocked in plan mode
		return false;
	}

	/**
	 * Get the tool approval mode for a given tool
	 * This centralizes approval logic and provides a single point of control
	 *
	 * @param toolName - The name of the tool to check
	 * @param args - Optional tool arguments to pass to function-based needsApproval
	 * @returns Object with approval requirements:
	 *   - needsApproval: boolean indicating if user confirmation is required
	 *   - reason: optional string explaining why approval is needed
	 */
	getToolApprovalMode(
		toolName: string,
		args?: Record<string, unknown>,
	): {
		needsApproval: boolean;
		reason?: string;
	} {
		const currentMode = getCurrentMode();

		// Get the tool entry to check its needsApproval property
		const toolEntry = this.getToolEntry(toolName);
		if (!toolEntry?.tool) {
			// Unknown tool - require approval for safety
			return {needsApproval: true, reason: 'Unknown tool'};
		}

		// Extract needsApproval from the tool definition
		// biome-ignore lint/suspicious/noExplicitAny: Dynamic typing required for tool metadata
		const needsApprovalProp = (toolEntry.tool as any).needsApproval;

		// Handle function-based needsApproval
		if (typeof needsApprovalProp === 'function') {
			// The tool's callback handles mode-specific logic
			// We evaluate it here to get the current approval requirement
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic typing required
			const result = needsApprovalProp(args || {});
			const needsApproval = typeof result === 'boolean' ? result : true;

			if (needsApproval) {
				if (currentMode === 'plan') {
					return {needsApproval: true, reason: 'Plan mode restrictions apply'};
				}
				return {needsApproval: true, reason: 'Tool requires confirmation'};
			}
			return {needsApproval: false};
		}

		// Handle boolean needsApproval
		if (typeof needsApprovalProp === 'boolean') {
			if (needsApprovalProp) {
				if (currentMode === 'plan') {
					return {needsApproval: true, reason: 'Plan mode restrictions apply'};
				}
				return {needsApproval: true, reason: 'Tool requires confirmation'};
			}
			return {needsApproval: false};
		}

		// Default: require approval for safety
		if (currentMode === 'plan') {
			return {needsApproval: true, reason: 'Plan mode: tool not explicitly allowed'};
		}
		return {needsApproval: true, reason: 'Tool requires confirmation (default)'};
	}

	/**
	 * Check if a tool should be auto-executed based on mode and approval settings
	 *
	 * @param toolName - The name of the tool to check
	 * @param validationFailed - Whether the tool's validation failed
	 * @returns true if the tool can execute without user confirmation
	 */
	shouldExecuteWithoutConfirmation(
		toolName: string,
		validationFailed: boolean,
	): boolean {
		// If validation failed, we need to show the error to the user
		if (validationFailed) {
			return false;
		}

		const currentMode = getCurrentMode();

		// Special handling for bash tool - always needs approval except maybe in auto-accept
		// (bash is handled specially in conversation-loop, so this is just a safeguard)
		if (toolName === 'execute_bash') {
			return false; // Bash always needs approval
		}

		// In auto-accept mode, most tools execute without confirmation
		// (except bash which is handled above)
		if (currentMode === 'auto-accept') {
			return true;
		}

		// In plan mode, check if tool is allowed
		if (currentMode === 'plan') {
			return this.isToolAllowedInPlanMode(toolName);
		}

		// In normal mode, always require confirmation
		return false;
	}
}
