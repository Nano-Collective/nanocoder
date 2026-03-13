import type {
	AISDKCoreTool,
	StreamingFormatter,
	ToolEntry,
	ToolFormatter,
	ToolHandler,
	ToolValidator,
} from '@/types/index';

/**
 * Helper class to encapsulate tool registry management
 *
 * This class provides structured access to tool metadata and eliminates
 * the need to manage multiple separate registries manually.
 *
 * Benefits:
 * - Single source of truth for all tool metadata
 * - Type-safe access to tool components
 * - Cleaner API for tool registration and lookup
 * - Easier to extend with future metadata
 */
export class ToolRegistry {
	private tools: Map<string, ToolEntry> = new Map();

	/**
	 * Register a complete tool entry
	 * @param entry - The ToolEntry containing all tool metadata
	 */
	register(entry: ToolEntry): void {
		this.tools.set(entry.name, entry);
	}

	/**
	 * Register multiple tool entries at once
	 * @param entries - Array of ToolEntry objects
	 */
	registerMany(entries: ToolEntry[]): void {
		for (const entry of entries) {
			this.register(entry);
		}
	}

	/**
	 * Unregister a tool by name
	 * @param name - The tool name
	 */
	unregister(name: string): void {
		this.tools.delete(name);
	}

	/**
	 * Unregister multiple tools by name
	 * @param names - Array of tool names
	 */
	unregisterMany(names: string[]): void {
		for (const name of names) {
			this.unregister(name);
		}
	}

	/**
	 * Get a complete tool entry by name
	 * @param name - The tool name
	 * @returns The ToolEntry or undefined if not found
	 */
	getEntry(name: string): ToolEntry | undefined {
		return this.tools.get(name);
	}

	/**
	 * Get a tool handler by name
	 * @param name - The tool name
	 * @returns The ToolHandler or undefined if not found
	 */
	getHandler(name: string): ToolHandler | undefined {
		return this.tools.get(name)?.handler;
	}

	/**
	 * Get a tool formatter by name
	 * @param name - The tool name
	 * @returns The ToolFormatter or undefined if not found
	 */
	getFormatter(name: string): ToolFormatter | undefined {
		return this.tools.get(name)?.formatter;
	}

	/**
	 * Get a tool validator by name
	 * @param name - The tool name
	 * @returns The ToolValidator or undefined if not found
	 */
	getValidator(name: string): ToolValidator | undefined {
		return this.tools.get(name)?.validator;
	}

	/**
	 * Get a streaming formatter by name
	 * @param name - The tool name
	 * @returns The StreamingFormatter or undefined if not found
	 */
	getStreamingFormatter(name: string): StreamingFormatter | undefined {
		return this.tools.get(name)?.streamingFormatter;
	}

	/**
	 * Get the native AI SDK tool by name
	 * @param name - The tool name
	 * @returns The AISDKCoreTool or undefined if not found
	 */
	getTool(name: string): AISDKCoreTool | undefined {
		return this.tools.get(name)?.tool;
	}

	/**
	 * Get all handler entries as a record (compatible with old API)
	 * @returns Record mapping tool names to handlers
	 */
	getHandlers(): Record<string, ToolHandler> {
		const handlers: Record<string, ToolHandler> = {};
		for (const [name, entry] of this.tools) {
			handlers[name] = entry.handler;
		}
		return handlers;
	}

	/**
	 * Get all formatter entries as a record (compatible with old API)
	 * @returns Record mapping tool names to formatters
	 */
	getFormatters(): Record<string, ToolFormatter> {
		const formatters: Record<string, ToolFormatter> = {};
		for (const [name, entry] of this.tools) {
			if (entry.formatter) {
				formatters[name] = entry.formatter;
			}
		}
		return formatters;
	}

	/**
	 * Get all validator entries as a record (compatible with old API)
	 * @returns Record mapping tool names to validators
	 */
	getValidators(): Record<string, ToolValidator> {
		const validators: Record<string, ToolValidator> = {};
		for (const [name, entry] of this.tools) {
			if (entry.validator) {
				validators[name] = entry.validator;
			}
		}
		return validators;
	}

	/**
	 * Get all native AI SDK tools as a record (compatible with old API)
	 * Tools with validators get their execute functions wrapped so that
	 * validation runs before execution in all code paths, including
	 * AI SDK auto-execution which bypasses external validator checks.
	 * @returns Record mapping tool names to AISDKCoreTool objects
	 */
	getNativeTools(): Record<string, AISDKCoreTool> {
		const nativeTools: Record<string, AISDKCoreTool> = {};
		for (const [name, entry] of this.tools) {
			if (entry.validator && entry.tool.execute) {
				const originalExecute = entry.tool.execute;
				const validator = entry.validator;
				nativeTools[name] = {
					...entry.tool,
					execute: async (args: unknown, options: unknown) => {
						const validationResult = await validator(args);
						if (!validationResult.valid) {
							throw new Error(validationResult.error);
						}
						return (originalExecute as Function).call(
							entry.tool,
							args,
							options,
						);
					},
				};
			} else {
				nativeTools[name] = entry.tool;
			}
		}
		return nativeTools;
	}

	/**
	 * Get all tool entries
	 * @returns Array of all ToolEntry objects
	 */
	getAllEntries(): ToolEntry[] {
		return Array.from(this.tools.values());
	}

	/**
	 * Get all tool names
	 * @returns Array of all registered tool names
	 */
	getToolNames(): string[] {
		return Array.from(this.tools.keys());
	}

	/**
	 * Check if a tool is registered
	 * @param name - The tool name
	 * @returns True if the tool exists, false otherwise
	 */
	hasTool(name: string): boolean {
		return this.tools.has(name);
	}

	/**
	 * Get the number of registered tools
	 * @returns The count of registered tools
	 */
	getToolCount(): number {
		return this.tools.size;
	}

	/**
	 * Clear all registered tools
	 */
	clear(): void {
		this.tools.clear();
	}

	/**
	 * Create a new registry from static registries (backward compatibility helper)
	 * @param handlers - Record of tool handlers
	 * @param tools - Record of native AI SDK tools
	 * @param formatters - Optional record of tool formatters
	 * @param validators - Optional record of tool validators
	 * @param streamingFormatters - Optional record of streaming formatters
	 * @returns New ToolRegistry instance
	 */
	static fromRegistries(
		handlers: Record<string, ToolHandler>,
		tools: Record<string, AISDKCoreTool>,
		formatters?: Record<string, ToolFormatter>,
		validators?: Record<string, ToolValidator>,
		streamingFormatters?: Record<string, StreamingFormatter>,
	): ToolRegistry {
		const registry = new ToolRegistry();

		for (const [name, handler] of Object.entries(handlers)) {
			const tool = tools[name];
			if (tool) {
				registry.register({
					name,
					handler,
					tool,
					formatter: formatters?.[name],
					validator: validators?.[name],
					streamingFormatter: streamingFormatters?.[name],
				});
			}
		}

		return registry;
	}
}
