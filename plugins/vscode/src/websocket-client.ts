import * as vscode from 'vscode';
import WebSocket from 'ws';
import {
	ServerMessage,
	ClientMessage,
	PROTOCOL_VERSION,
	DEFAULT_PORT,
} from './protocol';
import {TIMEOUT_PROVIDER_CONNECTION_MS} from '../../../source/constants';

export type MessageHandler = (message: ServerMessage) => void;

export class WebSocketClient {
	private ws: WebSocket | null = null;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private messageHandlers: Set<MessageHandler> = new Set();
	private isConnecting = false;
	private shouldReconnect = true;

	constructor(private outputChannel: vscode.OutputChannel) {}

	async connect(port: number = DEFAULT_PORT): Promise<boolean> {
		if (this.ws?.readyState === WebSocket.OPEN) {
			return true;
		}

		if (this.isConnecting) {
			return false;
		}

		this.isConnecting = true;
		this.shouldReconnect = true;

		return new Promise(resolve => {
			try {
				const url = `ws://127.0.0.1:${port}`;
				this.outputChannel.appendLine(`Connecting to ${url}...`);

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
