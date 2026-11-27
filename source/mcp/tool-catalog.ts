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
 * Whether a recovered server's account of a tool differs from the stored
 * one. The schema is compared by serialization: both sides are parsed from
 * the server's own JSON, so an unchanged schema stringifies identically, and
 * a false "changed" only costs one rewrite.
 */
function hasChanged(
	stored: MCPToolCatalogEntry,
	fresh: MCPToolCatalogEntry,
): boolean {
	return (
		stored.serverName !== fresh.serverName ||
		stored.description !== fresh.description ||
		stored.readOnly !== fresh.readOnly ||
		stored.isLoaded !== fresh.isLoaded ||
		JSON.stringify(stored.inputSchema) !== JSON.stringify(fresh.inputSchema)
	);
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

	/** Sanitized catalog record for a tool, without storing it. */
	private normalize(
		serverName: string,
		tool: MCPTool,
		isLoaded: boolean,
	): MCPToolCatalogEntry {
		return {
			name: tool.name.replace(/[\s`]+/g, '').trim(),
			serverName: serverName.replace(/[\s`]+/g, '').trim(),
			description: sanitizeCatalogText(
				tool.description?.trim() || 'No description provided',
			),
			readOnly: tool.readOnly === true,
			isLoaded,
			inputSchema: tool.inputSchema,
		};
	}

	/**
	 * Registers an MCP tool into the catalog.
	 */
	add(serverName: string, tool: MCPTool, isLoaded = false): void {
		const entry = this.normalize(serverName, tool, isLoaded);
		this.entries.set(entry.name, entry);
	}

	/**
	 * Updates an entry from a recovered server's own account of a tool,
	 * keeping whether it is loaded unless told otherwise. Returns whether
	 * anything actually changed.
	 *
	 * Unloaded entries render into the system prompt, so an entry that has
	 * not changed has to be left exactly as it was, or a server reconnecting
	 * costs every later turn its cached prefix for nothing (#1574). An entry
	 * that *has* changed must be written even at that price:
	 * `load_tool_schema` hands the model this stored schema, and a read-only
	 * badge the server no longer agrees with is worse than a broken prefix.
	 */
	refresh(serverName: string, tool: MCPTool, isLoaded?: boolean): boolean {
		const existing = this.get(tool.name.replace(/[\s`]+/g, '').trim());
		const next = this.normalize(
			serverName,
			tool,
			isLoaded ?? existing?.isLoaded ?? false,
		);
		if (existing && !hasChanged(existing, next)) return false;
		this.entries.set(next.name, next);
		return true;
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
