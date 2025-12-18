import {execFileSync} from 'child_process';
import {logWarning} from '@/utils/message-queue';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {WebSocketClientTransport} from '@modelcontextprotocol/sdk/client/websocket.js';
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
 * Checks if a command exists in the system PATH.
 * Uses execFileSync with separate arguments to prevent shell injection.
 */
function commandExists(command: string): boolean {
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

// Union type for all supported client transports
type ClientTransport =
	| StdioClientTransport
	| WebSocketClientTransport
	| StreamableHTTPClientTransport;

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

		return new StdioClientTransport({
			command: server.command,
			args: server.args || [],
			env: server.env
				? ({...process.env, ...server.env} as Record<string, string>)
				: undefined,
		});
	}

	/**
	 * Creates a WebSocket transport for remote MCP servers
	 */
	private static createWebSocketTransport(
		server: MCPServer,
	): WebSocketClientTransport {
		if (!server.url) {
			throw new Error(
				`MCP server "${server.name}" missing URL for websocket transport`,
			);
		}

		const url = new URL(server.url);

		// Validate WebSocket URL
		if (!url.protocol.startsWith('ws')) {
			throw new Error(
				`Invalid WebSocket URL protocol: ${url.protocol}. Expected ws:// or wss://`,
			);
		}

		const transport = new WebSocketClientTransport(url);

		// Note: The WebSocketClientTransport doesn't directly support headers in the current SDK
		// Authentication would need to be handled at the protocol level or via URL parameters
		if (server.auth) {
			logWarning('WebSocket transport has unsupported auth config', true, {
				context: {
					serverName: server.name,
					transportType: 'websocket',
					reason:
						'Current SDK does not support headers for WebSocket transport',
				},
			});
		}

		return transport;
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
		const transport = new StreamableHTTPClientTransport(url, transportOptions);

		if (server.auth) {
			logWarning('HTTP transport has unsupported auth config', true, {
				context: {
					serverName: server.name,
					transportType: 'http',
					reason:
						'Current SDK does not support custom headers for HTTP transport',
				},
			});
		}

		// Check if headers are specified but cannot be used
		if (server.headers) {
			const headerKeys = Object.keys(server.headers);
			if (headerKeys.length > 0) {
				// Headers are now being used, so don't show the warning anymore
				// console.warn(...) - Commented out since headers are now supported
			}
		}

		return transport;
	}

	/**
	 * Validates the server configuration for the given transport type
	 */
	static validateServerConfig(server: MCPServer): {
		valid: boolean;
		errors: string[];
	} {
		const errors: string[] = [];

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
							errors.push('websocket URL must use ws:// or wss:// protocol');
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
					'Requires a ws:// or wss:// URL',
					'Supports real-time bidirectional communication',
					'Best for interactive remote services',
					'Note: Custom headers are not currently supported by the SDK and will be ignored',
				];

			case 'http':
				return [
					'HTTP transport connects to remote MCP servers via REST API',
					'Requires an http:// or https:// URL',
					'Uses the StreamableHTTP protocol from MCP specification',
					'Best for stateless remote services and APIs',
					'Custom headers are now supported for authentication',
				];

			default:
				return ['Unknown transport type'];
		}
	}
}
