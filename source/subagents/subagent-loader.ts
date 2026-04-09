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
import {fileURLToPath} from 'node:url';
import {logError, logWarning} from '@/utils/message-queue';
import type {SubagentConfigWithSource, SubagentLoadPriority} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve the built-in agents directory.
 * Works from both source (dev) and dist (built) locations.
 */
function getBuiltInAgentsDir(): string {
	// In source: source/subagents/built-in/
	// In dist: dist/subagents/built-in/ -- but .md files are in source/
	// Since .md files are not compiled, always reference from source
	const sourceDir = path.resolve(__dirname, '../../source/subagents/built-in');
	const localDir = path.resolve(__dirname, './built-in');
	// Prefer the local dir (works in source), fall back to source dir (works from dist)
	return localDir.includes('source') ? localDir : sourceDir;
}

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
		const builtInDir = getBuiltInAgentsDir();
		const builtInAgents = await this.loadFromDirectory(builtInDir, 0);
		for (const config of builtInAgents) {
			config.source.isBuiltIn = true;
			this.cache.set(config.name, config);
		}

		// Load user-level agents
		const userAgentsPath = this.getUserAgentsPath();
		const userAgents = await this.loadFromDirectory(
			userAgentsPath,
			1, // User priority
		);
		for (const config of userAgents) {
			const existing = this.cache.get(config.name);
			if (existing?.source.isBuiltIn) {
				logWarning(`User agent '${config.name}' overrides built-in agent`);
			}
			this.cache.set(config.name, config);
		}

		// Load project-level agents (highest priority, overrides others)
		const projectAgentsPath = this.getProjectAgentsPath();
		const projectAgents = await this.loadFromDirectory(
			projectAgentsPath,
			2, // Project priority
		);
		for (const config of projectAgents) {
			const existing = this.cache.get(config.name);
			if (existing) {
				const source = existing.source.isBuiltIn ? 'built-in' : 'user';
				logWarning(`Project agent '${config.name}' overrides ${source} agent`);
			}
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
	 * Get the project root directory.
	 * @returns The project root path
	 */
	getProjectRoot(): string {
		return this.projectRoot;
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

		// Import the parser once, before the loop, to avoid repeated async overhead
		const {parseSubagentMarkdown} = await import('./markdown-parser.js');

		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith('.md')) {
				continue;
			}

			const filePath = path.join(dirPath, entry.name);
			try {
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
				logError(
					`Failed to load agent from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		return agents;
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
		(projectRoot && globalLoader.getProjectRoot() !== projectRoot)
	) {
		globalLoader = new SubagentLoader(projectRoot);
	}

	return globalLoader;
}
