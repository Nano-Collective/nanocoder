/**
 * LSP Manager
 * Manages multiple language server connections with auto-discovery and routing
 */

import {EventEmitter} from 'node:events';
import {readFile} from 'fs/promises';
import {extname, resolve} from 'path';
import {fileURLToPath, pathToFileURL} from 'url';
import {getSessionCwd} from '@/services/session-cwd';
import {formatError} from '@/utils/error-formatter';
import {logError, logInfo} from '@/utils/message-queue';
import {getShutdownManager} from '@/utils/shutdown';
import {LSPClient, type LSPCrashInfo, LSPServerConfig} from './lsp-client';
import {
	CodeAction,
	CompletionItem,
	Diagnostic,
	FormattingOptions,
	PublishDiagnosticsParams,
	TextEdit,
} from './protocol';
import {discoverLanguageServers, getLanguageId} from './server-discovery';

export interface LSPManagerConfig {
	/** Working directory / root URI for language servers */
	rootUri?: string;
	/** Custom server configurations (overrides auto-discovery) */
	servers?: LSPServerConfig[];
	/** Enable auto-discovery of language servers */
	autoDiscover?: boolean;
	/** Callback for initialization progress */
	onProgress?: (result: LSPInitResult) => void;
}

export interface LSPInitResult {
	serverName: string;
	success: boolean;
	languages?: string[];
	error?: string;
}

/**
 * Restarts allowed per server after a crash. One recovers from a one-off death
 * (OOM, a killed process); a server that keeps dying is left down instead of
 * being restarted in a loop.
 */
const MAX_CRASH_RESTARTS = 1;

/** Lines of a crashed server's stderr shown to the user. */
const CRASH_STDERR_LINES = 10;

/**
 * How long a diagnostics request waits for a just-opened document's first
 * publishDiagnostics. Servers check a file asynchronously after didOpen, so
 * asking straight away would report a broken file as clean.
 */
const FIRST_DIAGNOSTICS_WAIT_MS = 5000;

/**
 * One spelling per file, so a URI the server publishes matches the one we
 * opened (servers re-encode URIs, e.g. a drive letter's colon on Windows).
 */
function normalizeUri(uri: string): string {
	if (!uri.startsWith('file://')) return uri;
	try {
		return pathToFileURL(fileURLToPath(uri)).href;
	} catch {
		return uri;
	}
}

export interface DiagnosticsResult {
	uri: string;
	diagnostics: Diagnostic[];
}

export class LSPManager extends EventEmitter {
	private clients: Map<string, LSPClient> = new Map(); // serverName -> client
	private languageToServer: Map<string, string> = new Map(); // extension -> serverName
	private documentServers: Map<string, string> = new Map(); // uri -> serverName
	private diagnosticsCache: Map<string, Diagnostic[]> = new Map(); // uri -> diagnostics
	// uri -> text we last sent, so an unchanged document is not re-sent and
	// its cached diagnostics stay valid.
	private openTexts: Map<string, string> = new Map();
	// uris whose first diagnostics never arrived for the current text, so a
	// server that does not publish for clean files costs the wait only once.
	private diagnosticsTimedOut: Set<string> = new Set();
	private rootUri: string;
	private initialized: boolean = false;
	private restartCounts: Map<string, number> = new Map(); // serverName -> restarts
	// extension -> why its server is down, so a diagnostics call can say so
	// instead of looking like the file type was never supported.
	private unavailableReasons: Map<string, string> = new Map();
	private shuttingDown: boolean = false;

	constructor(config: LSPManagerConfig = {}) {
		super();
		this.rootUri = config.rootUri || `file://${process.cwd()}`;
	}

	/**
	 * Initialize the LSP manager with auto-discovery and/or custom servers
	 */
	async initialize(config: LSPManagerConfig = {}): Promise<LSPInitResult[]> {
		const results: LSPInitResult[] = [];
		const serversToStart: LSPServerConfig[] = [];
		this.shuttingDown = false;

		// Add custom servers first (they take priority)
		if (config.servers) {
			for (const server of config.servers) {
				serversToStart.push({
					...server,
					rootUri: server.rootUri || this.rootUri,
				});
			}
		}

		// Auto-discover additional servers if enabled (default: true)
		if (config.autoDiscover !== false) {
			// Extract file path from rootUri for context-aware server discovery
			const projectRoot = this.rootUri.startsWith('file://')
				? fileURLToPath(this.rootUri)
				: this.rootUri;
			const discovered = await discoverLanguageServers(projectRoot);

			// Only add discovered servers for languages not already covered
			const coveredLanguages = new Set<string>();
			for (const server of serversToStart) {
				for (const lang of server.languages) {
					coveredLanguages.add(lang);
				}
			}

			for (const server of discovered) {
				const hasNewLanguages = server.languages.some(
					lang => !coveredLanguages.has(lang),
				);
				if (hasNewLanguages) {
					serversToStart.push({
						...server,
						rootUri: this.rootUri,
					});
					for (const lang of server.languages) {
						coveredLanguages.add(lang);
					}
				}
			}
		}

		// Start all servers in parallel
		const startPromises = serversToStart.map(async serverConfig => {
			const result = await this.startServer(serverConfig);
			config.onProgress?.(result);
			results.push(result);
			return result;
		});

		await Promise.all(startPromises);

		this.initialized = true;
		return results;
	}

	/**
	 * Start a single language server
	 */
	private async startServer(config: LSPServerConfig): Promise<LSPInitResult> {
		try {
			const client = new LSPClient(config);

			// Handle diagnostics from this server
			client.on('diagnostics', (params: PublishDiagnosticsParams) => {
				const uri = normalizeUri(params.uri);
				this.diagnosticsCache.set(uri, params.diagnostics);
				this.emit('diagnostics', {...params, uri});
			});

			client.on('exit', (_code: number | null) => {
				// A restarted server registers a new client under the same name;
				// a late exit from the old one must not unregister it.
				if (this.clients.get(config.name) !== client) return;
				this.clients.delete(config.name);
				// Remove language mappings for this server
				for (const [lang, serverName] of this.languageToServer.entries()) {
					if (serverName === config.name) {
						this.languageToServer.delete(lang);
					}
				}
			});

			client.on('crash', (info: LSPCrashInfo) => {
				void this.handleCrash(config, info);
			});

			try {
				await client.start();
			} catch (error) {
				// The server's own explanation (e.g. typescript-language-server's
				// "Could not find a valid TypeScript installation") is usually on
				// stderr, not in the protocol error.
				const tail = client
					.getStderrTail()
					.split('\n')
					.slice(-CRASH_STDERR_LINES)
					.join('\n');
				const message = formatError(error);
				throw new Error(
					tail && !message.includes(tail) ? `${message}\n${tail}` : message,
				);
			}

			// Store client and language mappings
			this.clients.set(config.name, client);
			for (const lang of config.languages) {
				this.languageToServer.set(lang, config.name);
			}
			this.markAvailable(config.languages);

			return {
				serverName: config.name,
				success: true,
				languages: config.languages,
			};
		} catch (error) {
			const message = formatError(error);
			// Say why later, when a diagnostics call for this file type would
			// otherwise just report that no server exists for it. A language
			// another server already covers is not unavailable.
			this.markUnavailable(
				config.languages.filter(lang => !this.languageToServer.has(lang)),
				`Language server "${config.name}" failed to start: ${message}`,
			);
			return {
				serverName: config.name,
				success: false,
				error: message,
			};
		}
	}

	/**
	 * A server died without being asked to. Say so — otherwise every later
	 * diagnostics call quietly reports a clean file — and try one restart.
	 */
	private async handleCrash(
		config: LSPServerConfig,
		info: LSPCrashInfo,
	): Promise<void> {
		// Its published diagnostics describe files as they were when it died.
		this.dropDiagnosticsFor(config.languages);

		const status = info.signal
			? `signal ${info.signal}`
			: `exit code ${info.code}`;
		const tail = info.stderrTail
			.split('\n')
			.slice(-CRASH_STDERR_LINES)
			.join('\n');
		const restarts = this.restartCounts.get(config.name) ?? 0;
		const canRestart = restarts < MAX_CRASH_RESTARTS && !this.shuttingDown;
		this.markUnavailable(
			config.languages,
			`Language server "${config.name}" crashed (${status})${
				canRestart
					? ' and is restarting; try again shortly.'
					: ' and was not restarted.'
			}`,
		);

		logError(
			`Language server "${config.name}" crashed (${status}).${
				canRestart
					? ' Restarting it.'
					: ` Not restarting; ${config.languages.map(l => `.${l}`).join(', ')} diagnostics are unavailable until Nanocoder restarts.`
			}${tail ? `\n${tail}` : ''}`,
		);
		if (!canRestart) return;

		this.restartCounts.set(config.name, restarts + 1);
		const result = await this.startServer(config);
		if (this.shuttingDown) {
			// shutdown() ran while the restart was starting; it never saw this
			// client, so stop it here rather than leave the process running.
			await this.clients.get(config.name)?.stop();
			return;
		}
		if (result.success) {
			this.markAvailable(config.languages);
			logInfo(`Language server "${config.name}" restarted.`);
		} else {
			this.markUnavailable(
				config.languages,
				`Language server "${config.name}" crashed (${status}) and could not be restarted: ${result.error}`,
			);
			logError(
				`Language server "${config.name}" could not be restarted: ${result.error}`,
			);
		}
	}

	private markUnavailable(languages: string[], reason: string): void {
		for (const lang of languages) this.unavailableReasons.set(lang, reason);
	}

	private markAvailable(languages: string[]): void {
		for (const lang of languages) this.unavailableReasons.delete(lang);
	}

	/**
	 * Why the language server for this file is down, when it crashed. Undefined
	 * when it is running, or when no server was ever configured for the type.
	 */
	getUnavailableReason(filePath: string): string | undefined {
		return this.unavailableReasons.get(extname(filePath).slice(1));
	}

	private dropDiagnosticsFor(languages: string[]): void {
		for (const uri of this.diagnosticsCache.keys()) {
			if (languages.includes(extname(uri).slice(1))) {
				this.diagnosticsCache.delete(uri);
				this.documentServers.delete(uri);
			}
		}
		// The restarted server has none of them open.
		for (const uri of this.openTexts.keys()) {
			if (languages.includes(extname(uri).slice(1))) {
				this.openTexts.delete(uri);
				this.diagnosticsTimedOut.delete(uri);
			}
		}
	}

	/**
	 * Stop all language servers
	 */
	async shutdown(): Promise<void> {
		this.shuttingDown = true;
		const stopPromises = Array.from(this.clients.values()).map(client =>
			client.stop(),
		);
		await Promise.all(stopPromises);

		this.clients.clear();
		this.languageToServer.clear();
		this.documentServers.clear();
		this.diagnosticsCache.clear();
		this.openTexts.clear();
		this.diagnosticsTimedOut.clear();
		this.restartCounts.clear();
		this.unavailableReasons.clear();
		this.initialized = false;
	}

	/**
	 * Get the client for a file based on its extension
	 */
	private getClientForFile(filePath: string): LSPClient | undefined {
		const ext = extname(filePath).slice(1); // Remove leading dot
		const serverName = this.languageToServer.get(ext);
		if (!serverName) return undefined;
		return this.clients.get(serverName);
	}

	/**
	 * Absolute filesystem path for a file. Relative paths resolve against the
	 * session cwd, as the file tools do.
	 */
	private toFsPath(filePath: string): string {
		if (filePath.startsWith('file://')) return fileURLToPath(filePath);
		return resolve(getSessionCwd(), filePath);
	}

	/**
	 * Convert file path to URI
	 */
	private fileToUri(filePath: string): string {
		if (filePath.startsWith('file://')) return normalizeUri(filePath);
		return pathToFileURL(this.toFsPath(filePath)).href;
	}

	/**
	 * Open a document in the appropriate language server. A document that is
	 * already open is updated instead, and left alone when its text has not
	 * changed, so its cached diagnostics stay valid.
	 */
	async openDocument(filePath: string, content?: string): Promise<boolean> {
		const client = this.getClientForFile(filePath);
		if (!client || !client.isReady()) return false;

		const uri = this.fileToUri(filePath);
		const ext = extname(filePath).slice(1);
		const languageId = getLanguageId(ext);

		// Read content if not provided
		const text = content ?? (await readFile(this.toFsPath(filePath), 'utf-8'));

		const previous = this.openTexts.get(uri);
		if (previous === text) return true;

		// Whatever was published describes the old text.
		this.diagnosticsCache.delete(uri);
		this.diagnosticsTimedOut.delete(uri);
		if (previous === undefined) {
			client.openDocument(uri, languageId, text);
		} else {
			client.updateDocument(uri, text);
		}
		this.openTexts.set(uri, text);
		this.documentServers.set(uri, client.getCapabilities() ? 'active' : '');

		return true;
	}

	/**
	 * Update a document in the language server
	 */
	updateDocument(filePath: string, content: string): boolean {
		const client = this.getClientForFile(filePath);
		if (!client || !client.isReady()) return false;

		const uri = this.fileToUri(filePath);
		if (this.openTexts.get(uri) === content) return true;
		this.diagnosticsCache.delete(uri);
		this.diagnosticsTimedOut.delete(uri);
		if (this.openTexts.has(uri)) {
			client.updateDocument(uri, content);
		} else {
			client.openDocument(
				uri,
				getLanguageId(extname(filePath).slice(1)),
				content,
			);
		}
		this.openTexts.set(uri, content);

		return true;
	}

	/**
	 * Close a document in the language server
	 */
	closeDocument(filePath: string): boolean {
		const client = this.getClientForFile(filePath);
		if (!client || !client.isReady()) return false;

		const uri = this.fileToUri(filePath);
		client.closeDocument(uri);
		this.documentServers.delete(uri);
		this.diagnosticsCache.delete(uri);
		this.openTexts.delete(uri);
		this.diagnosticsTimedOut.delete(uri);

		return true;
	}

	/**
	 * Get diagnostics for a file. For a document opened but not yet checked,
	 * waits (bounded) for the server's first result rather than reporting it
	 * clean.
	 */
	async getDiagnostics(filePath: string): Promise<Diagnostic[]> {
		const uri = this.fileToUri(filePath);

		// First check cache (from push notifications)
		const cached = this.diagnosticsCache.get(uri);
		if (cached) return cached;

		const client = this.getClientForFile(filePath);
		if (!client || !client.isReady()) return [];

		// A server that supports pull answers for the current text directly.
		if (client.getCapabilities()?.diagnosticProvider) {
			return client.getDiagnostics(uri);
		}

		// Push only: wait for the first publish for a document we opened.
		if (!this.openTexts.has(uri) || this.diagnosticsTimedOut.has(uri)) {
			return [];
		}
		const published = await this.waitForDiagnostics(
			uri,
			FIRST_DIAGNOSTICS_WAIT_MS,
		);
		if (published) return published;
		this.diagnosticsTimedOut.add(uri);
		return [];
	}

	/** The next diagnostics published for `uri`, or undefined on timeout. */
	private waitForDiagnostics(
		uri: string,
		timeoutMs: number,
	): Promise<Diagnostic[] | undefined> {
		return new Promise(resolvePublished => {
			const onDiagnostics = (params: PublishDiagnosticsParams) => {
				if (params.uri !== uri) return;
				finish(params.diagnostics);
			};
			const timer = setTimeout(() => finish(undefined), timeoutMs);
			const finish = (result: Diagnostic[] | undefined) => {
				clearTimeout(timer);
				this.off('diagnostics', onDiagnostics);
				resolvePublished(result);
			};
			this.on('diagnostics', onDiagnostics);
		});
	}

	/**
	 * Get diagnostics for all open documents
	 */
	getAllDiagnostics(): DiagnosticsResult[] {
		const results: DiagnosticsResult[] = [];

		for (const [uri, diagnostics] of this.diagnosticsCache.entries()) {
			if (diagnostics.length > 0) {
				results.push({uri, diagnostics});
			}
		}

		return results;
	}

	/**
	 * Get completions at a position in a file
	 */
	async getCompletions(
		filePath: string,
		line: number,
		character: number,
	): Promise<CompletionItem[]> {
		const client = this.getClientForFile(filePath);
		if (!client || !client.isReady()) return [];

		const uri = this.fileToUri(filePath);
		return client.getCompletions(uri, {line, character});
	}

	/**
	 * Get code actions for a range in a file
	 */
	async getCodeActions(
		filePath: string,
		startLine: number,
		startChar: number,
		endLine: number,
		endChar: number,
		diagnostics?: Diagnostic[],
	): Promise<CodeAction[]> {
		const client = this.getClientForFile(filePath);
		if (!client || !client.isReady()) return [];

		const uri = this.fileToUri(filePath);

		// Use provided diagnostics or get from cache
		const diags =
			diagnostics ||
			this.diagnosticsCache.get(uri)?.filter(d => {
				// Filter diagnostics that overlap with the range
				return d.range.start.line <= endLine && d.range.end.line >= startLine;
			}) ||
			[];

		return client.getCodeActions(
			uri,
			diags,
			startLine,
			startChar,
			endLine,
			endChar,
		);
	}

	/**
	 * Format a document
	 */
	async formatDocument(
		filePath: string,
		options?: Partial<FormattingOptions>,
	): Promise<TextEdit[]> {
		const client = this.getClientForFile(filePath);
		if (!client || !client.isReady()) return [];

		const uri = this.fileToUri(filePath);
		return client.formatDocument(uri, options);
	}

	/**
	 * Whether the language server for this file advertises document formatting.
	 */
	supportsDocumentFormatting(filePath: string): boolean {
		const client = this.getClientForFile(filePath);
		if (!client || !client.isReady()) return false;
		return Boolean(client.getCapabilities()?.documentFormattingProvider);
	}

	/**
	 * Check if LSP is available for a file type
	 */
	hasLanguageSupport(filePath: string): boolean {
		const ext = extname(filePath).slice(1);
		return this.languageToServer.has(ext);
	}

	/**
	 * Get list of connected servers
	 */
	getConnectedServers(): string[] {
		return Array.from(this.clients.keys());
	}

	/**
	 * Get supported languages
	 */
	getSupportedLanguages(): string[] {
		return Array.from(this.languageToServer.keys());
	}

	/**
	 * Check if manager is initialized
	 */
	isInitialized(): boolean {
		return this.initialized;
	}

	/**
	 * Get server status
	 */
	getStatus(): {
		initialized: boolean;
		servers: Array<{name: string; ready: boolean; languages: string[]}>;
	} {
		const servers: Array<{name: string; ready: boolean; languages: string[]}> =
			[];

		for (const [name, client] of this.clients.entries()) {
			const languages: string[] = [];
			for (const [lang, serverName] of this.languageToServer.entries()) {
				if (serverName === name) {
					languages.push(lang);
				}
			}
			servers.push({
				name,
				ready: client.isReady(),
				languages,
			});
		}

		return {
			initialized: this.initialized,
			servers,
		};
	}
}

// Singleton instance
let lspManagerInstance: LSPManager | null = null;
let lspManagerInitPromise: Promise<LSPManager> | null = null;

/**
 * Get or create the LSP manager singleton
 * Uses promise-based initialization to prevent race conditions
 */
export async function getLSPManager(
	config?: LSPManagerConfig,
): Promise<LSPManager> {
	if (lspManagerInstance) {
		return lspManagerInstance;
	}

	if (lspManagerInitPromise) {
		return lspManagerInitPromise;
	}

	// Create manager synchronously to ensure instance is set immediately
	lspManagerInstance = new LSPManager(config);
	lspManagerInitPromise = Promise.resolve(lspManagerInstance);

	getShutdownManager().register({
		name: 'lsp-manager',
		priority: 30,
		handler: async () => {
			if (lspManagerInstance) {
				await lspManagerInstance.shutdown();
			}
		},
	});

	return lspManagerInitPromise;
}

/**
 * Reset the LSP manager (for testing)
 */
export async function resetLSPManager(): Promise<void> {
	if (lspManagerInstance) {
		await lspManagerInstance.shutdown();
		lspManagerInstance = null;
	}
	lspManagerInitPromise = null;
}
