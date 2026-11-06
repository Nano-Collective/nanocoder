import type {MCPTool, MCPToolCatalogEntry} from '@/types/mcp';

/**
 * Sanitizes catalog tool names and descriptions to mitigate prompt injection
 * and ensure compact display in the prompt:
 * - Collapses newlines, carriage returns, tabs, and multiple spaces into a single space
 * - Strips HTML tags and markdown delimiters (`*_#~)
 * - Truncates to a maximum of 120 characters, appending '...' when truncated
 */
export function sanitizeCatalogText(text: string): string {
	if (!text) return '';
	let sanitized = text
		.replace(/[\r\n\t]+/g, ' ')
		.replace(/[<>`*_#~]/g, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
	if (sanitized.length > 120) {
		sanitized = `${sanitized.slice(0, 117)}...`;
	}
	return sanitized;
}

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
		const name = tool.name.replace(/[\r\n\t`]+/g, '').trim();
		const description = sanitizeCatalogText(
			tool.description?.trim() || 'No description provided',
		);
		const cleanServerName = serverName.replace(/[\r\n\t`]+/g, '').trim();
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
