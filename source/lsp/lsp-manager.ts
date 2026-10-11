/**
 * LSP Manager
 * Manages multiple language server connections with auto-discovery and routing
 */

import {EventEmitter} from 'node:events';
import {readFile} from 'fs/promises';
import {extname} from 'path';
import {fileURLToPath} from 'url';
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

export interface DiagnosticsResult {
	uri: string;
	diagnostics: Diagnostic[];
}

export class LSPManager extends EventEmitter {
	private clients: Map<string, LSPClient> = new Map(); // serverName -> client
	private languageToServer: Map<string, string> = new Map(); // extension -> serverName
	private documentServers: Map<string, string> = new Map(); // uri -> serverName
	private diagnosticsCache: Map<string, Diagnostic[]> = new Map(); // uri -> diagnostics
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
				this.diagnosticsCache.set(params.uri, params.diagnostics);
				this.emit('diagnostics', params);
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

			await client.start();

			// Store client and language mappings
			this.clients.set(config.name, client);
			for (const lang of config.languages) {
				this.languageToServer.set(lang, config.name);
			}

			return {
				serverName: config.name,
				success: true,
				languages: config.languages,
			};
		} catch (error) {
			return {
				serverName: config.name,
				success: false,
				error: formatError(error),
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
	 * Convert file path to URI
	 */
	private fileToUri(filePath: string): string {
		if (filePath.startsWith('file://')) return filePath;
		return `file://${filePath}`;
	}

	/**
	 * Open a document in the appropriate language server
	 */
	async openDocument(filePath: string, content?: string): Promise<boolean> {
		const client = this.getClientForFile(filePath);
		if (!client || !client.isReady()) return false;

		const uri = this.fileToUri(filePath);
		const ext = extname(filePath).slice(1);
		const languageId = getLanguageId(ext);

		// Read content if not provided
		const text = content ?? (await readFile(filePath, 'utf-8'));

		client.openDocument(uri, languageId, text);
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
		client.updateDocument(uri, content);

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

		return true;
	}

	/**
	 * Get diagnostics for a file
	 */
	async getDiagnostics(filePath: string): Promise<Diagnostic[]> {
		const uri = this.fileToUri(filePath);

		// First check cache (from push notifications)
		const cached = this.diagnosticsCache.get(uri);
		if (cached) return cached;

		// Try pull diagnostics
		const client = this.getClientForFile(filePath);
		if (!client || !client.isReady()) return [];

		return client.getDiagnostics(uri);
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
