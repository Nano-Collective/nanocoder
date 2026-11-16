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

import type {
	AISDKCoreTool,
	MCPHealthChange,
	MCPHealthStatus,
	MCPInitResult,
	MCPPrompt,
	MCPPromptResult,
	MCPResource,
	MCPResourceContent,
	MCPServer,
	MCPTool,
	StructuredToolOutput,
	Tool,
} from '@/types/index';
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
import {
	type HealthTimers,
	type LifecycleTransport,
	MCPHealthMonitor,
} from './health-monitor.js';
import {
	buildToolMapping,
	findToolNameConflicts,
	type MCPToolMapping,
	type MCPToolNameConflict,
	toMCPPrompt,
	toMCPResource,
	toMCPTool,
	toPromptResult,
	toResourceContents,
} from './server-catalog.js';
import {
	coerceStringArguments,
	createValidatedHandler,
	type MCPToolEntry,
	toFunctionTool,
	toNativeTool,
} from './tool-adapter.js';
import {createMCPToolApproval, isToolAutoApproved} from './tool-approval.js';
import {formatToolResultContent} from './tool-result-format.js';
import {TransportFactory} from './transport-factory.js';

export class MCPClient {
	private clients: Map<string, Client> = new Map();
	private transports: Map<string, ClientTransport> = new Map();
	private serverTools: Map<string, MCPTool[]> = new Map();
	/**
	 * Memoised getToolMapping() result. Plan mode calls that method on every
	 * getAvailableToolNames() — both when building the prompt and per turn at
	 * runtime — so rebuilding the Map each time is pure waste. Invalidated
	 * wherever serverTools changes (connect, disconnect).
	 */
	private toolMappingCache: MCPToolMapping | null = null;
	private serverResources: Map<string, MCPResource[]> = new Map();
	private serverPrompts: Map<string, MCPPrompt[]> = new Map();
	private serverConfigs: Map<string, MCPServer> = new Map();
	private isConnected: boolean = false;
	private closing = new Set<string>();
	/**
	 * Bumped by disconnect(). A reconnect that was already awaiting
	 * connectToServer() when the client shut down compares epochs and tears
	 * down the connection it just made instead of resurrecting the server.
	 */
	private lifecycleEpoch = 0;
	private logger = getLogger();
	/** Health status, pings and reconnect backoff for every server. */
	private readonly healthMonitor: MCPHealthMonitor;

	/**
	 * @param options.timers Timer functions for health checks and reconnect
	 *   backoff; tests pass a fake clock.
	 */
	constructor(options: {timers?: HealthTimers} = {}) {
		this.healthMonitor = new MCPHealthMonitor(
			{
				isClosing: serverName => this.closing.has(serverName),
				getClient: serverName => this.clients.get(serverName),
				getConfig: serverName => this.serverConfigs.get(serverName),
				clearCatalog: serverName => this.clearServerCatalog(serverName),
				rediscover: (serverName, client) =>
					this.rediscoverServer(serverName, client),
				reconnect: config => this.connectToServer(config),
				forget: serverName => this.forgetServer(serverName),
				lifecycleEpoch: () => this.lifecycleEpoch,
			},
			options.timers,
		);
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

	onHealthChange(listener: (change: MCPHealthChange) => void): () => void {
		return this.healthMonitor.onChange(listener);
	}

	/** An unhealthy server offers nothing until it recovers. */
	private clearServerCatalog(serverName: string): void {
		this.serverTools.set(serverName, []);
		this.serverResources.set(serverName, []);
		this.serverPrompts.set(serverName, []);
		this.toolMappingCache = null;
	}

	/**
	 * Re-list tools, and the resources and prompts the server declares, on a
	 * client that answered again. Rejects if tools/list fails; a failed
	 * resources/prompts list only logs.
	 */
	private async rediscoverServer(
		serverName: string,
		client: Client,
	): Promise<number> {
		// Re-discover tools from this server
		const toolsResult = await client.listTools();
		const tools: MCPTool[] = toolsResult.tools.map(tool =>
			toMCPTool(tool, serverName),
		);
		this.serverTools.set(serverName, tools);

		// Re-discover resources if declared
		const capabilities = client.getServerCapabilities();
		if (capabilities?.resources) {
			try {
				const resourcesResult = await client.listResources();
				const resources: MCPResource[] = resourcesResult.resources.map(
					resource => toMCPResource(resource, serverName),
				);
				this.serverResources.set(serverName, resources);
			} catch (error) {
				this.logger.warn('MCP resources/list failed on recovery', {
					serverName,
					error: formatError(error),
				});
			}
		}

		// Re-discover prompts if declared
		if (capabilities?.prompts) {
			try {
				const promptsResult = await client.listPrompts();
				const prompts: MCPPrompt[] = promptsResult.prompts.map(prompt =>
					toMCPPrompt(prompt, serverName),
				);
				this.serverPrompts.set(serverName, prompts);
			} catch (error) {
				this.logger.warn('MCP prompts/list failed on recovery', {
					serverName,
					error: formatError(error),
				});
			}
		}

		this.toolMappingCache = null;
		return tools.length;
	}

	/** Close and drop one server's connection and all of its state. */
	private async forgetServer(serverName: string): Promise<void> {
		const client = this.clients.get(serverName);
		this.closing.add(serverName);
		this.healthMonitor.stop(serverName);
		try {
			await client?.close();
		} catch (error) {
			this.logger.debug('Error closing MCP client', {
				serverName,
				error: formatError(error),
			});
		}
		this.clients.delete(serverName);
		this.transports.delete(serverName);
		this.serverTools.delete(serverName);
		this.serverResources.delete(serverName);
		this.serverPrompts.delete(serverName);
		this.serverConfigs.delete(serverName);
		this.healthMonitor.forget(serverName);
		this.toolMappingCache = null;
		this.closing.delete(serverName);
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

				// `timeout` bounds the connection handshake (initialize) and the
				// initial tools/list; tool calls keep the SDK's own default.
				const connectOptions =
					typeof normalizedServer.timeout === 'number' &&
					normalizedServer.timeout > 0
						? {timeout: normalizedServer.timeout}
						: undefined;

				await client.connect(transport, connectOptions);

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
				const toolsResult = await client.listTools(undefined, connectOptions);
				const tools: MCPTool[] = toolsResult.tools.map(tool =>
					toMCPTool(tool, normalizedServer.name),
				);

				// Discovery is gated on the server's declared capabilities (available
				// on the Client only after connect() completes the handshake) rather
				// than attempted unconditionally, so a server that never advertises
				// resources/prompts doesn't pay for a doomed round trip on every
				// connect.
				const capabilities = client.getServerCapabilities();

				// List available resources from this server
				let resources: MCPResource[] = [];
				if (capabilities?.resources) {
					try {
						const resourcesResult = await client.listResources();
						resources = resourcesResult.resources.map(resource =>
							toMCPResource(resource, normalizedServer.name),
						);
						this.logger.debug('MCP resources discovered', {
							serverName: normalizedServer.name,
							resourceCount: resources.length,
						});
					} catch (error) {
						// Server declared the capability but the call still failed -
						// this is a genuine error, not an unsupported-feature guess.
						this.logger.warn(
							'MCP resources/list failed despite declared capability',
							{
								serverName: normalizedServer.name,
								error: formatError(error),
							},
						);
					}
				} else {
					this.logger.debug(
						'MCP server does not declare resources capability',
						{
							serverName: normalizedServer.name,
						},
					);
				}

				// List available prompts from this server
				let prompts: MCPPrompt[] = [];
				if (capabilities?.prompts) {
					try {
						const promptsResult = await client.listPrompts();
						prompts = promptsResult.prompts.map(prompt =>
							toMCPPrompt(prompt, normalizedServer.name),
						);
						this.logger.debug('MCP prompts discovered', {
							serverName: normalizedServer.name,
							promptCount: prompts.length,
						});
					} catch (error) {
						// Server declared the capability but the call still failed -
						// this is a genuine error, not an unsupported-feature guess.
						this.logger.warn(
							'MCP prompts/list failed despite declared capability',
							{
								serverName: normalizedServer.name,
								error: formatError(error),
							},
						);
					}
				} else {
					this.logger.debug('MCP server does not declare prompts capability', {
						serverName: normalizedServer.name,
					});
				}

				// Store client, transport, config, tools, resources, and prompts together only after
				// connection and discovery have both succeeded.
				this.clients.set(normalizedServer.name, client);
				this.transports.set(normalizedServer.name, transport);
				this.serverConfigs.set(normalizedServer.name, normalizedServer);
				this.serverTools.set(normalizedServer.name, tools);
				this.toolMappingCache = null;
				const shadowed = this.getToolNameConflicts().filter(conflict =>
					conflict.servers.includes(normalizedServer.name),
				);
				if (shadowed.length > 0) {
					this.logger.warn('MCP tool names shared by more than one server', {
						serverName: normalizedServer.name,
						conflicts: shadowed,
					});
				}
				this.serverResources.set(normalizedServer.name, resources);
				this.serverPrompts.set(normalizedServer.name, prompts);
				this.healthMonitor.setStatus(normalizedServer.name, 'connected');
				const healthInterval = normalizedServer.healthCheckInterval ?? 30_000;
				this.healthMonitor.watch(
					normalizedServer.name,
					client,
					transport as LifecycleTransport,
					healthInterval,
					connectOptions,
				);

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
				tools.push(toFunctionTool(serverName, mcpTool));
			}
		}

		return tools;
	}

	/**
	 * Tool names exposed by more than one connected server. Tools are keyed by
	 * name, so only one of them is callable: the server connected last (later
	 * in `serverTools` order) handles every call to that name.
	 */
	getToolNameConflicts(): MCPToolNameConflict[] {
		return findToolNameConflicts(this.serverTools);
	}

	/**
	 * Get all MCP tools as AI SDK native CoreTool format
	 * Converts MCP tool schemas to AI SDK's tool() format
	 */
	getNativeToolsRegistry(): Record<string, AISDKCoreTool> {
		const nativeTools: Record<string, AISDKCoreTool> = {};

		for (const [serverName, serverTools] of this.serverTools.entries()) {
			for (const mcpTool of serverTools) {
				const toolName = mcpTool.name;
				nativeTools[toolName] = toNativeTool(
					serverName,
					mcpTool,
					(input, options) => this.callTool(toolName, input, options),
				);
			}
		}

		return nativeTools;
	}

	/**
	 * Map every discovered tool name to the server that owns it, plus the
	 * server's `readOnlyHint` for that tool.
	 *
	 * `readOnly` here is the raw, untrusted server hint. It lives on this
	 * mapping rather than on the registered tool entry on purpose: an entry's
	 * `readOnly` flag is consumed by `ToolManager.isReadOnly`, which also
	 * decides whether ACP captures a checkpoint before the call
	 * (`acp-timeline.ts`) and whether the tool joins a parallel batch
	 * (`tool-executor.tsx`). A server must not be able to talk itself out of a
	 * restore point, so the hint is confined to plan-mode availability, which
	 * is the only thing `docs/features/development-modes.md` promises it does.
	 *
	 * The result is memoised and returned by reference — treat it as read-only.
	 * All callers only look tools up (`get`/`has`); mutating it would corrupt
	 * the cache for everyone else until the next connect/disconnect.
	 */
	getToolMapping(): MCPToolMapping {
		if (this.toolMappingCache) {
			return this.toolMappingCache;
		}

		const mapping = buildToolMapping(this.serverTools);
		this.toolMappingCache = mapping;
		return mapping;
	}

	/**
	 * Get all MCP tools as entries with handlers for easy registration.
	 * Each entry carries the AI SDK tool definition, its validated handler
	 * and its approval policy (see createMCPToolApproval), so ToolManager can
	 * register it like any other tool.
	 */
	getToolEntries(forServerName?: string): MCPToolEntry[] {
		const entries: MCPToolEntry[] = [];

		// Get native tools once to avoid redundant calls
		const nativeTools = this.getNativeToolsRegistry();

		for (const [serverName, serverTools] of this.serverTools.entries()) {
			if (forServerName && serverName !== forServerName) continue;
			for (const mcpTool of serverTools) {
				const toolName = mcpTool.name;

				// Get the AI SDK native tool
				const coreTool = nativeTools[toolName];

				if (coreTool) {
					const handler = createValidatedHandler(coreTool, (args, options) =>
						this.callTool(toolName, args, options),
					);
					const approval = createMCPToolApproval({
						readOnly: mcpTool.readOnly === true,
						autoApproved: isToolAutoApproved(
							this.serverConfigs.get(serverName),
							toolName,
						),
					});

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

	private getHealthyClient(serverName: string): Client {
		const client = this.clients.get(serverName);
		if (!client) {
			throw new Error(`No MCP client connected for server: ${serverName}`);
		}
		if (this.healthMonitor.getStatus(serverName) === 'unhealthy') {
			throw new Error(
				`MCP server is unhealthy: ${serverName}: ${
					this.healthMonitor.getError(serverName) || 'health check failed'
				}`,
			);
		}
		return client;
	}

	async callTool(
		toolName: string,
		args: Record<string, unknown>,
		options?: {abortSignal?: AbortSignal},
	): Promise<string | StructuredToolOutput> {
		// First, try to find which server has this tool
		const toolMapping = this.getToolMapping();
		const mapping = toolMapping.get(toolName);

		if (!mapping) {
			// Fallback: try parsing as prefixed name (mcp_serverName_toolName) for backward compatibility
			const parts = toolName.split('_');
			if (parts.length >= 3 && parts[0] === 'mcp' && parts[1]) {
				const serverName = parts[1];
				const originalToolName = parts.slice(2).join('_');
				const fallbackClient = this.getHealthyClient(serverName);
				return this.healthMonitor.trackInFlight(serverName, () =>
					this.executeToolCall(
						fallbackClient,
						originalToolName,
						args,
						options?.abortSignal,
					),
				);
			}
			throw new Error(`MCP tool not found: ${toolName}`);
		}

		const client = this.getHealthyClient(mapping.serverName);

		// Sanitize arguments: If schema expects a string but we got an object, ensureString it.
		const serverTools = this.serverTools.get(mapping.serverName) || [];
		const toolDef = serverTools.find(t => t.name === mapping.originalName);
		const sanitizedArgs = coerceStringArguments(toolDef, args);

		return this.healthMonitor.trackInFlight(mapping.serverName, () =>
			this.executeToolCall(
				client,
				mapping.originalName,
				sanitizedArgs,
				options?.abortSignal,
			),
		);
	}

	private async executeToolCall(
		client: Client,
		toolName: string,
		args: Record<string, unknown>,
		abortSignal?: AbortSignal,
	): Promise<string | StructuredToolOutput> {
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
				const params = {
					name: toolName,
					arguments: args,
				};
				const result = abortSignal
					? await client.callTool(params, undefined, {signal: abortSignal})
					: await client.callTool(params);

				this.logger.debug('MCP tool executed successfully', {
					toolName,
					hasContent: !!result.content,
					contentLength: Array.isArray(result.content)
						? result.content.length
						: 0,
					correlationId,
				});

				// A server reports a failed call with `isError: true` and the reason
				// in `content`. The text stays exactly what it was; the flag rides
				// alongside it so processToolUse can mark the call failed.
				const output = (text: string): string | StructuredToolOutput =>
					result.isError === true ? {llmContent: text, isError: true} : text;

				// Convert result content to string
				if (
					result.content &&
					Array.isArray(result.content) &&
					result.content.length > 0
				) {
					const responseText = formatToolResultContent(result.content);

					const finalMetrics = endMetrics(metrics);
					this.logger.info('MCP tool execution completed', {
						toolName,
						blockCount: result.content.length,
						responseLength: responseText.length,
						duration: `${finalMetrics.duration.toFixed(2)}ms`,
						correlationId,
					});

					return output(responseText);
				}

				const finalMetrics = endMetrics(metrics);
				this.logger.info('MCP tool execution completed (no output)', {
					toolName,
					duration: `${finalMetrics.duration.toFixed(2)}ms`,
					correlationId,
				});

				return output('Tool executed successfully (no output)');
			} catch (error) {
				const finalMetrics = endMetrics(metrics);
				if (abortSignal?.aborted) {
					this.logger.debug('MCP tool execution cancelled', {
						toolName,
						duration: `${finalMetrics.duration.toFixed(2)}ms`,
						correlationId,
					});
					throw error;
				}

				const errorMessage = formatError(error);
				const errorName = error instanceof Error ? error.name : 'Unknown';

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
				health: MCPHealthStatus;
				healthError?: string;
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
			connected: this.healthMonitor.getStatus(serverName) !== 'unhealthy',
			health: this.healthMonitor.getStatus(serverName) || 'connected',
			healthError: this.healthMonitor.getError(serverName),
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

			const client = this.getHealthyClient(serverName);

			try {
				const result = await this.healthMonitor.trackInFlight(serverName, () =>
					client.readResource({uri}),
				);

				const contents = toResourceContents(result.contents);

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

			const client = this.getHealthyClient(serverName);

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

				return toPromptResult(result);
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
		this.lifecycleEpoch++;

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
				this.closing.add(serverName);
				this.healthMonitor.stop(serverName);
				this.healthMonitor.clearCheckState(serverName);
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
				this.closing.delete(serverName);
			}

			this.clients.clear();
			this.transports.clear();
			this.serverTools.clear();
			this.toolMappingCache = null;
			this.serverResources.clear();
			this.serverPrompts.clear();
			this.serverConfigs.clear();
			this.healthMonitor.reset();
			this.closing.clear();
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
		return Array.from(this.clients.keys()).filter(
			serverName => this.healthMonitor.getStatus(serverName) !== 'unhealthy',
		);
	}

	getServerNames(): string[] {
		return Array.from(this.clients.keys());
	}

	isServerConnected(serverName: string): boolean {
		return (
			this.clients.has(serverName) &&
			this.healthMonitor.getStatus(serverName) !== 'unhealthy'
		);
	}

	getServerTools(serverName: string): MCPTool[] {
		return this.serverTools.get(serverName) || [];
	}

	/**
	 * Returns all discovered MCP tools across all connected servers.
	 */
	getAllDiscoveredTools(): MCPTool[] {
		const result: MCPTool[] = [];
		for (const tools of this.serverTools.values()) {
			result.push(...tools);
		}
		return result;
	}
}
