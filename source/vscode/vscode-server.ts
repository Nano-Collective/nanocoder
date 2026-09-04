/**
 * WebSocket server for VS Code extension communication
 */

import {readFile} from 'node:fs/promises';
import {randomUUID} from 'crypto';
import {WebSocket, WebSocketServer} from 'ws';
import {BoundedMap} from '@/utils/bounded-map';
import {formatError} from '@/utils/error-formatter';
import {getLogger} from '@/utils/logging';
import {getShutdownManager} from '@/utils/shutdown';
import {
	clearDiscoveryFile,
	generateServerToken,
	getDiscoveryFilePath,
	ServerDiscovery,
	safeEqualToken,
	writeDiscoveryFile,
} from './discovery';
import {
	AssistantMessage,
	ClientMessage,
	CloseDiffMessage,
	ConnectionAckMessage,
	DEFAULT_PORT,
	DiagnosticInfo,
	DiagnosticsRequestMessage,
	FileChangeMessage,
	OpenFileMessage,
	PendingChange,
	PROTOCOL_VERSION,
	ServerMessage,
	StatusMessage,
} from './protocol';

export interface ActiveEditorState {
	filePath?: string;
	fileName?: string;
	selection?: string;
	startLine?: number;
	endLine?: number;
}

let cachedCliVersion: string | null = null;

async function getCliVersion(): Promise<string> {
	if (cachedCliVersion) {
		return cachedCliVersion;
	}

	try {
		const content = await readFile(
			new URL('../../package.json', import.meta.url),
			'utf-8',
		);
		const packageJson = JSON.parse(content) as {version?: string};
		cachedCliVersion = packageJson.version ?? '0.0.0';
		return cachedCliVersion;
	} catch (error) {
		console.warn('Failed to load CLI version from package.json:', error);
		cachedCliVersion = '0.0.0';
		return cachedCliVersion;
	}
}

export type MessageHandler = (message: ClientMessage) => void;
export type PromptHandler = (
	prompt: string,
	context?: {
		filePath?: string;
		selection?: string;
		cursorPosition?: {line: number; character: number};
	},
) => void;

export interface VSCodeServerCallbacks {
	onPrompt?: PromptHandler;
	onChangeApplied?: (id: string) => void;
	onChangeRejected?: (id: string) => void;
	onContext?: (context: {
		workspaceFolder?: string;
		openFiles?: string[];
		activeFile?: string;
		diagnostics?: DiagnosticInfo[];
	}) => void;
	onDiagnosticsResponse?: (diagnostics: DiagnosticInfo[]) => void;
	onActiveEditor?: (state: ActiveEditorState) => void;
	onConnect?: () => void;
	onDisconnect?: () => void;
}

/**
 * Options bag for {@link VSCodeServer}.
 *
 * `token` is normally generated internally so callers do not have to think
 * about it. Tests and integrators that want to drive a deterministic value
 * (e.g. to share it with a synthetic client) may pass one explicitly.
 */
export interface VSCodeServerOptions {
	token?: string;
	/** Override the discovery-file location; defaults to {@link getConfigPath}. */
	discoveryFilePath?: string;
}

export class VSCodeServer {
	private wss: WebSocketServer | null = null;
	private clients: Set<WebSocket> = new Set();
	private pendingChanges: BoundedMap<string, PendingChange> = new BoundedMap({
		maxSize: 1000,
		ttl: 30 * 60 * 1000, // 30 minutes
	});
	private callbacks: VSCodeServerCallbacks = {};
	private currentModel?: string;
	private currentProvider?: string;
	private cliVersion: string = '0.0.0';
	private port: number;
	private readonly token: string;
	private readonly ephemeral: boolean;
	private discoveryFilePath: string | null = null;

	constructor(port: number = DEFAULT_PORT, options: VSCodeServerOptions = {}) {
		this.port = port;
		this.token = options.token ?? generateServerToken();
		// Port 0 is the conventional way to ask the kernel for a free port.
		this.ephemeral = port === 0;
	}

	/**
	 * Get the actual port the server is listening on
	 */
	getPort(): number {
		return this.port;
	}

	/**
	 * Get the per-session bearer token. Anything that wants to talk to this
	 * server must present this token in the WebSocket upgrade request.
	 */
	getToken(): string {
		return this.token;
	}

	/**
	 * Whether this instance was started in ephemeral-port mode (port 0), in
	 * which case the resolved port is published through the discovery file.
	 */
	isEphemeral(): boolean {
		return this.ephemeral;
	}

	/**
	 * Get the path to the discovery file once the server is running, or null
	 * when no file has been written yet.
	 */
	getDiscoveryFilePath(): string | null {
		return this.discoveryFilePath;
	}

	/**
	 * Extract the bearer token from a WebSocket upgrade URL. Accepts it as
	 * the `?token=...` query parameter. Headers are inspected separately.
	 */
	private extractTokenFromUrl(url: string | undefined): string | null {
		if (!url) return null;
		const queryIndex = url.indexOf('?');
		if (queryIndex === -1) return null;
		const query = url.slice(queryIndex + 1);
		for (const pair of query.split('&')) {
			const eq = pair.indexOf('=');
			if (eq === -1) continue;
			const key = pair.slice(0, eq);
			if (key !== 'token') continue;
			let value = pair.slice(eq + 1);
			try {
				value = decodeURIComponent(value);
			} catch {
				// Leave the value as-is; safeEqualToken will just reject it.
			}
			return value;
		}
		return null;
	}

	/**
	 * verifyClient hook for the underlying `ws` server. Enforces:
	 *   1. No `Origin` header — a browser tab is the only thing that would
	 *      send one, and our legitimate client is a Node `ws` connection.
	 *   2. A token query-string parameter (`?token=...`) that matches the
	 *      one we minted at startup, compared in constant time.
	 *
	 * Returning `false` causes `ws` to send a 401 close, before the
	 * handshake completes. Returning `true` accepts the upgrade.
	 */
	private verifyClient(info: {
		origin: string | undefined;
		secure: boolean;
		req: {url?: string};
	}): boolean {
		if (info.origin) {
			getLogger().warn(
				{origin: info.origin},
				'Rejected VS Code companion connection: Origin header is not allowed',
			);
			return false;
		}

		const provided = this.extractTokenFromUrl(info.req.url);
		if (!provided) {
			getLogger().warn('Rejected VS Code companion connection: missing token');
			return false;
		}

		if (!safeEqualToken(provided, this.token)) {
			getLogger().warn('Rejected VS Code companion connection: token mismatch');
			return false;
		}

		return true;
	}

	/**
	 * Try to start the WebSocket server on a specific port. Pass `port = 0`
	 * to bind an ephemeral port and let the kernel pick the actual number.
	 */
	private async tryStartOnPort(port: number): Promise<boolean> {
		return new Promise(resolve => {
			try {
				const wss = new WebSocketServer({
					port,
					host: '127.0.0.1', // Only accept local connections
					verifyClient: (info: {
						origin: string | undefined;
						secure: boolean;
						req: {url?: string};
					}) => this.verifyClient(info),
				});

				wss.on('listening', () => {
					const address = wss.address();
					// `wss.address()` returns either a string (unix socket) or
					// an AddressInfo. Anything else is not a real bind.
					if (address && typeof address === 'object' && 'port' in address) {
						this.port = address.port;
					} else {
						this.port = port;
					}
					this.wss = wss;

					this.wss.on('connection', ws => {
						this.handleConnection(ws);
					});

					resolve(true);
				});

				wss.on('error', _error => {
					wss.close();
					resolve(false);
				});
			} catch (_error) {
				resolve(false);
			}
		});
	}

	/**
	 * Start the WebSocket server.
	 *
	 * If the configured port is `0`, the OS picks a free port and the
	 * resolved port is published to a per-session discovery file. Otherwise
	 * the requested port is honoured, with up to 10 fallback ports tried on
	 * EADDRINUSE. Token authentication and the no-Origin-header rule apply
	 * in both modes.
	 */
	async start(): Promise<boolean> {
		this.cliVersion = await getCliVersion();

		const logger = getLogger();
		const requestedPort = this.port;

		// Ephemeral mode: ask the kernel for a free port and trust it. The
		// old 10-port scan is gone because collisions are no longer possible.
		if (this.ephemeral) {
			const success = await this.tryStartOnPort(0);
			if (success) {
				logger.info(`VS Code server listening on ephemeral port ${this.port}`);
				await this.publishDiscovery();
				return true;
			}
			logger.error('Failed to start VS Code server on an ephemeral port');
			console.error('[VS Code] Could not start server on an ephemeral port.');
			return false;
		}

		// Explicit-port mode: try the requested port, then up to 10 alternatives.
		const maxRetries = 10;
		const success = await this.tryStartOnPort(requestedPort);
		if (success) {
			logger.info(`VS Code server listening on port ${this.port}`);
			// Even in explicit-port mode, write the discovery file so the
			// extension can pick up the token without the user having to copy
			// it manually.
			await this.publishDiscovery();
			return true;
		}

		logger.warn(`Port ${requestedPort} is in use, trying alternative ports...`);

		for (let i = 1; i <= maxRetries; i++) {
			const alternativePort = requestedPort + i;
			const success = await this.tryStartOnPort(alternativePort);
			if (success) {
				logger.info(
					`VS Code server listening on port ${this.port} (requested ${requestedPort} was in use)`,
				);
				await this.publishDiscovery();
				return true;
			}
		}

		logger.error(
			`Failed to start VS Code server. Tried ports ${requestedPort}-${requestedPort + maxRetries}`,
		);
		console.error(
			`[VS Code] Could not start server. Ports ${requestedPort}-${requestedPort + maxRetries} are all in use.`,
		);
		console.error(
			'[VS Code] Try closing other nanocoder instances or VS Code windows.',
		);
		return false;
	}

	private async publishDiscovery(): Promise<void> {
		try {
			const filePath = getDiscoveryFilePath();
			const info: ServerDiscovery = {
				version: 1,
				port: this.port,
				token: this.token,
				pid: process.pid,
				cliVersion: this.cliVersion,
				startedAt: Date.now(),
			};
			await writeDiscoveryFile(filePath, info);
			this.discoveryFilePath = filePath;
			getLogger().info(
				{filePath, port: this.port},
				'Wrote VS Code companion discovery file',
			);
		} catch (error) {
			// Discovery file is a best-effort convenience for the extension.
			// The connection will still be authenticated (the extension can
			// be configured to provide the token manually), so do not fail
			// the server start.
			getLogger().error(
				{error: formatError(error)},
				'Failed to write VS Code companion discovery file',
			);
		}
	}

	private async unpublishDiscovery(): Promise<void> {
		const filePath = this.discoveryFilePath;
		if (!filePath) return;
		try {
			await clearDiscoveryFile(filePath);
			getLogger().info({filePath}, 'Cleared VS Code companion discovery file');
		} catch (error) {
			getLogger().error(
				{error: formatError(error)},
				'Failed to clear VS Code companion discovery file',
			);
		} finally {
			this.discoveryFilePath = null;
		}
	}

	/**
	 * Stop the WebSocket server
	 */
	async stop(): Promise<void> {
		// Close all client connections
		for (const client of this.clients) {
			client.close();
		}
		this.clients.clear();

		// Always remove the discovery file before the server actually closes.
		// If we crash mid-stop, the next start() will overwrite the stale entry.
		await this.unpublishDiscovery();

		// Close server
		return new Promise(resolve => {
			if (this.wss) {
				this.wss.close(() => {
					this.wss = null;
					resolve();
				});
			} else {
				resolve();
			}
		});
	}

	/**
	 * Register callbacks for client messages
	 */
	onCallbacks(callbacks: VSCodeServerCallbacks): void {
		this.callbacks = {...this.callbacks, ...callbacks};
	}

	/**
	 * Check if any clients are connected
	 */
	hasConnections(): boolean {
		return this.clients.size > 0;
	}

	/**
	 * Get number of connected clients
	 */
	getConnectionCount(): number {
		return this.clients.size;
	}

	/**
	 * Send a file change notification to VS Code
	 */
	sendFileChange(
		filePath: string,
		originalContent: string,
		newContent: string,
		toolName: string,
		toolArgs: Record<string, unknown>,
	): string {
		const id = randomUUID();

		// Store pending change
		this.pendingChanges.set(id, {
			id,
			filePath,
			originalContent,
			newContent,
			toolName,
			timestamp: Date.now(),
		});

		const message: FileChangeMessage = {
			type: 'file_change',
			id,
			filePath,
			originalContent,
			newContent,
			toolName,
			toolArgs,
		};

		this.broadcast(message);
		return id;
	}

	/**
	 * Send an assistant message to VS Code
	 */
	sendAssistantMessage(content: string, isGenerating: boolean = false): void {
		const message: AssistantMessage = {
			type: 'assistant_message',
			content,
			isGenerating,
		};
		this.broadcast(message);
	}

	/**
	 * Send status update to VS Code
	 */
	sendStatus(model?: string, provider?: string): void {
		this.currentModel = model;
		this.currentProvider = provider;

		const message: StatusMessage = {
			type: 'status',
			connected: true,
			model,
			provider,
			workingDirectory: process.cwd(),
		};
		this.broadcast(message);
	}

	/**
	 * Request diagnostics from VS Code
	 */
	requestDiagnostics(filePath?: string): void {
		const message: DiagnosticsRequestMessage = {
			type: 'diagnostics_request',
			filePath,
		};
		this.broadcast(message);
	}

	/**
	 * Close diff preview in VS Code (when tool is confirmed/rejected in CLI)
	 */
	closeDiff(id: string): void {
		const message: CloseDiffMessage = {
			type: 'close_diff',
			id,
		};
		this.broadcast(message);
		// Also remove from pending changes
		this.pendingChanges.delete(id);
	}

	/**
	 * Close all pending diff previews
	 */
	closeAllDiffs(): void {
		const pendingIds = Array.from(this.pendingChanges.keys());
		for (const id of pendingIds) {
			this.closeDiff(id);
		}
	}

	/**
	 * Open a file in VS Code editor
	 */
	openFileInVSCode(filePath: string): void {
		const message: OpenFileMessage = {
			type: 'open_file',
			filePath,
		};
		this.broadcast(message);
	}

	/**
	 * Get a pending change by ID
	 */
	getPendingChange(id: string): PendingChange | undefined {
		return this.pendingChanges.get(id);
	}

	/**
	 * Remove a pending change
	 */
	removePendingChange(id: string): void {
		this.pendingChanges.delete(id);
	}

	/**
	 * Get all pending changes
	 */
	getAllPendingChanges(): PendingChange[] {
		return Array.from(this.pendingChanges.values());
	}

	private handleConnection(ws: WebSocket): void {
		this.clients.add(ws);

		// Send connection acknowledgment
		const ack: ConnectionAckMessage = {
			type: 'connection_ack',
			protocolVersion: PROTOCOL_VERSION,
			cliVersion: this.cliVersion,
		};
		ws.send(JSON.stringify(ack));

		// Send current status
		if (this.currentModel || this.currentProvider) {
			this.sendStatus(this.currentModel, this.currentProvider);
		}

		// Notify callback
		this.callbacks.onConnect?.();

		ws.on('message', (data: {toString(): string}) => {
			try {
				const message = JSON.parse(data.toString()) as ClientMessage;
				this.handleMessage(message);
			} catch (error) {
				const logger = getLogger();
				logger.error(
					{error: formatError(error)},
					'Failed to parse message from VS Code',
				);
			}
		});

		ws.on('close', () => {
			this.clients.delete(ws);
			this.callbacks.onDisconnect?.();
		});

		ws.on('error', _error => {
			this.clients.delete(ws);
		});
	}

	private handleMessage(message: ClientMessage): void {
		switch (message.type) {
			case 'send_prompt':
				this.callbacks.onPrompt?.(message.prompt, message.context);
				break;

			case 'apply_change':
				this.pendingChanges.delete(message.id);
				this.callbacks.onChangeApplied?.(message.id);
				break;

			case 'reject_change':
				this.pendingChanges.delete(message.id);
				this.callbacks.onChangeRejected?.(message.id);
				break;

			case 'get_status':
				this.sendStatus(this.currentModel, this.currentProvider);
				break;

			case 'context':
				this.callbacks.onContext?.({
					workspaceFolder: message.workspaceFolder,
					openFiles: message.openFiles,
					activeFile: message.activeFile,
					diagnostics: message.diagnostics,
				});
				break;

			case 'diagnostics_response':
				this.callbacks.onDiagnosticsResponse?.(message.diagnostics);
				break;

			case 'active_editor':
				this.callbacks.onActiveEditor?.({
					filePath: message.filePath,
					fileName: message.fileName,
					selection: message.selection,
					startLine: message.startLine,
					endLine: message.endLine,
				});
				break;
		}
	}

	private broadcast(message: ServerMessage): void {
		const data = JSON.stringify(message);
		for (const client of this.clients) {
			if (client.readyState === WebSocket.OPEN) {
				client.send(data);
			}
		}
	}
}

// Singleton instance for global access
let serverInstance: VSCodeServer | null = null;
let serverInitPromise: Promise<VSCodeServer> | null = null;

/**
 * Get or create the VS Code server singleton
 * Uses promise-based initialization to prevent race conditions
 */
export async function getVSCodeServer(
	port?: number,
	options?: VSCodeServerOptions,
): Promise<VSCodeServer> {
	if (serverInstance) {
		return serverInstance;
	}

	if (serverInitPromise) {
		return serverInitPromise;
	}

	// Create server synchronously to ensure serverInstance is set immediately
	// This is important for synchronous functions like sendFileChangeToVSCode
	serverInstance = new VSCodeServer(port, options);
	serverInitPromise = Promise.resolve(serverInstance);

	getShutdownManager().register({
		name: 'vscode-server',
		priority: 10,
		handler: async () => {
			if (serverInstance) {
				await serverInstance.stop();
			}
		},
	});

	return serverInitPromise;
}

/**
 * Get the VS Code server instance if it exists (synchronous)
 * Returns null if not yet initialized
 * Use this when you need synchronous access and the server may not be initialized
 */
export function getVSCodeServerSync(): VSCodeServer | null {
	return serverInstance;
}

/**
 * Check if VS Code server is active and has connections
 */
export function isVSCodeConnected(): boolean {
	return serverInstance?.hasConnections() ?? false;
}

/**
 * Send a file change to VS Code for preview/approval
 * This is the main entry point for tools to integrate with VS Code
 */
export function sendFileChangeToVSCode(
	filePath: string,
	originalContent: string,
	newContent: string,
	toolName: string,
	toolArgs: Record<string, unknown>,
): string | null {
	if (!serverInstance?.hasConnections()) {
		return null;
	}

	return serverInstance.sendFileChange(
		filePath,
		originalContent,
		newContent,
		toolName,
		toolArgs,
	);
}

/**
 * Close a diff preview in VS Code (when tool confirmed/rejected in CLI)
 */
export function closeDiffInVSCode(id: string | null): void {
	if (!id || !serverInstance?.hasConnections()) {
		return;
	}

	serverInstance.closeDiff(id);
}

/**
 * Close all pending diff previews in VS Code
 */
export function closeAllDiffsInVSCode(): void {
	if (!serverInstance?.hasConnections()) {
		return;
	}

	serverInstance.closeAllDiffs();
}
