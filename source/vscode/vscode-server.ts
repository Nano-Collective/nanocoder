/**
 * WebSocket server for VS Code extension communication
 */

import {readFile} from 'node:fs/promises';
import {randomUUID} from 'crypto';
import {WebSocket, WebSocketServer} from 'ws';
import {BoundedMap} from '@/utils/bounded-map';
import {formatError} from '@/utils/error-formatter';
import {getLogger} from '@/utils/logging';
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
	onConnect?: () => void;
	onDisconnect?: () => void;
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

	constructor(private port: number = DEFAULT_PORT) {}

	/**
	 * Get the actual port the server is listening on
	 */
	getPort(): number {
		return this.port;
	}

	/**
	 * Try to start the WebSocket server on a specific port
	 */
	private async tryStartOnPort(port: number): Promise<boolean> {
		return new Promise(resolve => {
			try {
				const wss = new WebSocketServer({
					port,
					host: '127.0.0.1', // Only accept local connections
				});

				wss.on('listening', () => {
					this.wss = wss;
					this.port = port;

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
	 * Start the WebSocket server with automatic port fallback
	 * If the requested port is in use, tries up to 10 alternative ports
	 */
	async start(): Promise<boolean> {
		this.cliVersion = await getCliVersion();

		const logger = getLogger();
		const requestedPort = this.port;
		const maxRetries = 10;

		// Try the requested port first
		const success = await this.tryStartOnPort(requestedPort);
		if (success) {
			logger.info(`VS Code server listening on port ${this.port}`);
			return true;
		}

		// If failed, try alternative ports
		logger.warn(`Port ${requestedPort} is in use, trying alternative ports...`);

		for (let i = 1; i <= maxRetries; i++) {
			const alternativePort = requestedPort + i;
			const success = await this.tryStartOnPort(alternativePort);
			if (success) {
				logger.info(
					`VS Code server listening on port ${this.port} (requested ${requestedPort} was in use)`,
				);
				return true;
			}
		}

		// All ports failed
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

	/**
	 * Stop the WebSocket server
	 */
	async stop(): Promise<void> {
		// Close all client connections
		for (const client of this.clients) {
			client.close();
		}
		this.clients.clear();

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
export async function getVSCodeServer(port?: number): Promise<VSCodeServer> {
	if (serverInstance) {
		return serverInstance;
	}

	if (serverInitPromise) {
		return serverInitPromise;
	}

	// Create server synchronously to ensure serverInstance is set immediately
	// This is important for synchronous functions like sendFileChangeToVSCode
	serverInstance = new VSCodeServer(port);
	serverInitPromise = Promise.resolve(serverInstance);

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
