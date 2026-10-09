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

type LifecycleTransport = ClientTransport & {
	onclose?: () => void;
	onerror?: (error: Error) => void;
};

import {dynamicTool} from 'ai';
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
import {getToolJsonSchema} from '@/utils/schema-validate';
import {withValidation} from '@/utils/tool-validation';
import {ensureString, isPlainObject} from '@/utils/type-helpers';
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
	private toolMappingCache: Map<
		string,
		{serverName: string; originalName: string; readOnly: boolean}
	> | null = null;
	private serverResources: Map<string, MCPResource[]> = new Map();
	private serverPrompts: Map<string, MCPPrompt[]> = new Map();
	private serverConfigs: Map<string, MCPServer> = new Map();
	private isConnected: boolean = false;
	private health: Map<string, MCPHealthStatus> = new Map();
	private healthErrors: Map<string, string> = new Map();
	private healthTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
	private healthChecksInFlight = new Set<string>();
	private healthListeners = new Set<(change: MCPHealthChange) => void>();
	private closing = new Set<string>();
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

	onHealthChange(listener: (change: MCPHealthChange) => void): () => void {
		this.healthListeners.add(listener);
		return () => this.healthListeners.delete(listener);
	}

	private emitHealthChange(change: MCPHealthChange): void {
		for (const listener of this.healthListeners) listener(change);
	}

	private setServerHealth(
		serverName: string,
		status: MCPHealthStatus,
		error?: unknown,
	): void {
		const errorMessage = error ? formatError(error) : undefined;
		const previousStatus = this.health.get(serverName);
		const previousError = this.healthErrors.get(serverName);
		this.health.set(serverName, status);
		if (errorMessage) this.healthErrors.set(serverName, errorMessage);
		else this.healthErrors.delete(serverName);
		if (previousStatus === undefined && status === 'connected') return;
		if (previousStatus === status && previousError === errorMessage) return;
		this.emitHealthChange({serverName, status, error: errorMessage});
	}

	private markServerUnhealthy(serverName: string, error?: unknown): void {
		if (this.closing.has(serverName)) return;
		this.setServerHealth(serverName, 'unhealthy', error);
		this.serverTools.set(serverName, []);
		this.serverResources.set(serverName, []);
		this.serverPrompts.set(serverName, []);
		this.toolMappingCache = null;
	}

	private isLivenessResponse(error: unknown): boolean {
		if (!error || typeof error !== 'object') return false;
		const code = (error as {code?: number}).code;
		// JSON-RPC MethodNotFound (-32601) means the server received the ping and responded
		return code === -32601;
	}

	private async restoreServerHealth(
		serverName: string,
		client: Client,
	): Promise<void> {
		if (this.closing.has(serverName)) return;

		try {
			// Re-discover tools from this server
			const toolsResult = await client.listTools();
			const tools: MCPTool[] = toolsResult.tools.map(tool => ({
				name: tool.name,
				description: tool.description || undefined,
				inputSchema: isPlainObject(tool.inputSchema)
					? (tool.inputSchema as MCPToolInputSchema)
					: undefined,
				serverName,
				readOnly: tool.annotations?.readOnlyHint === true,
			}));
			this.serverTools.set(serverName, tools);

			// Re-discover resources if declared
			const capabilities = client.getServerCapabilities();
			if (capabilities?.resources) {
				try {
					const resourcesResult = await client.listResources();
					const resources: MCPResource[] = resourcesResult.resources.map(
						resource => ({
							uri: resource.uri,
							name: resource.name,
							description: resource.description || undefined,
							mimeType: resource.mimeType || undefined,
							serverName,
						}),
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
					const prompts: MCPPrompt[] = promptsResult.prompts.map(prompt => ({
						name: prompt.name,
						description: prompt.description || undefined,
						arguments: prompt.arguments?.map(arg => ({
							name: arg.name,
							description: arg.description || undefined,
							required: arg.required || false,
						})),
						serverName,
					}));
					this.serverPrompts.set(serverName, prompts);
				} catch (error) {
					this.logger.warn('MCP prompts/list failed on recovery', {
						serverName,
						error: formatError(error),
					});
				}
			}

			this.toolMappingCache = null;
			this.setServerHealth(serverName, 'connected');
			this.logger.info(
				`MCP server "${serverName}" recovered and restored tools`,
				{
					serverName,
					toolCount: tools.length,
				},
			);
		} catch (error) {
			this.logger.warn(
				`Failed to rediscover tools for recovered MCP server "${serverName}"`,
				{
					serverName,
					error: formatError(error),
				},
			);
		}
	}

	private startHealthChecks(
		serverName: string,
		client: Client,
		transport: LifecycleTransport,
		interval: number,
		pingOptions?: {timeout: number},
	): void {
		const markUnhealthy = (error?: unknown) =>
			this.markServerUnhealthy(serverName, error);
		const check = async () => {
			const currentStatus = this.health.get(serverName);
			if (
				this.closing.has(serverName) ||
				(currentStatus !== 'connected' && currentStatus !== 'unhealthy') ||
				this.healthChecksInFlight.has(serverName) ||
				typeof client.ping !== 'function'
			) {
				return;
			}
			this.healthChecksInFlight.add(serverName);
			try {
				await client.ping(pingOptions ?? {timeout: 10_000});
				if (this.health.get(serverName) === 'unhealthy') {
					await this.restoreServerHealth(serverName, client);
				}
			} catch (error) {
				if (this.isLivenessResponse(error)) {
					if (this.health.get(serverName) === 'unhealthy') {
						await this.restoreServerHealth(serverName, client);
					}
				} else {
					// A pending ping can reject after an intentional disconnect.
					if (this.health.get(serverName) === 'connected') {
						markUnhealthy(error);
					}
				}
			} finally {
				this.healthChecksInFlight.delete(serverName);
			}
		};
		const previousOnClose = transport.onclose;
		const previousOnError = transport.onerror;
		transport.onclose = () => {
			try {
				previousOnClose?.();
			} finally {
				markUnhealthy(new Error('MCP transport closed'));
			}
		};
		transport.onerror = error => {
			try {
				previousOnError?.(error);
			} finally {
				// HTTP/SSE errors can be recoverable; let the SDK handle the error
				// before confirming liveness with a bounded ping. Deferring also
				// prevents a ping's own transport error from starting another ping.
				void Promise.resolve().then(check);
			}
		};
		if (interval <= 0 || typeof client.ping !== 'function') return;
		const timer = setInterval(() => void check(), interval);
		if (typeof timer === 'object' && 'unref' in timer) timer.unref();
		this.healthTimers.set(serverName, timer);
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
				const tools: MCPTool[] = toolsResult.tools.map(tool => ({
					name: tool.name,
					description: tool.description || undefined,
					// MCP SDK types inputSchema as Record<string, object>; validate at protocol boundary
					// before trusting the shape as JSONSchema7
					inputSchema: isPlainObject(tool.inputSchema)
						? (tool.inputSchema as MCPToolInputSchema)
						: undefined,
					serverName: normalizedServer.name,
					readOnly: tool.annotations?.readOnlyHint === true,
				}));

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
				this.serverResources.set(normalizedServer.name, resources);
				this.serverPrompts.set(normalizedServer.name, prompts);
				this.setServerHealth(normalizedServer.name, 'connected');
				const healthInterval = normalizedServer.healthCheckInterval ?? 30_000;
				this.startHealthChecks(
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
	getToolMapping(): Map<
		string,
		{serverName: string; originalName: string; readOnly: boolean}
	> {
		if (this.toolMappingCache) {
			return this.toolMappingCache;
		}

		const mapping = new Map<
			string,
			{serverName: string; originalName: string; readOnly: boolean}
		>();

		for (const [serverName, serverTools] of this.serverTools.entries()) {
			for (const mcpTool of serverTools) {
				mapping.set(mcpTool.name, {
					serverName,
					originalName: mcpTool.name,
					readOnly: mcpTool.readOnly === true,
				});
			}
		}

		this.toolMappingCache = mapping;
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
	getToolEntries(forServerName?: string): Array<{
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
			if (forServerName && serverName !== forServerName) continue;
			for (const mcpTool of serverTools) {
				const toolName = mcpTool.name;

				// Get the AI SDK native tool
				const coreTool = nativeTools[toolName];

				if (coreTool) {
					// Run the same lenient schema type-check the approval prompt
					// renders (tool-confirmation → getToolJsonSchema), so a
					// malformed call is rejected locally — it never reaches the
					// server, and approving a "wrong type" call no longer silently
					// skips the schema gate. No per-tool validator exists for MCP;
					// the server remains the authority on value constraints.
					const handler = withValidation(
						async (args: Record<string, unknown>) => {
							return this.callTool(toolName, args);
						},
						undefined,
						getToolJsonSchema(coreTool),
						// The wrapper types its result as the generic
						// ToolExecuteResult union; MCP handlers always resolve a
						// string, so the narrower entry signature is safe here.
					) as (args: Record<string, unknown>) => Promise<string>;

					// MCP tools take the same mode posture as built-in tools:
					//   - auto-accept and headless both run unattended — headless is
					//     daemon-driven, so there is no foreground prompt to answer
					//     (mirrors createFileToolApproval in @/utils/tool-approval);
					//   - plan inspects without side effects, so a server's
					//     alwaysAllow entry must not short-circuit it; only a
					//     server-annotated reader is safe to run there;
					//   - normal prompts unless alwaysAllow covers the tool.
					// readOnly deliberately does NOT skip approval in normal mode:
					// `readOnlyHint` is a hint supplied by the very server being
					// gated, so it must not be able to silence its own prompt.
					// alwaysAllow — set by the user, not the server — stays the only
					// way to skip a normal-mode prompt, exactly as
					// docs/configuration/mcp-configuration.md describes.
					// (Yolo is bypassed centrally by resolveToolApproval.)
					//
					// For the same reason the hint is not copied onto the entry as
					// `readOnly`: that field feeds ToolManager.isReadOnly, which
					// gates ACP checkpoint capture and parallel batching. It stays
					// on getToolMapping(), which only plan-mode filtering reads.
					const readOnly = mcpTool.readOnly === true;
					const isAutoApproved = this.isToolAutoApproved(toolName, serverName);
					const approval: ToolApprovalPolicy = (_args, mode) => {
						if (mode === 'auto-accept' || mode === 'headless') return false;
						if (mode === 'plan') return !readOnly;
						return !isAutoApproved;
					};

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
		if (this.health.get(serverName) === 'unhealthy') {
			throw new Error(
				`MCP server is unhealthy: ${serverName}: ${
					this.healthErrors.get(serverName) || 'health check failed'
				}`,
			);
		}
		return client;
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
				return this.executeToolCall(
					this.getHealthyClient(serverName),
					originalToolName,
					args,
				);
			}
			throw new Error(`MCP tool not found: ${toolName}`);
		}

		const client = this.getHealthyClient(mapping.serverName);

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
			connected: this.health.get(serverName) !== 'unhealthy',
			health: this.health.get(serverName) || 'connected',
			healthError: this.healthErrors.get(serverName),
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
				this.closing.add(serverName);
				const timer = this.healthTimers.get(serverName);
				if (timer) clearInterval(timer);
				this.healthTimers.delete(serverName);
				this.healthChecksInFlight.delete(serverName);
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
			this.health.clear();
			this.healthErrors.clear();
			this.healthChecksInFlight.clear();
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
			serverName => this.health.get(serverName) !== 'unhealthy',
		);
	}

	getServerNames(): string[] {
		return Array.from(this.clients.keys());
	}

	isServerConnected(serverName: string): boolean {
		return (
			this.clients.has(serverName) &&
			this.health.get(serverName) !== 'unhealthy'
		);
	}

	getServerTools(serverName: string): MCPTool[] {
		return this.serverTools.get(serverName) || [];
	}
}
