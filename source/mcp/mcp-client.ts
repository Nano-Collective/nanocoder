import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {WebSocketClientTransport} from '@modelcontextprotocol/sdk/client/websocket.js';

// Union type for all supported client transports
type ClientTransport =
	| StdioClientTransport
	| WebSocketClientTransport
	| StreamableHTTPClientTransport;

import {dynamicTool} from 'ai';
import {getCurrentMode} from '@/context/mode-context';
import type {
	AISDKCoreTool,
	MCPInitResult,
	MCPServer,
	MCPTool,
	Tool,
	ToolParameterSchema,
} from '@/types/index';
import {jsonSchema} from '@/types/index';
import {
	endMetrics,
	formatMemoryUsage,
	generateCorrelationId,
	getLogger,
	startMetrics,
	withNewCorrelationContext,
} from '@/utils/logging';
import {ensureString} from '@/utils/type-helpers';
import {TransportFactory} from './transport-factory.js';

export class MCPClient {
	private clients: Map<string, Client> = new Map();
	private transports: Map<string, ClientTransport> = new Map();
	private serverTools: Map<string, MCPTool[]> = new Map();
	private serverConfigs: Map<string, MCPServer> = new Map();
	private isConnected: boolean = false;
	private logger = getLogger();

	private isToolAutoApproved(toolName: string, serverName: string): boolean {
		const serverConfig = this.serverConfigs.get(serverName);
		if (!serverConfig?.alwaysAllow) {
			return false;
		}

		return serverConfig.alwaysAllow.includes(toolName);
	}

	constructor() {
		this.logger.debug('MCP client initialized');
	}

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
		const correlationId = generateCorrelationId();
		const metrics = startMetrics();

		return await withNewCorrelationContext(async () => {
			// Normalize server configuration for backward compatibility
			const normalizedServer = this.normalizeServerConfig(server);

			this.logger.info('Connecting to MCP server', {
				serverName: normalizedServer.name,
				transport: normalizedServer.transport,
				hasUrl: !!normalizedServer.url,
				hasCommand: !!normalizedServer.command,
				correlationId,
			});

			// Validate server configuration
			const validation =
				TransportFactory.validateServerConfig(normalizedServer);
			if (!validation.valid) {
				const finalMetrics = endMetrics(metrics);
				this.logger.error('MCP server configuration validation failed', {
					serverName: normalizedServer.name,
					errors: validation.errors,
					duration: `${finalMetrics.duration.toFixed(2)}ms`,
					correlationId,
				});
				throw new Error(
					`Invalid MCP server configuration for "${
						normalizedServer.name
					}": ${validation.errors.join(', ')}`,
				);
			}

			try {
				// Create transport using the factory
				const transport = TransportFactory.createTransport(normalizedServer);

				this.logger.debug('MCP transport created', {
					serverName: normalizedServer.name,
					transportType: normalizedServer.transport,
				});

				// Create and connect client
				const client = new Client({
					name: 'nanocoder-mcp-client',
					version: '1.0.0',
				});

				this.logger.debug('MCP client created, attempting connection', {
					serverName: normalizedServer.name,
				});

				await client.connect(transport);

				this.logger.info('MCP server connected successfully', {
					serverName: normalizedServer.name,
					transport: normalizedServer.transport,
				});

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

				const finalMetrics = endMetrics(metrics);

				this.logger.info('MCP server connection completed', {
					serverName: normalizedServer.name,
					toolCount: tools.length,
					duration: `${finalMetrics.duration.toFixed(2)}ms`,
					memoryDelta: formatMemoryUsage(
						finalMetrics.memoryUsage || process.memoryUsage(),
					),
					correlationId,
				});
			} catch (error) {
				const finalMetrics = endMetrics(metrics);
				this.logger.error('Failed to connect to MCP server', {
					serverName: normalizedServer.name,
					transport: normalizedServer.transport,
					error: error instanceof Error ? error.message : error,
					errorName: error instanceof Error ? error.name : 'Unknown',
					duration: `${finalMetrics.duration.toFixed(2)}ms`,
					memoryDelta: formatMemoryUsage(
						finalMetrics.memoryUsage || process.memoryUsage(),
					),
					correlationId,
				});

				throw error;
			}
		}, correlationId);
	}

	async connectToServers(
		servers: MCPServer[],
		onProgress?: (result: MCPInitResult) => void,
	): Promise<MCPInitResult[]> {
		const results: MCPInitResult[] = [];
		const correlationId = generateCorrelationId();
		const metrics = startMetrics();

		this.logger.info('Starting batch MCP server connections', {
			serverCount: servers.length,
			serverNames: servers.map(s => this.normalizeServerConfig(s).name),
			correlationId,
		});

		return await withNewCorrelationContext(async () => {
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

					this.logger.debug('MCP server connection successful in batch', {
						serverName: normalizedServer.name,
						toolCount: tools.length,
						correlationId,
					});

					onProgress?.(result);
					return result;
				} catch (error) {
					const normalizedServer = this.normalizeServerConfig(server);
					const result: MCPInitResult = {
						serverName: normalizedServer.name,
						success: false,
						error: error instanceof Error ? error.message : String(error),
					};

					this.logger.error('MCP server connection failed in batch', {
						serverName: normalizedServer.name,
						error: result.error,
						errorName: error instanceof Error ? error.name : 'Unknown',
						correlationId,
					});

					results.push(result);
					onProgress?.(result);
					return result;
				}
			});

			// Wait for all connections to complete
			await Promise.all(connectionPromises);

			const finalMetrics = endMetrics(metrics);
			const successfulConnections = results.filter(r => r.success).length;
			const failedConnections = results.length - successfulConnections;

			this.logger.info('Batch MCP server connections completed', {
				totalServers: servers.length,
				successfulConnections,
				failedConnections,
				duration: `${finalMetrics.duration.toFixed(2)}ms`,
				correlationId,
			});

			this.isConnected = true;
			return results;
		}, correlationId);
	}

	getAllTools(): Tool[] {
		const tools: Tool[] = [];

		this.logger.debug('Building all tools registry from MCP servers', {
			serverCount: this.serverTools.size,
			totalToolsAvailable: Array.from(this.serverTools.values()).reduce(
				(sum, tools) => sum + tools.length,
				0,
			),
		});

		for (const [serverName, serverTools] of this.serverTools.entries()) {
			this.logger.debug('Processing tools from MCP server', {
				serverName,
				toolCount: serverTools.length,
			});

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
				const isAutoApproved = this.isToolAutoApproved(toolName, serverName);
				const coreTool = dynamicTool({
					description: mcpTool.description
						? `[MCP:${serverName}] ${mcpTool.description}`
						: `MCP tool from ${serverName}`,
					inputSchema: jsonSchema<Record<string, unknown>>(
						(mcpTool.inputSchema as unknown) || {type: 'object'},
					),
					// Medium risk: MCP tools require approval unless explicitly configured in the server's alwaysAllow list or in auto-accept mode
					needsApproval: () => {
						if (isAutoApproved) {
							return false;
						}

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

		// Sanitize arguments: If schema expects a string but we got an object, ensureString it.
		const serverTools = this.serverTools.get(mapping.serverName) || [];
		const toolDef = serverTools.find(t => t.name === mapping.originalName);
		const sanitizedArgs = {...args};

		if (toolDef?.inputSchema) {
			const schema = toolDef.inputSchema as {
				properties?: Record<string, {type?: string}>;
			};
			if (schema.properties) {
				for (const [key, value] of Object.entries(args)) {
					const propSchema = schema.properties[key];
					// Only coerce if the schema explicitly demands a string and we have an object
					if (
						propSchema?.type === 'string' &&
						typeof value === 'object' &&
						value !== null
					) {
						sanitizedArgs[key] = ensureString(value);
					}
				}
			}
		}

		return this.executeToolCall(client, mapping.originalName, sanitizedArgs);
	}

	private async executeToolCall(
		client: Client,
		toolName: string,
		args: Record<string, unknown>,
	): Promise<string> {
		const correlationId = generateCorrelationId();
		const metrics = startMetrics();

		return await withNewCorrelationContext(async () => {
			this.logger.info('Executing MCP tool', {
				toolName,
				argumentCount: Object.keys(args).length,
				hasArguments: Object.keys(args).length > 0,
				correlationId,
			});

			try {
				const result = await client.callTool({
					name: toolName,
					arguments: args,
				});

				this.logger.debug('MCP tool executed successfully', {
					toolName,
					hasContent: !!result.content,
					contentLength: Array.isArray(result.content)
						? result.content.length
						: 0,
					correlationId,
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
						const responseText = textContent.text || '';

						const finalMetrics = endMetrics(metrics);
						this.logger.info('MCP tool execution completed', {
							toolName,
							responseLength: responseText.length,
							duration: `${finalMetrics.duration.toFixed(2)}ms`,
							correlationId,
						});

						return responseText;
					}
					const jsonResponse = JSON.stringify(content);

					const finalMetrics = endMetrics(metrics);
					this.logger.info('MCP tool execution completed (JSON)', {
						toolName,
						responseLength: jsonResponse.length,
						duration: `${finalMetrics.duration.toFixed(2)}ms`,
						correlationId,
					});

					return jsonResponse;
				}

				const finalMetrics = endMetrics(metrics);
				this.logger.info('MCP tool execution completed (no output)', {
					toolName,
					duration: `${finalMetrics.duration.toFixed(2)}ms`,
					correlationId,
				});

				return 'Tool executed successfully (no output)';
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : 'Unknown error';
				const errorName = error instanceof Error ? error.name : 'Unknown';

				const finalMetrics = endMetrics(metrics);

				this.logger.error('MCP tool execution failed', {
					toolName,
					error: errorMessage,
					errorName,
					duration: `${finalMetrics.duration.toFixed(2)}ms`,
					correlationId,
				});

				throw new Error(`MCP tool execution failed: ${errorMessage}`);
			}
		}, correlationId);
	}

	async disconnect(): Promise<void> {
		const correlationId = generateCorrelationId();
		const serverNames = Array.from(this.clients.keys());

		if (serverNames.length === 0) {
			this.logger.debug('No MCP servers to disconnect from');
			return;
		}

		this.logger.info('Disconnecting from MCP servers', {
			serverCount: serverNames.length,
			serverNames,
			correlationId,
		});

		return await withNewCorrelationContext(async () => {
			let successfulDisconnections = 0;
			let failedDisconnections = 0;

			for (const [serverName, client] of this.clients.entries()) {
				try {
					await client.close();
					successfulDisconnections++;

					this.logger.info('Disconnected from MCP server successfully', {
						serverName,
						correlationId,
					});
				} catch (error) {
					failedDisconnections++;
					const errorMessage =
						error instanceof Error ? error.message : 'Unknown error';
					const errorName = error instanceof Error ? error.name : 'Unknown';

					this.logger.error('Error disconnecting from MCP server', {
						serverName,
						error: errorMessage,
						errorName,
						correlationId,
					});
				}
			}

			this.clients.clear();
			this.transports.clear();
			this.serverTools.clear();
			this.serverConfigs.clear();
			this.isConnected = false;

			this.logger.info('MCP client disconnection completed', {
				totalServers: serverNames.length,
				successfulDisconnections,
				failedDisconnections,
				correlationId,
			});
		}, correlationId);
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
				autoApprovedCommands?: string[];
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
			autoApprovedCommands: serverConfig.alwaysAllow,
		};
	}
}
