import type {MCPTool, MCPToolCatalogEntry} from '@/types/mcp';

/**
 * Manages an index of available MCP tools for on-demand lazy discovery.
 * Prevents hydrating large JSON schemas into the prompt up-front.
 */
export class MCPToolCatalog {
	private entries: Map<string, MCPToolCatalogEntry> = new Map();

	/**
	 * Registers an MCP tool into the catalog.
	 */
	add(serverName: string, tool: MCPTool, isLoaded = false): void {
		const description = tool.description?.trim() || 'No description provided';
		this.entries.set(tool.name, {
			name: tool.name,
			serverName,
			description,
			readOnly: tool.readOnly === true,
			isLoaded,
			inputSchema: tool.inputSchema,
		});
	}

	/**
	 * Retrieves an entry from the catalog by tool name.
	 */
	get(name: string): MCPToolCatalogEntry | undefined {
		return this.entries.get(name);
	}

	/**
	 * Checks if a tool name exists in the catalog.
	 */
	has(name: string): boolean {
		return this.entries.has(name);
	}

	/**
	 * Returns all catalog entries.
	 */
	getAll(): MCPToolCatalogEntry[] {
		return Array.from(this.entries.values());
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
		return this.entries.get(name)?.isLoaded ?? false;
	}

	/**
	 * Marks a tool as loaded in the catalog.
	 */
	markLoaded(name: string): boolean {
		const entry = this.entries.get(name);
		if (entry) {
			entry.isLoaded = true;
			return true;
		}
		return false;
	}

	/**
	 * Removes all tools belonging to a specific server (e.g. on disconnect or unhealthy).
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
	 * Clears the catalog.
	 */
	clear(): void {
		this.entries.clear();
	}

	/**
	 * Total number of catalog entries.
	 */
	get size(): number {
		return this.entries.size;
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
