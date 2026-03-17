/**
 * Subagent Loader
 *
 * Handles loading and discovery of subagent definitions from various sources:
 * - Built-in definitions (explore, plan)
 * - User-level configuration (~/.config/nanocoder/agents/)
 * - Project-level configuration (.nanocoder/agents/)
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
	SubagentConfig,
	SubagentConfigWithSource,
	SubagentLoadPriority,
} from './types.js';

/**
 * SubagentLoader manages loading subagent definitions from multiple sources.
 * Sources are loaded in priority order (project > user > built-in).
 */
export class SubagentLoader {
	/** Cache of loaded subagent configs */
	private cache: Map<string, SubagentConfigWithSource> = new Map();

	/** Whether the cache has been initialized */
	private initialized = false;

	/** Project root directory */
	private projectRoot: string;

	/**
	 * Create a new SubagentLoader.
	 * @param projectRoot - The project root directory
	 */
	constructor(projectRoot: string = process.cwd()) {
		this.projectRoot = projectRoot;
	}

	/**
	 * Initialize the loader by loading all available subagents.
	 */
	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}

		// Load built-in subagents first (lowest priority)
		const builtInAgents = this.getBuiltInSubagents();
		for (const config of builtInAgents) {
			this.cache.set(config.name, {
				...config,
				source: {
					priority: 0, // BuiltIn
					isBuiltIn: true,
				},
			});
		}

		// Load user-level agents
		const userAgentsPath = this.getUserAgentsPath();
		const userAgents = await this.loadFromDirectory(
			userAgentsPath,
			1, // User priority
		);
		for (const config of userAgents) {
			this.cache.set(config.name, config);
		}

		// Load project-level agents (highest priority, overrides others)
		const projectAgentsPath = this.getProjectAgentsPath();
		const projectAgents = await this.loadFromDirectory(
			projectAgentsPath,
			2, // Project priority
		);
		for (const config of projectAgents) {
			this.cache.set(config.name, config);
		}

		this.initialized = true;
	}

	/**
	 * Get a specific subagent by name.
	 * @param name - The subagent name
	 * @returns The subagent config or null if not found
	 */
	async getSubagent(name: string): Promise<SubagentConfigWithSource | null> {
		if (!this.initialized) {
			await this.initialize();
		}

		return this.cache.get(name) || null;
	}

	/**
	 * List all available subagents.
	 * @returns Array of all available subagent configs
	 */
	async listSubagents(): Promise<SubagentConfigWithSource[]> {
		if (!this.initialized) {
			await this.initialize();
		}

		return Array.from(this.cache.values());
	}

	/**
	 * Check if a subagent exists.
	 * @param name - The subagent name
	 * @returns True if the subagent exists
	 */
	async hasSubagent(name: string): Promise<boolean> {
		if (!this.initialized) {
			await this.initialize();
		}

		return this.cache.has(name);
	}

	/**
	 * Reload all subagent definitions.
	 * Useful for picking up changes to custom agents.
	 */
	async reload(): Promise<void> {
		this.cache.clear();
		this.initialized = false;
		await this.initialize();
	}

	/**
	 * Get the user-level agents directory path.
	 */
	private getUserAgentsPath(): string {
		const platform = process.platform;

		if (platform === 'darwin') {
			// macOS: ~/Library/Preferences/nanocoder/agents/
			return path.join(
				os.homedir(),
				'Library',
				'Preferences',
				'nanocoder',
				'agents',
			);
		}
		if (platform === 'win32') {
			// Windows: %APPDATA%/nanocoder/agents/
			return path.join(
				process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
				'nanocoder',
				'agents',
			);
		}
		// Linux and others: ~/.config/nanocoder/agents/
		return path.join(os.homedir(), '.config', 'nanocoder', 'agents');
	}

	/**
	 * Get the project-level agents directory path.
	 */
	private getProjectAgentsPath(): string {
		return path.join(this.projectRoot, '.nanocoder', 'agents');
	}

	/**
	 * Load subagent definitions from a directory.
	 * @param dirPath - Directory path to load from
	 * @param priority - Priority level for loaded configs
	 * @returns Array of subagent configs with source info
	 */
	private async loadFromDirectory(
		dirPath: string,
		priority: SubagentLoadPriority,
	): Promise<SubagentConfigWithSource[]> {
		try {
			await fs.access(dirPath);
		} catch {
			// Directory doesn't exist, return empty array
			return [];
		}

		const agents: SubagentConfigWithSource[] = [];
		const entries = await fs.readdir(dirPath, {withFileTypes: true});

		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith('.md')) {
				continue;
			}

			const filePath = path.join(dirPath, entry.name);
			try {
				const {parseSubagentMarkdown} = await import('./markdown-parser.js');
				const parsed = await parseSubagentMarkdown(filePath);
				agents.push({
					...parsed.config,
					source: {
						priority,
						filePath,
						isBuiltIn: false,
					},
				});
			} catch (error) {
				// Log error but continue loading other files
				console.error(`Failed to load agent from ${filePath}:`, error);
			}
		}

		return agents;
	}

	/**
	 * Get built-in subagent definitions.
	 * These are the default agents that ship with Nanocoder.
	 */
	private getBuiltInSubagents(): SubagentConfig[] {
		return [
			{
				name: 'explore',
				description:
					'Fast, read-only agent for codebase exploration, file discovery, and pattern searching. Use when you need to understand the codebase structure or find specific code patterns.',
				model: 'inherit',
				tools: ['Read', 'Grep', 'Glob'],
				disallowedTools: ['Write', 'Edit', 'string_replace'],
				permissionMode: 'readOnly',
				systemPrompt: `You are a codebase exploration specialist. Your role is to:

1. Discover file structure and organization
2. Search for specific patterns and code
3. Analyze code dependencies
4. Identify key files and modules

Focus on speed and breadth. Use quick searches before deep analysis.
Always report findings in a structured format:
- Files found (with paths)
- Patterns discovered
- Dependencies identified
- Recommendations for further investigation`,
			},
			{
				name: 'plan',
				description:
					'Research agent for gathering context during plan mode. Use when you need to understand the codebase before proposing implementation changes.',
				model: 'inherit',
				tools: ['Read', 'Grep', 'Glob'],
				disallowedTools: ['Write', 'Edit', 'string_replace'],
				permissionMode: 'readOnly',
				systemPrompt: `You are a planning and research specialist. Your role is to:

1. Understand existing patterns in the codebase
2. Identify relevant files and modules
3. Analyze integration points
4. Recommend implementation approaches

Focus on accuracy and completeness. Consider:
- Existing patterns and conventions
- Test coverage
- Potential edge cases
- Backward compatibility

Return findings with:
- Relevant files (with line numbers where applicable)
- Existing patterns to follow
- Potential risks or complications
- Recommended implementation approach`,
			},
		];
	}
}

/**
 * Singleton instance for easy access.
 * Will be initialized with the current working directory.
 */
let globalLoader: SubagentLoader | null = null;

/**
 * Get the global SubagentLoader instance.
 * @param projectRoot - Optional project root (uses cwd if not provided)
 * @returns The singleton SubagentLoader instance
 */
export function getSubagentLoader(projectRoot?: string): SubagentLoader {
	if (
		!globalLoader ||
		(projectRoot && globalLoader['projectRoot'] !== projectRoot)
	) {
		globalLoader = new SubagentLoader(projectRoot);
	}

	return globalLoader;
}
