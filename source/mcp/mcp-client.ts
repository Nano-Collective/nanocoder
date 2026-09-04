import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {WebSocketClientTransport} from '@modelcontextprotocol/sdk/client/websocket.js';
import {formatError} from '@/utils/error-formatter';

// Union type for all supported client transports
type ClientTransport =
	| StdioClientTransport
	| WebSocketClientTransport
	| StreamableHTTPClientTransport;

import {dynamicTool} from 'ai';
import type {
	AISDKCoreTool,
	MCPInitResult,
	MCPPrompt,
	MCPPromptResult,
	MCPResource,
	MCPResourceContent,
	MCPServer,
	MCPTool,
	MCPToolInputSchema,
	Tool,
	ToolApprovalPolicy,
	ToolParameterSchema,
} from '@/types/index';
import {jsonSchema} from '@/types/index';
import {
	generateCorrelationId,
	getLogger,
	withNewCorrelationContext,
} from '@/utils/logging';
import {
	endMetrics,
	formatMemoryUsage,
	startMetrics,
} from '@/utils/logging/performance.js';
import {getSafeMemory} from '@/utils/logging/safe-process.js';
import {ensureString, isPlainObject} from '@/utils/type-helpers';
import {TransportFactory} from './transport-factory.js';

export class MCPClient {
	private clients: Map<string, Client> = new Map();
	private transports: Map<string, ClientTransport> = new Map();
	private serverTools: Map<string, MCPTool[]> = new Map();
	private serverResources: Map<string, MCPResource[]> = new Map();
	private serverPrompts: Map<string, MCPPrompt[]> = new Map();
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

	// Overridable seam so tests can supply a client with a failing listTools()
	// without standing up a real transport.
	protected createClient(): Client {
		return new Client({
			name: 'nanocoder-mcp-client',
			version: '1.0.0',
		});
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

			let client: Client | undefined;
			try {
				// Create transport using the factory
				const transport = TransportFactory.createTransport(normalizedServer);

				this.logger.debug('MCP transport created', {
					serverName: normalizedServer.name,
					transportType: normalizedServer.transport,
				});

				// Create and connect client
				client = this.createClient();

				this.logger.debug('MCP client created, attempting connection', {
					serverName: normalizedServer.name,
				});

				await client.connect(transport);

				// Stdio transports are created with stderr:'pipe' (see
				// TransportFactory) so server children can't write to the
				// user's terminal. Drain the pipe into the logger — an
				// unconsumed pipe would fill up and block the child.
				if ('stderr' in transport && transport.stderr) {
					const serverName = normalizedServer.name;
					transport.stderr.on('data', (chunk: Buffer) => {
						const text = chunk.toString('utf8').trimEnd();
						if (text) {
							this.logger.debug(`MCP server stderr [${serverName}]`, {
								serverName,
								stderr: text,
							});
						}
					});
				}

				this.logger.info('MCP server connected successfully', {
					serverName: normalizedServer.name,
					transport: normalizedServer.transport,
				});

				// List available tools from this server. Do this before registering
				// the server so a failed tools/list doesn't leave it visible as
				// connected — the maps are populated only once discovery succeeds.
				const toolsResult = await client.listTools();
				const tools: MCPTool[] = toolsResult.tools.map(tool => ({
					name: tool.name,
					description: tool.description || undefined,
					// MCP SDK types inputSchema as Record<string, object>; validate at protocol boundary
					// before trusting the shape as JSONSchema7
					inputSchema: isPlainObject(tool.inputSchema)
						? (tool.inputSchema as MCPToolInputSchema)
						: undefined,
					serverName: normalizedServer.name,
				}));

				// List available resources from this server
				let resources: MCPResource[] = [];
				try {
					const resourcesResult = await client.listResources();
					resources = resourcesResult.resources.map(resource => ({
						uri: resource.uri,
						name: resource.name,
						description: resource.description || undefined,
						mimeType: resource.mimeType || undefined,
						serverName: normalizedServer.name,
					}));
					this.logger.debug('MCP resources discovered', {
						serverName: normalizedServer.name,
						resourceCount: resources.length,
					});
				} catch (error) {
					// Resources are optional, log but don't fail
					this.logger.debug('MCP server does not support resources', {
						serverName: normalizedServer.name,
						error: formatError(error),
					});
				}

				// List available prompts from this server
				let prompts: MCPPrompt[] = [];
				try {
					const promptsResult = await client.listPrompts();
					prompts = promptsResult.prompts.map(prompt => ({
						name: prompt.name,
						description: prompt.description || undefined,
						arguments: prompt.arguments?.map(arg => ({
							name: arg.name,
							description: arg.description || undefined,
							required: arg.required || false,
						})),
						serverName: normalizedServer.name,
					}));
					this.logger.debug('MCP prompts discovered', {
						serverName: normalizedServer.name,
						promptCount: prompts.length,
					});
				} catch (error) {
					// Prompts are optional, log but don't fail
					this.logger.debug('MCP server does not support prompts', {
						serverName: normalizedServer.name,
						error: formatError(error),
					});
				}

				// Store client, transport, config, tools, resources, and prompts together only after
				// connection and discovery have both succeeded.
				this.clients.set(normalizedServer.name, client);
				this.transports.set(normalizedServer.name, transport);
				this.serverConfigs.set(normalizedServer.name, normalizedServer);
				this.serverTools.set(normalizedServer.name, tools);
				this.serverResources.set(normalizedServer.name, resources);
				this.serverPrompts.set(normalizedServer.name, prompts);

				const finalMetrics = endMetrics(metrics);

				this.logger.info('MCP server connection completed', {
					serverName: normalizedServer.name,
					toolCount: tools.length,
					resourceCount: resources.length,
					promptCount: prompts.length,
					duration: `${finalMetrics.duration.toFixed(2)}ms`,
					memoryDelta: formatMemoryUsage(
						finalMetrics.memoryUsage || getSafeMemory(),
					),
					correlationId,
				});
			} catch (error) {
				// Best-effort cleanup: close the client so a partially-established
				// connection (e.g. handshake ok but tools/list failed) doesn't leak
				// its transport / child process. Nothing was registered yet.
				if (client) {
					try {
						await client.close();
					} catch (closeError) {
						this.logger.debug('Error closing MCP client after failed connect', {
							serverName: normalizedServer.name,
							error: formatError(closeError),
						});
					}
				}

				const finalMetrics = endMetrics(metrics);
				this.logger.error('Failed to connect to MCP server', {
					serverName: normalizedServer.name,
					transport: normalizedServer.transport,
					error: error instanceof Error ? error.message : error,
					errorName: error instanceof Error ? error.name : 'Unknown',
					duration: `${finalMetrics.duration.toFixed(2)}ms`,
					memoryDelta: formatMemoryUsage(
						finalMetrics.memoryUsage || getSafeMemory(),
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
					const resources =
						this.serverResources.get(normalizedServer.name) || [];
					const prompts = this.serverPrompts.get(normalizedServer.name) || [];
					const result: MCPInitResult = {
						serverName: normalizedServer.name,
						success: true,
						toolCount: tools.length,
						resourceCount: resources.length,
						promptCount: prompts.length,
					};
					results.push(result);

					this.logger.debug('MCP server connection successful in batch', {
						serverName: normalizedServer.name,
						toolCount: tools.length,
						resourceCount: resources.length,
						promptCount: prompts.length,
						correlationId,
					});

					onProgress?.(result);
					return result;
				} catch (error) {
					const normalizedServer = this.normalizeServerConfig(server);
					const result: MCPInitResult = {
						serverName: normalizedServer.name,
						success: false,
						error: formatError(error),
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
				const schema = mcpTool.inputSchema;

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
						mcpTool.inputSchema || {type: 'object'},
					),
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
		approval: ToolApprovalPolicy;
	}> {
		const entries: Array<{
			name: string;
			tool: AISDKCoreTool;
			handler: (args: Record<string, unknown>) => Promise<string>;
			approval: ToolApprovalPolicy;
		}> = [];

		// Get native tools once to avoid redundant calls
		const nativeTools = this.getNativeToolsRegistry();

		for (const [serverName, serverTools] of this.serverTools.entries()) {
			for (const mcpTool of serverTools) {
				const toolName = mcpTool.name;

				// Get the AI SDK native tool
				const coreTool = nativeTools[toolName];

				if (coreTool) {
					// Create handler that calls this tool
					const handler = async (args: Record<string, unknown>) => {
						return this.callTool(toolName, args);
					};

					// Medium risk: MCP tools require approval unless the server's
					// alwaysAllow list covers them or the mode is auto-accept. (Yolo
					// is bypassed centrally by resolveToolApproval.)
					const isAutoApproved = this.isToolAutoApproved(toolName, serverName);
					const approval: ToolApprovalPolicy = isAutoApproved
						? false
						: (_args, mode) => mode !== 'auto-accept';

					entries.push({
						name: toolName,
						tool: coreTool,
						handler,
						approval,
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
			const schema = toolDef.inputSchema;
			if (schema.properties) {
				for (const [key, value] of Object.entries(args)) {
					const propSchema = schema.properties[key];
					// Only coerce if the schema explicitly demands a string and we have an object
					if (
						typeof propSchema === 'object' &&
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
				const errorMessage = formatError(error);
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

	/**
	 * Gets server information including transport type and URL for remote servers
	 */
	getServerInfo(serverName: string):
		| {
				name: string;
				transport: string;
				url?: string;
				toolCount: number;
				resourceCount: number;
				promptCount: number;
				connected: boolean;
				description?: string;
				tags?: string[];
				autoApprovedCommands?: string[];
		  }
		| undefined {
		const client = this.clients.get(serverName);
		const serverConfig = this.serverConfigs.get(serverName);
		const tools = this.serverTools.get(serverName) || [];
		const resources = this.serverResources.get(serverName) || [];
		const prompts = this.serverPrompts.get(serverName) || [];

		if (!client || !serverConfig) {
			return undefined;
		}

		return {
			name: serverName,
			transport: serverConfig.transport,
			url: serverConfig.url,
			toolCount: tools.length,
			resourceCount: resources.length,
			promptCount: prompts.length,
			connected: true,
			description: serverConfig.description,
			tags: serverConfig.tags,
			autoApprovedCommands: serverConfig.alwaysAllow,
		};
	}

	/**
	 * Get all MCP resources from all connected servers
	 */
	getAllResources(): MCPResource[] {
		const resources: MCPResource[] = [];

		this.logger.debug('Building all resources registry from MCP servers', {
			serverCount: this.serverResources.size,
			totalResourcesAvailable: Array.from(this.serverResources.values()).reduce(
				(sum, resources) => sum + resources.length,
				0,
			),
		});

		for (const [
			serverName,
			serverResources,
		] of this.serverResources.entries()) {
			this.logger.debug('Processing resources from MCP server', {
				serverName,
				resourceCount: serverResources.length,
			});

			resources.push(...serverResources);
		}

		return resources;
	}

	/**
	 * Get resources from a specific server
	 */
	getServerResources(serverName: string): MCPResource[] {
		return this.serverResources.get(serverName) || [];
	}

	/**
	 * Read content from an MCP resource
	 */
	/**
	 * Read a resource's content from a specific server. `serverName` is
	 * required (rather than searching every connected server by URI) so two
	 * servers can never be confused when they happen to expose the same URI.
	 *
	 * Returns every content block the server sent: a resource read can
	 * legitimately return more than one (`ReadResourceResult.contents` is an
	 * array), so truncating to the first would silently drop data.
	 */
	async readResource(
		serverName: string,
		uri: string,
	): Promise<MCPResourceContent[]> {
		const correlationId = generateCorrelationId();
		const metrics = startMetrics();

		return await withNewCorrelationContext(async () => {
			this.logger.info('Reading MCP resource', {
				uri,
				serverName,
				correlationId,
			});

			const client = this.clients.get(serverName);
			if (!client) {
				throw new Error(`No MCP client connected for server: ${serverName}`);
			}

			try {
				const result = await client.readResource({uri});

				// Text vs. blob content is NOT distinguished by a `type` field in
				// the MCP schema — TextResourceContents carries a `text` property,
				// BlobResourceContents carries a `blob` property, and neither
				// declares the other. Discriminate on which key is present.
				const contents: MCPResourceContent[] = (result.contents ?? []).map(
					c => {
						const block = c as {
							uri: string;
							mimeType?: string;
							text?: string;
							blob?: string;
						};
						return {
							uri: block.uri,
							mimeType: block.mimeType,
							text: 'text' in block ? block.text : undefined,
							blob: 'blob' in block ? block.blob : undefined,
						};
					},
				);

				const finalMetrics = endMetrics(metrics);
				this.logger.info('MCP resource read completed', {
					uri,
					serverName,
					contentCount: contents.length,
					duration: `${finalMetrics.duration.toFixed(2)}ms`,
					correlationId,
				});

				return contents;
			} catch (error) {
				const errorMessage = formatError(error);
				const errorName = error instanceof Error ? error.name : 'Unknown';

				const finalMetrics = endMetrics(metrics);

				this.logger.error('MCP resource read failed', {
					uri,
					serverName,
					error: errorMessage,
					errorName,
					duration: `${finalMetrics.duration.toFixed(2)}ms`,
					correlationId,
				});

				throw new Error(`MCP resource read failed: ${errorMessage}`);
			}
		}, correlationId);
	}

	/**
	 * Get all MCP prompts from all connected servers
	 */
	getAllPrompts(): MCPPrompt[] {
		const prompts: MCPPrompt[] = [];

		this.logger.debug('Building all prompts registry from MCP servers', {
			serverCount: this.serverPrompts.size,
			totalPromptsAvailable: Array.from(this.serverPrompts.values()).reduce(
				(sum, prompts) => sum + prompts.length,
				0,
			),
		});

		for (const [serverName, serverPrompts] of this.serverPrompts.entries()) {
			this.logger.debug('Processing prompts from MCP server', {
				serverName,
				promptCount: serverPrompts.length,
			});

			prompts.push(...serverPrompts);
		}

		return prompts;
	}

	/**
	 * Get prompts from a specific server
	 */
	getServerPrompts(serverName: string): MCPPrompt[] {
		return this.serverPrompts.get(serverName) || [];
	}

	/**
	 * Get a prompt from an MCP server
	 */
	/**
	 * Fetch a prompt from a specific server. `serverName` is required (rather
	 * than searching every connected server by name) so two servers can never
	 * be confused when they happen to expose a same-named prompt.
	 */
	async getPrompt(
		serverName: string,
		name: string,
		args?: Record<string, string>,
	): Promise<MCPPromptResult> {
		const correlationId = generateCorrelationId();
		const metrics = startMetrics();

		return await withNewCorrelationContext(async () => {
			this.logger.info('Getting MCP prompt', {
				name,
				serverName,
				hasArgs: !!args,
				argCount: args ? Object.keys(args).length : 0,
				correlationId,
			});

			const client = this.clients.get(serverName);
			if (!client) {
				throw new Error(`No MCP client connected for server: ${serverName}`);
			}

			try {
				const result = await client.getPrompt({name, arguments: args});

				this.logger.debug('MCP prompt retrieved successfully', {
					name,
					serverName,
					hasDescription: !!result.description,
					messageCount: result.messages?.length || 0,
					correlationId,
				});

				const finalMetrics = endMetrics(metrics);
				this.logger.info('MCP prompt retrieval completed', {
					name,
					serverName,
					messageCount: result.messages?.length || 0,
					duration: `${finalMetrics.duration.toFixed(2)}ms`,
					correlationId,
				});

				return {
					description: result.description,
					messages: result.messages.map(
						(msg: {
							role: string;
							content:
								| {
										type: string;
										text?: string;
										data?: string;
										mimeType?: string;
								  }
								| string;
						}) => ({
							role: msg.role as 'user' | 'assistant',
							content:
								typeof msg.content === 'string'
									? {type: 'text' as const, text: msg.content}
									: {
											type: msg.content.type as 'text' | 'image' | 'resource',
											text: msg.content.text,
											data: msg.content.data,
											mimeType: msg.content.mimeType,
										},
						}),
					),
				};
			} catch (error) {
				const errorMessage = formatError(error);
				const errorName = error instanceof Error ? error.name : 'Unknown';

				const finalMetrics = endMetrics(metrics);

				this.logger.error('MCP prompt retrieval failed', {
					name,
					serverName,
					error: errorMessage,
					errorName,
					duration: `${finalMetrics.duration.toFixed(2)}ms`,
					correlationId,
				});

				throw new Error(`MCP prompt retrieval failed: ${errorMessage}`);
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
					const errorMessage = formatError(error);
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
			this.serverResources.clear();
			this.serverPrompts.clear();
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
}
