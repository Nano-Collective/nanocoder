/**
 * LSP Manager
 * Manages multiple language server connections with auto-discovery and routing
 */

import {EventEmitter} from 'events';
import {extname} from 'path';
import {readFile} from 'fs/promises';
import {LSPClient, LSPServerConfig} from './lsp-client';
import {discoverLanguageServers, getLanguageId} from './server-discovery';
import {
	Diagnostic,
	PublishDiagnosticsParams,
	CompletionItem,
	CodeAction,
	TextEdit,
	FormattingOptions,
} from './protocol';

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

export interface LSPConnectionStatus {
	totalCount: number;
	connectedCount: number;
	errorCount: number;
	servers: {
		name: string;
		connected: boolean;
		languages?: string[];
		error?: string;
	}[];
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
	private rootUri: string;
	private initialized: boolean = false;

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
			const discovered = await discoverLanguageServers();

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
				this.clients.delete(config.name);
				// Remove language mappings for this server
				for (const [lang, serverName] of this.languageToServer.entries()) {
					if (serverName === config.name) {
						this.languageToServer.delete(lang);
					}
				}
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
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Stop all language servers
	 */
	async shutdown(): Promise<void> {
		const stopPromises = Array.from(this.clients.values()).map(client =>
			client.stop(),
		);
		await Promise.all(stopPromises);

		this.clients.clear();
		this.languageToServer.clear();
		this.documentServers.clear();
		this.diagnosticsCache.clear();
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

/**
 * Get or create the LSP manager singleton
 */
export function getLSPManager(config?: LSPManagerConfig): LSPManager {
	if (!lspManagerInstance) {
		lspManagerInstance = new LSPManager(config);
	}
	return lspManagerInstance;
}

/**
 * Reset the LSP manager (for testing)
 */
export async function resetLSPManager(): Promise<void> {
	if (lspManagerInstance) {
		await lspManagerInstance.shutdown();
		lspManagerInstance = null;
	}
}
