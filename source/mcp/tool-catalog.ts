import type {MCPTool, MCPToolCatalogEntry} from '@/types/mcp';

/**
 * Sanitizes catalog tool names and descriptions to mitigate prompt injection
 * and ensure compact display in the prompt:
 * - Collapses whitespace (spaces, newlines, tabs, vertical tabs, Unicode separators) into a single space
 * - Strips HTML tags and markdown delimiters (`*_#~)
 * - Truncates to a maximum of 120 characters, appending '...' when truncated
 */
export function sanitizeCatalogText(text: string): string {
	if (!text) return '';
	let sanitized = text
		.replace(/[<>`*_#~]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (sanitized.length > 120) {
		sanitized = `${sanitized.slice(0, 117)}...`;
	}
	return sanitized;
}

/**
 * Manages an index of available MCP tools for on-demand lazy discovery.
 * Prevents hydrating large JSON schemas into the prompt up-front.
 * Supports layering over a parent catalog for ACP sessions so a session's
 * disconnect or schema loading does not wipe or corrupt the parent catalog.
 */
export class MCPToolCatalog {
	private entries: Map<string, MCPToolCatalogEntry> = new Map();
	private readonly parent?: MCPToolCatalog;

	constructor(parent?: MCPToolCatalog) {
		this.parent = parent;
	}

	/**
	 * Registers an MCP tool into the catalog.
	 */
	add(serverName: string, tool: MCPTool, isLoaded = false): void {
		const name = tool.name.replace(/[\s`]+/g, '').trim();
		const description = sanitizeCatalogText(
			tool.description?.trim() || 'No description provided',
		);
		const cleanServerName = serverName.replace(/[\s`]+/g, '').trim();
		this.entries.set(name, {
			name,
			serverName: cleanServerName,
			description,
			readOnly: tool.readOnly === true,
			isLoaded,
			inputSchema: tool.inputSchema,
		});
	}

	/**
	 * Retrieves an entry from the catalog by tool name, falling back to parent catalog.
	 */
	get(name: string): MCPToolCatalogEntry | undefined {
		return this.entries.get(name) ?? this.parent?.get(name);
	}

	/**
	 * Checks if a tool name exists in the catalog or parent catalog.
	 */
	has(name: string): boolean {
		return this.entries.has(name) || (this.parent?.has(name) ?? false);
	}

	/**
	 * Returns all catalog entries, combining parent's and this layer's entries.
	 */
	getAll(): MCPToolCatalogEntry[] {
		if (!this.parent) {
			return Array.from(this.entries.values());
		}
		const merged = new Map<string, MCPToolCatalogEntry>();
		for (const entry of this.parent.getAll()) {
			merged.set(entry.name, entry);
		}
		for (const entry of this.entries.values()) {
			merged.set(entry.name, entry);
		}
		return Array.from(merged.values());
	}

	/**
	 * Returns all tools that have not yet been dynamically hydrated into the active registry.
	 */
	getUnloaded(): MCPToolCatalogEntry[] {
		return this.getAll().filter(entry => !entry.isLoaded);
	}

	/**
	 * Returns all tools that have already been hydrated into the active registry.
	 */
	getLoaded(): MCPToolCatalogEntry[] {
		return this.getAll().filter(entry => entry.isLoaded);
	}

	/**
	 * Checks whether a tool is currently loaded.
	 */
	isLoaded(name: string): boolean {
		return this.get(name)?.isLoaded ?? false;
	}

	/**
	 * Marks a tool as loaded in the catalog.
	 * If the tool exists only in the parent catalog, shadows it locally so parent remains untouched.
	 */
	markLoaded(name: string): boolean {
		const local = this.entries.get(name);
		if (local) {
			local.isLoaded = true;
			return true;
		}
		const parentEntry = this.parent?.get(name);
		if (parentEntry) {
			this.entries.set(name, {...parentEntry, isLoaded: true});
			return true;
		}
		return false;
	}

	/**
	 * Removes all tools belonging to a specific server in this catalog layer.
	 */
	removeServerTools(serverName: string): string[] {
		const removed: string[] = [];
		for (const [name, entry] of this.entries.entries()) {
			if (entry.serverName === serverName) {
				this.entries.delete(name);
				removed.push(name);
			}
		}
		return removed;
	}

	/**
	 * Clears this layer's catalog entries without modifying the parent catalog.
	 */
	clear(): void {
		this.entries.clear();
	}

	/**
	 * Total number of catalog entries visible.
	 */
	get size(): number {
		return this.getAll().length;
	}

	/**
	 * Formats a compact catalog summary for system prompt injection.
	 */
	formatCatalogSection(): string {
		const unloaded = this.getUnloaded();
		if (unloaded.length === 0) {
			return '';
		}

		const lines: string[] = [
			'### Available On-Demand MCP Tools (Catalog)',
			'The following tools are available via MCP servers. Call `load_tool_schema` with `tool_name` to view full parameter definitions and activate the tool for use in subsequent turns:',
		];

		for (const tool of unloaded) {
			const roBadge = tool.readOnly ? ' [read-only]' : '';
			lines.push(
				`- \`${tool.name}\` (${tool.serverName}): ${tool.description}${roBadge}`,
			);
		}

		return lines.join('\n');
	}
}
