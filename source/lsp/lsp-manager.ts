/**
 * LSP Manager
 * Manages multiple language server connections with auto-discovery and routing
 */

import {EventEmitter} from 'events';
import {readFile} from 'fs/promises';
import {extname, resolve} from 'path';
import {fileURLToPath} from 'url';
import {getCachedFileContent} from '@/utils/file-cache';
import {LSPClient, LSPServerConfig} from './lsp-client';
import {
	CodeAction,
	CompletionItem,
	Diagnostic,
	DocumentSymbol,
	FormattingOptions,
	Location,
	PublishDiagnosticsParams,
	SymbolInformation,
	TextEdit,
	WorkspaceEdit,
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
	 * Get the client for a file based on its extension (sync, for backward compatibility)
	 */
	private getClientForFile(filePath: string): LSPClient | undefined {
		const ext = extname(filePath).slice(1); // Remove leading dot
		const serverName = this.languageToServer.get(ext);
		if (!serverName) return undefined;
		return this.clients.get(serverName);
	}

	/**
	 * Get the client for a file based on its extension (async, with error throwing)
	 */
	private async getClientForFileOrThrow(filePath: string): Promise<LSPClient> {
		const ext = extname(filePath).replace('.', '');
		const serverName = this.languageToServer.get(ext);

		if (!serverName) {
			throw new Error(
				`No LSP server configured for .${ext} files. ` +
					`Configure a language server in agents.config.json or start with --vscode.`,
			);
		}

		const client = this.clients.get(serverName);
		if (!client) {
			throw new Error(`LSP server '${serverName}' not found`);
		}

		if (!client.isReady()) {
			throw new Error(
				`LSP server '${serverName}' is not ready. ` +
					`Wait a moment for it to finish starting up.`,
			);
		}

		return client;
	}

	/**
	 * Ensure document is open in LSP server
	 */
	private async ensureDocumentOpen(
		client: LSPClient,
		uri: string,
		filePath: string,
	): Promise<void> {
		if (!client.isDocumentOpen(uri)) {
			const content = await getCachedFileContent(filePath);
			const languageId = getLanguageId(extname(filePath).replace('.', ''));
			client.openDocument(uri, languageId, content.content);
		}
	}

	/**
	 * Convert file path to LSP URI
	 */
	private filePathToUri(filePath: string): string {
		const resolved = resolve(filePath);
		return `file://${resolved}`;
	}

	/**
	 * Convert file path to URI (deprecated, use filePathToUri)
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
	 * Find all references to a symbol
	 */
	async findReferences(
		filePath: string,
		line: number,
		character: number,
		includeDeclaration: boolean = true,
	): Promise<Location[]> {
		const client = await this.getClientForFileOrThrow(filePath);
		const uri = this.filePathToUri(filePath);

		await this.ensureDocumentOpen(client, uri, filePath);

		return await client.requestReferences({
			textDocument: {uri},
			position: {line: line - 1, character: character - 1},
			context: {includeDeclaration},
		});
	}

	/**
	 * Go to definition for a symbol
	 */
	async goToDefinition(
		filePath: string,
		line: number,
		character: number,
	): Promise<Location | Location[] | null> {
		const client = await this.getClientForFileOrThrow(filePath);
		const uri = this.filePathToUri(filePath);

		await this.ensureDocumentOpen(client, uri, filePath);

		return await client.requestDefinition({
			textDocument: {uri},
			position: {line: line - 1, character: character - 1},
		});
	}

	/**
	 * Get document symbols
	 */
	async getDocumentSymbols(
		filePath: string,
	): Promise<DocumentSymbol[] | SymbolInformation[]> {
		const client = await this.getClientForFileOrThrow(filePath);
		const uri = this.filePathToUri(filePath);

		await this.ensureDocumentOpen(client, uri, filePath);

		return await client.requestDocumentSymbols({
			textDocument: {uri},
		});
	}

	/**
	 * Rename symbol across workspace
	 */
	async renameSymbol(
		filePath: string,
		line: number,
		character: number,
		newName: string,
	): Promise<WorkspaceEdit> {
		const client = await this.getClientForFileOrThrow(filePath);
		const uri = this.filePathToUri(filePath);

		await this.ensureDocumentOpen(client, uri, filePath);

		return await client.requestRename({
			textDocument: {uri},
			position: {line: line - 1, character: character - 1},
			newName,
		});
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
