import * as vscode from 'vscode';
import WebSocket from 'ws';
import {TIMEOUT_PROVIDER_CONNECTION_MS} from '../../../source/constants';
import {getDiscoveryFilePath, readDiscoveryFile} from './discovery';
import {
	ClientMessage,
	DEFAULT_PORT,
	ServerMessage,
} from './protocol';

export type MessageHandler = (message: ServerMessage) => void;

export class WebSocketClient {
	private ws: WebSocket | null = null;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private messageHandlers: Set<MessageHandler> = new Set();
	private isConnecting = false;
	private shouldReconnect = true;
	private lastUrl: string | null = null;

	constructor(private outputChannel: vscode.OutputChannel) {}

	/**
	 * Connect to the CLI's companion server.
	 *
	 * `port` is now an explicit-port fallback: in the default flow we read
	 * the port and per-session token from the discovery file written by the
	 * CLI, so the port is unguessable and authentication is mandatory. The
	 * `port` parameter only kicks in when no discovery file is available,
	 * which is the case for older CLI builds; in that scenario, the token
	 * defaults to empty and the new server will reject the handshake.
	 */
	async connect(port: number = DEFAULT_PORT): Promise<boolean> {
		if (this.ws?.readyState === WebSocket.OPEN) {
			return true;
		}

		if (this.isConnecting) {
			return false;
		}

		const {url, source, token} = await this.resolveConnection(port);

		this.isConnecting = true;
		this.shouldReconnect = true;

		return new Promise(resolve => {
			try {
				this.lastUrl = url;
				this.outputChannel.appendLine(
					`Connecting to ${url} (via ${source}, token ${token ? 'present' : 'absent'})...`,
				);

				this.ws = new WebSocket(url);

				this.ws.on('open', () => {
					this.isConnecting = false;
					this.outputChannel.appendLine('Connected to Nanocoder CLI');
					this.clearReconnectTimer();
					resolve(true);
				});

				this.ws.on('message', data => {
					try {
						const message = JSON.parse(data.toString()) as ServerMessage;
						this.handleMessage(message);
					} catch (error) {
						this.outputChannel.appendLine(`Failed to parse message: ${error}`);
					}
				});

				this.ws.on('close', () => {
					this.outputChannel.appendLine('Disconnected from Nanocoder CLI');
					this.ws = null;
					this.isConnecting = false;
					if (this.shouldReconnect) {
						this.scheduleReconnect(port);
					}
				});

				this.ws.on('error', error => {
					this.outputChannel.appendLine(`WebSocket error: ${error.message}`);
					this.isConnecting = false;
					resolve(false);
				});

				// Timeout for connection attempt
				setTimeout(() => {
					if (this.isConnecting) {
						this.isConnecting = false;
						this.ws?.close();
						resolve(false);
					}
				}, TIMEOUT_PROVIDER_CONNECTION_MS);
			} catch (error) {
				this.isConnecting = false;
				this.outputChannel.appendLine(`Connection failed: ${error}`);
				resolve(false);
			}
		});
	}

	/**
	 * Build the WebSocket URL and capture the source we read it from. Order
	 * of preference:
	 *   1. Discovery file under the user's nanocoder config dir.
	 *   2. `nanocoder.serverPort` setting with no token (legacy path).
	 *
	 * Always append `?token=...` when we have a token, never when we do not -
	 * an empty token would otherwise look like a missing one and the new
	 * server would (correctly) reject the handshake.
	 */
	private async resolveConnection(
		fallbackPort: number,
	): Promise<{url: string; source: string; token: string}> {
		const filePath = getDiscoveryFilePath();
		const discovery = await readDiscoveryFile(filePath);
		if (discovery && typeof discovery.port === 'number') {
			const tokenQuery = discovery.token
				? `?token=${encodeURIComponent(discovery.token)}`
				: '';
			return {
				url: `ws://127.0.0.1:${discovery.port}${tokenQuery}`,
				source: `discovery file (${filePath})`,
				token: discovery.token,
			};
		}

		return {
			url: `ws://127.0.0.1:${fallbackPort}`,
			source: 'nanocoder.serverPort setting (legacy, no token)',
			token: '',
		};
	}

	disconnect(): void {
		this.shouldReconnect = false;
		this.clearReconnectTimer();
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}

	send(message: ClientMessage): boolean {
		if (this.ws?.readyState !== WebSocket.OPEN) {
			this.outputChannel.appendLine('Cannot send: not connected');
			return false;
		}

		try {
			this.ws.send(JSON.stringify(message));
			return true;
		} catch (error) {
			this.outputChannel.appendLine(`Failed to send message: ${error}`);
			return false;
		}
	}

	onMessage(handler: MessageHandler): vscode.Disposable {
		this.messageHandlers.add(handler);
		return new vscode.Disposable(() => {
			this.messageHandlers.delete(handler);
		});
	}

	isConnected(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}

	/** Last URL we tried to connect to; useful for diagnostics. */
	getLastUrl(): string | null {
		return this.lastUrl;
	}

	private handleMessage(message: ServerMessage): void {
		this.messageHandlers.forEach(handler => {
			try {
				handler(message);
			} catch (error) {
				this.outputChannel.appendLine(`Message handler error: ${error}`);
			}
		});
	}

	private scheduleReconnect(port: number): void {
		if (this.reconnectTimer) {
			return;
		}

		this.outputChannel.appendLine('Scheduling reconnect in 3 seconds...');
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (this.shouldReconnect) {
				this.connect(port);
			}
		}, 3000);
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}
}

