import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {WebSocketClientTransport} from '@modelcontextprotocol/sdk/client/websocket.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {
	type JSONRPCMessage,
	JSONRPCMessageSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {execFileSync} from 'child_process';
import {accessSync, constants as fsConstants} from 'fs';
import type {RawData, WebSocket as WsWebSocket} from 'ws';
import type {MCPServer, MCPTransportType} from '../types/mcp.js';

/**
 * Installation instructions for common MCP server dependencies
 */
const COMMAND_INSTALL_HINTS: Record<string, string> = {
	uvx: `'uvx' is part of the 'uv' Python package manager.

Install uv:
  • macOS/Linux: curl -LsSf https://astral.sh/uv/install.sh | sh
  • Windows: powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
  • pip: pip install uv
  • Homebrew: brew install uv

After installation, restart your terminal and try again.`,
	npx: `'npx' is part of Node.js.

Install Node.js from: https://nodejs.org/
Or use a version manager like nvm, fnm, or volta.`,
	node: `'node' is not installed.

Install Node.js from: https://nodejs.org/
Or use a version manager like nvm, fnm, or volta.`,
	python: `'python' is not installed.

Install Python from: https://python.org/downloads/
Or use a version manager like pyenv.`,
	python3: `'python3' is not installed.

Install Python from: https://python.org/downloads/
Or use a version manager like pyenv.`,
};

/**
 * Checks if a command exists in the system PATH or as an executable path.
 * Uses execFileSync with separate arguments to prevent shell injection.
 * Handles both PATH lookups and direct path references (./bin/cmd, /usr/bin/cmd).
 */
function commandExists(command: string): boolean {
	// Check if command is a path (contains path separators)
	if (command.includes('/') || command.includes('\\')) {
		try {
			// Check if file exists and is executable
			accessSync(command, fsConstants.X_OK);
			return true;
		} catch {
			return false;
		}
	}

	// PATH lookup using which/where
	try {
		const checkCmd = process.platform === 'win32' ? 'where' : 'which';
		execFileSync(checkCmd, [command], {stdio: 'ignore'});
		return true;
	} catch {
		return false;
	}
}

/**
 * Gets installation hint for a missing command
 */
function getInstallHint(command: string): string {
	return (
		COMMAND_INSTALL_HINTS[command] ||
		`'${command}' is not installed or not in your PATH.`
	);
}

const MCP_WEBSOCKET_SUBPROTOCOL = 'mcp';

/**
 * WebSocket MCP client transport backed by `ws` so custom HTTP headers
 * (such as `Authorization`) are sent during the WebSocket handshake.
 * `ws` is loaded lazily in `start()` to keep it out of the CLI startup graph.
 */
class HeadersWebSocketClientTransport implements Transport {
	private socket?: WsWebSocket;
	onclose?: () => void;
	onerror?: (error: Error) => void;
	onmessage?: (message: JSONRPCMessage) => void;

	constructor(
		private readonly url: URL,
		private readonly headers: Record<string, string>,
	) {}

	async start(): Promise<void> {
		if (this.socket) {
			throw new Error(
				'HeadersWebSocketClientTransport already started! If using Client class, note that connect() calls start() automatically.',
			);
		}

		const {default: WebSocketImpl} = await import('ws');

		await new Promise<void>((resolve, reject) => {
			const socket = new WebSocketImpl(this.url, MCP_WEBSOCKET_SUBPROTOCOL, {
				headers: this.headers,
			});
			this.socket = socket;
			let settled = false;

			socket.on('open', () => {
				settled = true;
				resolve();
			});

			socket.on('error', (err: Error) => {
				const error = err instanceof Error ? err : new Error(String(err));
				if (!settled) {
					settled = true;
					reject(error);
				}
				this.onerror?.(error);
			});

			socket.on('close', () => {
				this.onclose?.();
			});

			socket.on('message', (data: RawData) => {
				let message: JSONRPCMessage;
				try {
					const text = Buffer.isBuffer(data)
						? data.toString('utf8')
						: Array.isArray(data)
							? Buffer.concat(data).toString('utf8')
							: Buffer.from(data).toString('utf8');
					message = JSONRPCMessageSchema.parse(JSON.parse(text));
				} catch (err) {
					const error = err instanceof Error ? err : new Error(String(err));
					this.onerror?.(error);
					return;
				}
				this.onmessage?.(message);
			});
		});
	}

	async close(): Promise<void> {
		const socket = this.socket;
		if (!socket || socket.readyState === socket.CLOSED) {
			return;
		}
		await new Promise<void>(resolve => {
			socket.once('close', () => resolve());
			socket.close();
		});
	}

	send(message: JSONRPCMessage): Promise<void> {
		return new Promise((resolve, reject) => {
			const socket = this.socket;
			if (!socket || socket.readyState !== socket.OPEN) {
				reject(new Error('Not connected'));
				return;
			}
			socket.send(JSON.stringify(message), err => {
				if (err) {
					reject(err);
					return;
				}
				resolve();
			});
		});
	}
}

export type ClientTransport = Transport;

/**
 * Factory for creating MCP client transports based on server configuration
 */
export class TransportFactory {
	/**
	 * Creates a transport instance for the given MCP server configuration
	 */
	static createTransport(server: MCPServer): ClientTransport {
		switch (server.transport) {
			case 'stdio':
				return this.createStdioTransport(server);

			case 'websocket':
				return this.createWebSocketTransport(server);

			case 'http':
				return this.createHTTPTransport(server);

			default: {
				const _exhaustiveCheck: never = server.transport;
				throw new Error(
					`Unsupported transport type: ${_exhaustiveCheck as string}`,
				);
			}
		}
	}

	/**
	 * Creates a stdio transport for local MCP servers
	 */
	private static createStdioTransport(server: MCPServer): StdioClientTransport {
		if (!server.command) {
			throw new Error(
				`MCP server "${server.name}" missing command for stdio transport`,
			);
		}

		// For uvx commands, prepend --native-tls to use system certificates
		// This fixes TLS issues in corporate proxy environments (issue #272)
		let args = server.args || [];
		if (server.command === 'uvx' && !args.includes('--native-tls')) {
			args = ['--native-tls', ...args];
		}

		return new StdioClientTransport({
			command: server.command,
			args,
			env: server.env
				? ({...process.env, ...server.env} as Record<string, string>)
				: undefined,
			// Default 'inherit' lets server children write straight to the
			// user's terminal — including crash dumps that land AFTER
			// nanocoder exits (e.g. an EPIPE stack trace when a server dies
			// writing to the closed pipe during shutdown). Pipe it instead;
			// mcp-client drains it into the logger.
			stderr: 'pipe',
		});
	}

	/**
	 * Creates a WebSocket transport for remote MCP servers
	 */
	private static createWebSocketTransport(server: MCPServer): Transport {
		if (!server.url) {
			throw new Error(
				`MCP server "${server.name}" missing URL for websocket transport`,
			);
		}

		const url = new URL(server.url);

		// Validate WebSocket URL
		if (!url.protocol.startsWith('ws')) {
			throw new Error(
				`Invalid WebSocket URL protocol: ${url.protocol}. Expected ws:// or wss://`, // nosemgrep
			);
		}

		if (server.headers && Object.keys(server.headers).length > 0) {
			return new HeadersWebSocketClientTransport(url, server.headers);
		}

		return new WebSocketClientTransport(url);
	}

	/**
	 * Creates an HTTP transport for remote MCP servers
	 */
	private static createHTTPTransport(
		server: MCPServer,
	): StreamableHTTPClientTransport {
		if (!server.url) {
			throw new Error(
				`MCP server "${server.name}" missing URL for http transport`,
			);
		}

		const url = new URL(server.url);

		// Validate HTTP URL
		if (!url.protocol.startsWith('http')) {
			throw new Error(
				`Invalid HTTP URL protocol: ${url.protocol}. Expected http:// or https://`,
			);
		}

		// Create transport with headers if provided
		const transportOptions = server.headers
			? {requestInit: {headers: server.headers}}
			: undefined;

		return new StreamableHTTPClientTransport(url, transportOptions);
	}

	/**
	 * Validates the server configuration for the given transport type
	 */
	static validateServerConfig(server: MCPServer): {
		valid: boolean;
		errors: string[];
	} {
		const errors: string[] = [];
		if (
			server.healthCheckInterval !== undefined &&
			(!Number.isFinite(server.healthCheckInterval) ||
				server.healthCheckInterval < 0)
		) {
			errors.push('healthCheckInterval must be a non-negative finite number');
		}
		if (
			server.toolTimeout !== undefined &&
			(!Number.isFinite(server.toolTimeout) || server.toolTimeout < 0)
		) {
			errors.push('toolTimeout must be a non-negative finite number');
		}
		if (
			server.resetTimeoutOnProgress !== undefined &&
			typeof server.resetTimeoutOnProgress !== 'boolean'
		) {
			errors.push('resetTimeoutOnProgress must be true or false');
		}

		switch (server.transport) {
			case 'stdio':
				if (!server.command) {
					errors.push('stdio transport requires a command');
				} else if (!commandExists(server.command)) {
					const hint = getInstallHint(server.command);
					errors.push(`Command '${server.command}' not found.\n\n${hint}`);
				}
				break;

			case 'websocket':
				if (!server.url) {
					errors.push('websocket transport requires a URL');
				} else {
					try {
						const url = new URL(server.url);
						if (!url.protocol.startsWith('ws')) {
							errors.push('websocket URL must use ws:// or wss:// protocol'); // nosemgrep
						}
					} catch {
						errors.push('websocket URL is invalid');
					}
				}
				break;

			case 'http':
				if (!server.url) {
					errors.push('http transport requires a URL');
				} else {
					try {
						const url = new URL(server.url);
						if (!url.protocol.startsWith('http')) {
							errors.push('http URL must use http:// or https:// protocol');
						}
					} catch {
						errors.push('http URL is invalid');
					}
				}

				// Headers are now supported, so we don't need to warn about them being ignored
				// The actual warning logic has been moved to the createHTTPTransport method
				break;
		}

		return {
			valid: errors.length === 0,
			errors,
		};
	}

	/**
	 * Gets transport-specific configuration tips for users
	 */
	static getTransportTips(transportType: MCPTransportType): string[] {
		switch (transportType) {
			case 'stdio':
				return [
					'Stdio transport spawns a local process',
					'Requires a command and optional arguments',
					'Environment variables can be passed to the process',
					'Best for local MCP servers and tools',
				];

			case 'websocket':
				return [
					'WebSocket transport connects to remote MCP servers',
					'Requires a ws:// or wss:// URL', // nosemgrep
					'Supports real-time bidirectional communication',
					'Best for interactive remote services',
					'Custom headers are supported for authentication',
				];

			case 'http':
				return [
					'HTTP transport connects to remote MCP servers',
					'Requires an http:// or https:// URL',
					'Uses the StreamableHTTP protocol from MCP specification',
					'Best for stateless remote services and APIs',
					'Custom headers are supported for authentication',
				];

			default:
				return ['Unknown transport type'];
		}
	}
}
