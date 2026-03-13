import {MCPClient} from '@/mcp/mcp-client';
import {
	nativeToolsRegistry as staticNativeToolsRegistry,
	toolFormatters as staticToolFormatters,
	toolRegistry as staticToolRegistry,
	toolStreamingFormatters as staticToolStreamingFormatters,
	toolValidators as staticToolValidators,
} from '@/tools/index';
import {ToolRegistry} from '@/tools/tool-registry';
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
import {getShutdownManager} from '@/utils/shutdown';

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

		getShutdownManager().unregister('mcp-client');
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
}
