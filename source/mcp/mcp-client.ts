import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {WebSocketClientTransport} from '@modelcontextprotocol/sdk/client/websocket.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Union type for all supported client transports
type ClientTransport =
	| StdioClientTransport
	| WebSocketClientTransport
	| StreamableHTTPClientTransport;
import type {Tool, ToolParameterSchema, AISDKCoreTool} from '@/types/index';
import {jsonSchema} from '@/types/index';
import {dynamicTool} from 'ai';
import {logInfo, logError} from '@/utils/message-queue';
import {getCurrentMode} from '@/context/mode-context';
import {TransportFactory} from './transport-factory.js';

import type {MCPServer, MCPTool, MCPInitResult} from '@/types/index';

export class MCPClient {
	private clients: Map<string, Client> = new Map();
	private transports: Map<string, ClientTransport> = new Map();
	private serverTools: Map<string, MCPTool[]> = new Map();
	private serverConfigs: Map<string, MCPServer> = new Map();
	private isConnected: boolean = false;

	constructor() {}

	/**
	 * Ensures backward compatibility for old MCP server configurations
	 * by adding default transport type for existing configurations
	 */
	private normalizeServerConfig(server: MCPServer): MCPServer {
		// If no transport is specified, default to 'stdio' for backward compatibility
		if (!server.transport) {
			return {
				...server,
				transport: 'stdio',
			};
		}
		return server;
	}

	async connectToServer(server: MCPServer): Promise<void> {
		// Normalize server configuration for backward compatibility
		const normalizedServer = this.normalizeServerConfig(server);

		// Validate server configuration
		const validation = TransportFactory.validateServerConfig(normalizedServer);
		if (!validation.valid) {
			throw new Error(
				`Invalid MCP server configuration for "${
					normalizedServer.name
				}": ${validation.errors.join(', ')}`,
			);
		}

		// Create transport using the factory
		const transport = TransportFactory.createTransport(normalizedServer);

		// Create and connect client
		const client = new Client({
			name: 'nanocoder-mcp-client',
			version: '1.0.0',
		});

		await client.connect(transport);

		// Store client, transport, and server config
		this.clients.set(normalizedServer.name, client);
		this.transports.set(normalizedServer.name, transport);
		this.serverConfigs.set(normalizedServer.name, normalizedServer);

		// List available tools from this server
		const toolsResult = await client.listTools();
		const tools: MCPTool[] = toolsResult.tools.map(tool => ({
			name: tool.name,
			description: tool.description || undefined,
			inputSchema: tool.inputSchema,
			serverName: normalizedServer.name,
		}));

		this.serverTools.set(normalizedServer.name, tools);

		// Success - no console logging here, will be handled by app
	}

	async connectToServers(
		servers: MCPServer[],
		onProgress?: (result: MCPInitResult) => void,
	): Promise<MCPInitResult[]> {
		const results: MCPInitResult[] = [];

		// Connect to servers in parallel for better performance
		const connectionPromises = servers.map(async server => {
			try {
				// Normalize server configuration for backward compatibility
				const normalizedServer = this.normalizeServerConfig(server);

				await this.connectToServer(normalizedServer);
				const tools = this.serverTools.get(normalizedServer.name) || [];
				const result: MCPInitResult = {
					serverName: normalizedServer.name,
					success: true,
					toolCount: tools.length,
				};
				results.push(result);
				onProgress?.(result);
				return result;
			} catch (error) {
				const normalizedServer = this.normalizeServerConfig(server);
				const result: MCPInitResult = {
					serverName: normalizedServer.name,
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
				results.push(result);
				onProgress?.(result);
				return result;
			}
		});

		// Wait for all connections to complete
		await Promise.all(connectionPromises);

		this.isConnected = true;
		return results;
	}

	getAllTools(): Tool[] {
		const tools: Tool[] = [];

		for (const [serverName, serverTools] of this.serverTools.entries()) {
			for (const mcpTool of serverTools) {
				// Convert MCP tool to nanocoder Tool format
				// Use the original tool name for better model compatibility
				const schema = mcpTool.inputSchema as
					| {
							type?: string;
							properties?: Record<string, unknown>;
							required?: string[];
					  }
					| undefined;

				const tool: Tool = {
					type: 'function',
					function: {
						name: mcpTool.name,
						description: mcpTool.description
							? `[MCP:${serverName}] ${mcpTool.description}`
							: `MCP tool from ${serverName}`,
						parameters: {
							type: 'object',
							properties: (schema?.properties || {}) as Record<
								string,
								ToolParameterSchema
							>,
							required: schema?.required || [],
						},
					},
				};
				tools.push(tool);
			}
		}

		return tools;
	}

	/**
	 * Get all MCP tools as AI SDK native CoreTool format
	 * Converts MCP tool schemas to AI SDK's tool() format
	 */
	getNativeToolsRegistry(): Record<string, AISDKCoreTool> {
		const nativeTools: Record<string, AISDKCoreTool> = {};

		for (const [serverName, serverTools] of this.serverTools.entries()) {
			for (const mcpTool of serverTools) {
				// dynamicTool is more explicit about unknown types compared to tool()
				// MCP schemas come from external servers and are not known at compile time
				const toolName = mcpTool.name;
				const coreTool = dynamicTool({
					description: mcpTool.description
						? `[MCP:${serverName}] ${mcpTool.description}`
						: `MCP tool from ${serverName}`,
					inputSchema: jsonSchema<Record<string, unknown>>(
						(mcpTool.inputSchema as unknown) || {type: 'object'},
					),
					// Medium risk: MCP tools require approval except in auto-accept mode
					needsApproval: () => {
						const mode = getCurrentMode();
						return mode !== 'auto-accept'; // true in normal/plan, false in auto-accept
					},
					execute: async (input, _options) => {
						// dynamicTool passes 'input' as unknown, validate at runtime
						return await this.callTool(
							toolName,
							input as Record<string, unknown>,
						);
					},
				});

				nativeTools[mcpTool.name] = coreTool;
			}
		}

		return nativeTools;
	}
	getToolMapping(): Map<string, {serverName: string; originalName: string}> {
		const mapping = new Map<
			string,
			{serverName: string; originalName: string}
		>();

		for (const [serverName, serverTools] of this.serverTools.entries()) {
			for (const mcpTool of serverTools) {
				mapping.set(mcpTool.name, {
					serverName,
					originalName: mcpTool.name,
				});
			}
		}

		return mapping;
	}

	/**
	 * Get all MCP tools as entries with handlers for easy registration
	 * Each entry contains the native AI SDK tool and its handler function
	 *
	 * the AI SDK tool definition and the corresponding handler function.
	 * This enables cleaner integration with ToolManager.
	 *
	 * @returns Array of tool entries with name, AI SDK tool, and handler function
	 */
	getToolEntries(): Array<{
		name: string;
		tool: AISDKCoreTool;
		handler: (args: Record<string, unknown>) => Promise<string>;
	}> {
		const entries: Array<{
			name: string;
			tool: AISDKCoreTool;
			handler: (args: Record<string, unknown>) => Promise<string>;
		}> = [];

		// Get native tools once to avoid redundant calls
		const nativeTools = this.getNativeToolsRegistry();

		for (const [, serverTools] of this.serverTools.entries()) {
			for (const mcpTool of serverTools) {
				const toolName = mcpTool.name;

				// Get the AI SDK native tool
				const coreTool = nativeTools[toolName];

				if (coreTool) {
					// Create handler that calls this tool
					const handler = async (args: Record<string, unknown>) => {
						return this.callTool(toolName, args);
					};

					entries.push({
						name: toolName,
						tool: coreTool,
						handler,
					});
				}
			}
		}

		return entries;
	}

	async callTool(
		toolName: string,
		args: Record<string, unknown>,
	): Promise<string> {
		// First, try to find which server has this tool
		const toolMapping = this.getToolMapping();
		const mapping = toolMapping.get(toolName);

		if (!mapping) {
			// Fallback: try parsing as prefixed name (mcp_serverName_toolName) for backward compatibility
			const parts = toolName.split('_');
			if (parts.length >= 3 && parts[0] === 'mcp' && parts[1]) {
				const serverName = parts[1];
				const originalToolName = parts.slice(2).join('_');
				const client = this.clients.get(serverName);
				if (client) {
					return this.executeToolCall(client, originalToolName, args);
				}
			}
			throw new Error(`MCP tool not found: ${toolName}`);
		}

		const client = this.clients.get(mapping.serverName);
		if (!client) {
			throw new Error(
				`No MCP client connected for server: ${mapping.serverName}`,
			);
		}

		return this.executeToolCall(client, mapping.originalName, args);
	}

	private async executeToolCall(
		client: Client,
		toolName: string,
		args: Record<string, unknown>,
	): Promise<string> {
		try {
			const result = await client.callTool({
				name: toolName,
				arguments: args,
			});

			// Convert result content to string
			if (
				result.content &&
				Array.isArray(result.content) &&
				result.content.length > 0
			) {
				const content = result.content[0] as
					| {type: 'text'; text?: string}
					| Record<string, unknown>;
				if ('type' in content && content.type === 'text') {
					const textContent = content as {type: 'text'; text?: string};
					return textContent.text || '';
				}
				return JSON.stringify(content);
			}

			return 'Tool executed successfully (no output)';
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : 'Unknown error';
			throw new Error(`MCP tool execution failed: ${errorMessage}`);
		}
	}

	async disconnect(): Promise<void> {
		for (const [serverName, client] of this.clients.entries()) {
			try {
				await client.close();
				logInfo(`Disconnected from MCP server: ${serverName}`);
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : 'Unknown error';
				logError(`Error disconnecting from ${serverName}: ${errorMessage}`);
			}
		}

		this.clients.clear();
		this.transports.clear();
		this.serverTools.clear();
		this.serverConfigs.clear();
		this.isConnected = false;
	}

	getConnectedServers(): string[] {
		return Array.from(this.clients.keys());
	}

	isServerConnected(serverName: string): boolean {
		return this.clients.has(serverName);
	}

	getServerTools(serverName: string): MCPTool[] {
		return this.serverTools.get(serverName) || [];
	}

	/**
	 * Gets server information including transport type and URL for remote servers
	 */
	getServerInfo(serverName: string):
		| {
				name: string;
				transport: string;
				url?: string;
				toolCount: number;
				connected: boolean;
				description?: string;
				tags?: string[];
		  }
		| undefined {
		const client = this.clients.get(serverName);
		const serverConfig = this.serverConfigs.get(serverName);
		const tools = this.serverTools.get(serverName) || [];

		if (!client || !serverConfig) {
			return undefined;
		}

		return {
			name: serverName,
			transport: serverConfig.transport,
			url: serverConfig.url,
			toolCount: tools.length,
			connected: true,
			description: serverConfig.description,
			tags: serverConfig.tags,
		};
	}
}
