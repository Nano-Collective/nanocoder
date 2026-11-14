/**
 * LSP Client implementation
 * Manages connections to language servers via JSON-RPC over stdio
 */

import {EventEmitter} from 'node:events';
import {pathToFileURL} from 'node:url';
import type {ChildProcess} from 'child_process';
import spawn from 'cross-spawn';
import {createChildLogger} from '@/utils/logging';
import {
	CodeAction,
	CodeActionParams,
	CompletionItem,
	CompletionList,
	CompletionTriggerKind,
	Diagnostic,
	DocumentFormattingParams,
	FormattingOptions,
	InitializeParams,
	InitializeResult,
	JsonRpcNotification,
	JsonRpcRequest,
	JsonRpcResponse,
	LSPMethods,
	Position,
	PublishDiagnosticsParams,
	ServerCapabilities,
	TextDocumentIdentifier,
	TextDocumentItem,
	TextEdit,
} from './protocol';

export interface LSPServerConfig {
	name: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
	languages: string[]; // File extensions this server handles (e.g., ['ts', 'tsx', 'js'])
	rootUri?: string;
}

interface PendingRequest {
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
	method: string;
	timeoutId: NodeJS.Timeout;
}

/**
 * What an unexpected server exit looked like. `stderrTail` is the last output
 * the server wrote before dying — usually the stack trace that explains why.
 */
export interface LSPCrashInfo {
	code: number | null;
	signal: NodeJS.Signals | null;
	stderrTail: string;
}

/** How much of a server's stderr is kept for crash reports. */
const MAX_STDERR_TAIL_CHARS = 4 * 1024;

const logger = createChildLogger({module: 'lsp-client'});

export class LSPClient extends EventEmitter {
	private process: ChildProcess | null = null;
	private buffer: string = '';
	private requestId: number = 0;
	private pendingRequests: Map<number | string, PendingRequest> = new Map();
	private initialized: boolean = false;
	private serverCapabilities: ServerCapabilities | null = null;
	private openDocuments: Map<string, number> = new Map(); // uri -> version
	private stderrTail: string = '';
	/** Set by stop(), so an exit we asked for is not reported as a crash. */
	private stopping: boolean = false;

	constructor(private config: LSPServerConfig) {
		super();
	}

	/**
	 * Start the language server process and initialize
	 */
	async start(): Promise<InitializeResult> {
		return new Promise((resolve, reject) => {
			try {
				this.stopping = false;
				this.stderrTail = '';
				const child = spawn(this.config.command, this.config.args || [], {
					stdio: ['pipe', 'pipe', 'pipe'],
					env: {...process.env, ...this.config.env},
				});
				this.process = child;

				child.stdout?.on('data', (data: Buffer) => {
					this.handleData(data.toString());
				});

				// Kept rather than discarded: when a server dies, its last stderr
				// is usually the only explanation of why.
				child.stderr?.on('data', (data: Buffer) => {
					this.stderrTail = (this.stderrTail + data.toString()).slice(
						-MAX_STDERR_TAIL_CHARS,
					);
				});

				// Writing to a server that has just died fails with EPIPE on stdin.
				// Unhandled, that error event would take the whole process down;
				// the exit handler below already reports the death itself.
				child.stdin?.on('error', error => {
					logger.debug(
						{err: error, server: this.config.name},
						'LSP stdin write failed',
					);
				});

				child.on('error', error => {
					// Node may still fire 'exit' after a spawn error; that exit is
					// part of this failure, not a crash.
					this.stopping = true;
					this.failPendingRequests(
						new Error(
							`LSP server "${this.config.name}" failed: ${error.message}`,
						),
					);
					// An 'error' emit with no listener throws, which would turn a
					// missing binary into an uncaught exception.
					if (this.listenerCount('error') > 0) this.emit('error', error);
					reject(error);
				});

				child.on('exit', (code, signal) => this.handleExit(code, signal));

				// Initialize the server
				this.initialize()
					.then(result => {
						this.serverCapabilities = result.capabilities;
						this.initialized = true;
						resolve(result);
					})
					.catch(error => {
						// A server that failed to initialize can stay running (it
						// may refuse `initialize` and keep waiting). Nobody will use
						// it, so end it here — as a deliberate stop, so its exit is
						// never reported as a crash of a server that never started.
						this.stopping = true;
						if (!child.killed) child.kill();
						reject(error);
					});
			} catch (error) {
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	/**
	 * Stop the language server
	 */
	async stop(): Promise<void> {
		if (!this.process) return;
		this.stopping = true;

		try {
			// Send shutdown request
			await this.sendRequest(LSPMethods.Shutdown, null);
			// Send exit notification
			this.sendNotification(LSPMethods.Exit, null);
		} catch (error) {
			// Errors during shutdown are expected and non-critical
			logger.debug(
				{err: error, server: this.config.name},
				'LSP shutdown error (non-critical)',
			);
		}

		// Force kill if still running
		if (this.process && !this.process.killed) {
			this.process.kill();
		}

		// Clear all pending request timeouts
		for (const pending of this.pendingRequests.values()) {
			clearTimeout(pending.timeoutId);
		}

		this.process = null;
		this.initialized = false;
		this.pendingRequests.clear();
		this.openDocuments.clear();
	}

	/**
	 * Check if the server is running and initialized
	 */
	isReady(): boolean {
		return this.initialized && this.process !== null && !this.process.killed;
	}

	/** The last stderr the server wrote, trimmed. */
	getStderrTail(): string {
		return this.stderrTail.trim();
	}

	/**
	 * Get server capabilities
	 */
	getCapabilities(): ServerCapabilities | null {
		return this.serverCapabilities;
	}

	/**
	 * Open a text document
	 */
	openDocument(uri: string, languageId: string, text: string): void {
		const version = 1;
		this.openDocuments.set(uri, version);

		const params: {textDocument: TextDocumentItem} = {
			textDocument: {
				uri,
				languageId,
				version,
				text,
			},
		};

		this.sendNotification(LSPMethods.DidOpen, params);
	}

	/**
	 * Update a text document
	 */
	updateDocument(uri: string, text: string): void {
		const version = (this.openDocuments.get(uri) || 0) + 1;
		this.openDocuments.set(uri, version);

		const params = {
			textDocument: {uri, version},
			contentChanges: [{text}],
		};

		this.sendNotification(LSPMethods.DidChange, params);
	}

	/**
	 * Close a text document
	 */
	closeDocument(uri: string): void {
		this.openDocuments.delete(uri);

		const params: {textDocument: TextDocumentIdentifier} = {
			textDocument: {uri},
		};

		this.sendNotification(LSPMethods.DidClose, params);
	}

	/**
	 * Get completions at a position
	 */
	async getCompletions(
		uri: string,
		position: Position,
	): Promise<CompletionItem[]> {
		if (!this.serverCapabilities?.completionProvider) {
			return [];
		}

		const params = {
			textDocument: {uri},
			position,
			context: {triggerKind: CompletionTriggerKind.Invoked},
		};

		const result = (await this.sendRequest(LSPMethods.Completion, params)) as
			| CompletionItem[]
			| CompletionList
			| null;

		if (!result) return [];
		if (Array.isArray(result)) return result;
		return result.items;
	}

	/**
	 * Get code actions (quick fixes, refactorings)
	 */
	async getCodeActions(
		uri: string,
		diagnostics: Diagnostic[],
		startLine: number,
		startChar: number,
		endLine: number,
		endChar: number,
	): Promise<CodeAction[]> {
		if (!this.serverCapabilities?.codeActionProvider) {
			return [];
		}

		const params: CodeActionParams = {
			textDocument: {uri},
			range: {
				start: {line: startLine, character: startChar},
				end: {line: endLine, character: endChar},
			},
			context: {diagnostics},
		};

		const result = (await this.sendRequest(LSPMethods.CodeAction, params)) as
			| CodeAction[]
			| null;
		return result || [];
	}

	/**
	 * Format a document
	 */
	async formatDocument(
		uri: string,
		options?: Partial<FormattingOptions>,
	): Promise<TextEdit[]> {
		if (!this.serverCapabilities?.documentFormattingProvider) {
			return [];
		}

		const params: DocumentFormattingParams = {
			textDocument: {uri},
			options: {
				tabSize: options?.tabSize ?? 2,
				insertSpaces: options?.insertSpaces ?? true,
				trimTrailingWhitespace: options?.trimTrailingWhitespace ?? true,
				insertFinalNewline: options?.insertFinalNewline ?? true,
				trimFinalNewlines: options?.trimFinalNewlines ?? true,
			},
		};

		const result = (await this.sendRequest(LSPMethods.Formatting, params)) as
			| TextEdit[]
			| null;
		return result || [];
	}

	/**
	 * Request diagnostics for a document (pull model)
	 * Note: Most LSPs use push model via publishDiagnostics notification
	 */
	async getDiagnostics(uri: string): Promise<Diagnostic[]> {
		// Check if server supports pull diagnostics
		if (this.serverCapabilities?.diagnosticProvider) {
			try {
				const result = (await this.sendRequest(LSPMethods.DocumentDiagnostic, {
					textDocument: {uri},
				})) as {items?: Diagnostic[]} | null;
				return result?.items || [];
			} catch (error) {
				// A dead server is not "no diagnostics": let the crash surface
				// instead of reporting the file as clean.
				if (!this.isReady()) throw error;
				// Fall back to cached diagnostics if pull not supported
				logger.debug(
					{err: error, uri},
					'Pull diagnostics not supported, using cached',
				);
				return [];
			}
		}
		return [];
	}

	// Private methods

	/**
	 * The server process is gone. Anything still waiting on it will never get
	 * an answer, so fail it now rather than at the 30s timeout, and report an
	 * exit we did not ask for as a crash.
	 *
	 * Only a server that finished starting can crash. One that dies during
	 * startup (or never spawned) already failed start() through the rejected
	 * `initialize` request; reporting it again as a crash would trigger a
	 * restart of a server that never worked.
	 */
	private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
		const wasRunning = this.initialized;
		const crashed = !this.stopping && wasRunning;
		this.initialized = false;
		this.process = null;
		this.openDocuments.clear();

		const status = signal ? `signal ${signal}` : `exit code ${code}`;
		const name = `LSP server "${this.config.name}"`;
		this.failPendingRequests(
			new Error(
				this.stopping
					? `${name} stopped`
					: wasRunning
						? `${name} crashed (${status})`
						: `${name} exited during startup (${status})`,
			),
		);

		if (crashed) {
			const info: LSPCrashInfo = {
				code,
				signal,
				stderrTail: this.getStderrTail(),
			};
			logger.warn(
				{server: this.config.name, ...info},
				'LSP server exited unexpectedly',
			);
			this.emit('crash', info);
		}
		this.emit('exit', code);
	}

	private failPendingRequests(error: Error): void {
		for (const pending of this.pendingRequests.values()) {
			clearTimeout(pending.timeoutId);
			pending.reject(error);
		}
		this.pendingRequests.clear();
	}

	private async initialize(): Promise<InitializeResult> {
		const params: InitializeParams = {
			processId: process.pid,
			rootUri: this.config.rootUri || pathToFileURL(process.cwd()).href,
			capabilities: {
				textDocument: {
					synchronization: {
						dynamicRegistration: false,
						willSave: false,
						willSaveWaitUntil: false,
						didSave: true,
					},
					completion: {
						dynamicRegistration: false,
						completionItem: {
							snippetSupport: true,
							commitCharactersSupport: true,
							documentationFormat: ['markdown', 'plaintext'],
							deprecatedSupport: true,
						},
					},
					hover: {
						dynamicRegistration: false,
						contentFormat: ['markdown', 'plaintext'],
					},
					publishDiagnostics: {
						relatedInformation: true,
						versionSupport: true,
					},
					codeAction: {
						dynamicRegistration: false,
						codeActionLiteralSupport: {
							codeActionKind: {
								valueSet: [
									'quickfix',
									'refactor',
									'refactor.extract',
									'refactor.inline',
									'refactor.rewrite',
									'source',
									'source.organizeImports',
								],
							},
						},
					},
					formatting: {
						dynamicRegistration: false,
					},
				},
				workspace: {
					applyEdit: true,
					workspaceEdit: {
						documentChanges: true,
					},
					didChangeConfiguration: {
						dynamicRegistration: false,
					},
					workspaceFolders: true,
				},
			},
			workspaceFolders: this.config.rootUri
				? [{uri: this.config.rootUri, name: 'workspace'}]
				: null,
		};

		const result = (await this.sendRequest(
			LSPMethods.Initialize,
			params,
		)) as InitializeResult;

		// Send initialized notification
		this.sendNotification(LSPMethods.Initialized, {});

		return result;
	}

	private sendRequest(method: string, params: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (!this.process?.stdin) {
				reject(new Error('LSP process not running'));
				return;
			}

			const id = ++this.requestId;
			const request: JsonRpcRequest = {
				jsonrpc: '2.0',
				id,
				method,
				params,
			};

			// Timeout after 30 seconds
			const timeoutId = setTimeout(() => {
				if (this.pendingRequests.has(id)) {
					this.pendingRequests.delete(id);
					reject(new Error(`LSP request timeout: ${method}`));
				}
			}, 30000);

			this.pendingRequests.set(id, {resolve, reject, method, timeoutId});
			this.send(request);
		});
	}

	private sendNotification(method: string, params: unknown): void {
		if (!this.process?.stdin) return;

		const notification: JsonRpcNotification = {
			jsonrpc: '2.0',
			method,
			params,
		};

		this.send(notification);
	}

	private send(message: JsonRpcRequest | JsonRpcNotification): void {
		const content = JSON.stringify(message);
		const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
		this.process?.stdin?.write(header + content);
	}

	private handleData(data: string): void {
		this.buffer += data;

		while (true) {
			// Look for Content-Length header
			const headerEnd = this.buffer.indexOf('\r\n\r\n');
			if (headerEnd === -1) break;

			const header = this.buffer.substring(0, headerEnd);
			const match = header.match(/Content-Length:\s*(\d+)/i);
			if (!match) {
				// Invalid header, skip to next potential header
				this.buffer = this.buffer.substring(headerEnd + 4);
				continue;
			}

			const contentLength = parseInt(match[1], 10);
			const contentStart = headerEnd + 4;
			const contentEnd = contentStart + contentLength;

			if (this.buffer.length < contentEnd) {
				// Not enough data yet
				break;
			}

			const content = this.buffer.substring(contentStart, contentEnd);
			this.buffer = this.buffer.substring(contentEnd);

			try {
				const message = JSON.parse(content) as
					| JsonRpcResponse
					| JsonRpcNotification;
				this.handleMessage(message);
			} catch (error) {
				// Skip malformed JSON messages but log for debugging
				logger.debug(
					{err: error, content: content.substring(0, 100)},
					'Malformed JSON-RPC message',
				);
			}
		}
	}

	private handleMessage(message: JsonRpcResponse | JsonRpcNotification): void {
		// Check if it's a response
		if ('id' in message && message.id !== null) {
			const pending = this.pendingRequests.get(message.id);
			if (pending) {
				clearTimeout(pending.timeoutId);
				this.pendingRequests.delete(message.id);
				if (message.error) {
					pending.reject(new Error(message.error.message));
				} else {
					pending.resolve(message.result);
				}
			}
			return;
		}

		// It's a notification
		if ('method' in message) {
			this.handleNotification(message);
		}
	}

	private handleNotification(notification: JsonRpcNotification): void {
		switch (notification.method) {
			case LSPMethods.PublishDiagnostics:
				this.emit(
					'diagnostics',
					notification.params as PublishDiagnosticsParams,
				);
				break;
			// Handle other notifications as needed
		}
	}
}
