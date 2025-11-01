import type {
	ToolEntry,
	ToolHandler,
	ToolFormatter,
	ToolValidator,
	MCPInitResult,
	MCPServer,
	MCPTool,
	AISDKCoreTool,
} from '@/types/index';
import {
	toolRegistry as staticToolRegistry,
	toolFormatters as staticToolFormatters,
	toolValidators as staticToolValidators,
	nativeToolsRegistry as staticNativeToolsRegistry,
} from '@/tools/index';
import {MCPClient} from '@/mcp/mcp-client';
import {ToolRegistry} from '@/tools/tool-registry';

/**
 * Manages both static tools and dynamic MCP tools
 * All tools are stored in unified ToolEntry format via ToolRegistry
 *
 * Phase 7: ToolManager Migration to ToolRegistry
 * - ToolManager now uses ToolRegistry internally for unified tool management
 * - Single source of truth for all tool metadata (handlers, formatters, validators, AI SDK tools)
 * - Cleaner API with less manual registry coordination
 * - 100% backward compatible with existing public API
 * - MCP tool integration simplified
 *
 * Previous phases:
 * - Phase 1: Removed MCPToolAdapter
 * - Phase 2-6: Type system and registry enhancements
 */
export class ToolManager {
	/**
	 * Unified tool registry using ToolRegistry helper class
	 *
	 * Phase 7: Consolidates 4 separate registries into single ToolRegistry
	 * Maintains backward compatibility through delegating public methods
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
		);
	}

	/**
	 * Initialize MCP servers and register their tools
	 *
	 * Phase 7: Uses ToolRegistry to register MCP tools cleanly
	 * without needing to manually manage multiple registries
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
	 *
	 * Phase 7: Delegates to ToolRegistry for cleaner code
	 */
	getAllTools(): Record<string, AISDKCoreTool> {
		return this.registry.getNativeTools();
	}

	/**
	 * Get all tool handlers
	 *
	 * Phase 7: Delegates to ToolRegistry for backward compatibility
	 */
	getToolRegistry(): Record<string, ToolHandler> {
		return this.registry.getHandlers();
	}

	/**
	 * Get a specific tool handler
	 *
	 * Phase 7: Delegates to ToolRegistry
	 */
	getToolHandler(toolName: string): ToolHandler | undefined {
		return this.registry.getHandler(toolName);
	}

	/**
	 * Get a specific tool formatter
	 *
	 * Phase 7: Delegates to ToolRegistry
	 */
	getToolFormatter(toolName: string): ToolFormatter | undefined {
		return this.registry.getFormatter(toolName);
	}

	/**
	 * Get a specific tool validator
	 *
	 * Phase 7: Delegates to ToolRegistry
	 */
	getToolValidator(toolName: string): ToolValidator | undefined {
		return this.registry.getValidator(toolName);
	}

	/**
	 * Get native AI SDK tools registry
	 * @deprecated Use getAllTools() instead - they now return the same thing
	 *
	 * Phase 7: Delegates to ToolRegistry for backward compatibility
	 */
	getNativeToolsRegistry(): Record<string, AISDKCoreTool> {
		return this.registry.getNativeTools();
	}

	/**
	 * Check if a tool exists
	 *
	 * Phase 7: Delegates to ToolRegistry
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
	 *
	 * Phase 7: Uses ToolRegistry.unregisterMany() for clean removal
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
			);

			this.mcpClient = null;
		}
	}

	/**
	 * Phase 7: Get a complete tool entry (all metadata)
	 *
	 * Returns the full ToolEntry with all components (tool, handler, formatter, validator)
	 */
	getToolEntry(toolName: string): ToolEntry | undefined {
		return this.registry.getEntry(toolName);
	}

	/**
	 * Phase 7: Get all registered tool names
	 */
	getToolNames(): string[] {
		return this.registry.getToolNames();
	}

	/**
	 * Phase 7: Get total number of registered tools
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
}
