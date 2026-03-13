import {existsSync, readdirSync, statSync} from 'fs';
import {basename, join} from 'path';
import {getConfigPath} from '@/config/paths';
import {parseCommandFile} from '@/custom-commands/parser';
import type {CommandResource, CustomCommand} from '@/types/index';
import {logError} from '@/utils/message-queue';

const RESOURCES_DIR = 'resources';
const RELEVANCE_THRESHOLD = 5;
const MAX_COMMANDS_IN_CONTEXT = 3;

/**
 * Validate that a directory entry doesn't contain path traversal patterns.
 */
function isSafeEntry(entry: string): boolean {
	return (
		entry !== '..' &&
		entry !== '.' &&
		!entry.includes('/') &&
		!entry.includes('\\')
	);
}

export class CustomCommandLoader {
	private commands: Map<string, CustomCommand> = new Map();
	private aliases: Map<string, string> = new Map(); // alias -> command name
	private projectRoot: string;
	private projectCommandsDir: string;
	private personalCommandsDir: string;
	private deprecationWarned = false;

	constructor(projectRoot: string = process.cwd()) {
		this.projectRoot = projectRoot;
		// nosemgrep
		this.projectCommandsDir = join(projectRoot, '.nanocoder', 'commands'); // nosemgrep
		this.personalCommandsDir = join(getConfigPath(), 'commands');
	}

	/**
	 * Load all custom commands from both project and personal directories
	 */
	loadCommands(): void {
		this.commands.clear();
		this.aliases.clear();

		// Load personal commands first (lower priority)
		if (existsSync(this.personalCommandsDir)) {
			this.scanDirectory(this.personalCommandsDir, undefined, 'personal');
		}

		// Load project commands (higher priority, overrides personal)
		if (existsSync(this.projectCommandsDir)) {
			this.scanDirectory(this.projectCommandsDir, undefined, 'project');
		}

		// Emit deprecation warning for old skills directories
		this.checkDeprecatedSkillsDirs();
	}

	/**
	 * Check for deprecated .nanocoder/skills directories and warn
	 */
	private checkDeprecatedSkillsDirs(): void {
		if (this.deprecationWarned) return;

		const projectSkillsDir = join(this.projectRoot, '.nanocoder', 'skills');
		const personalSkillsDir = join(getConfigPath(), 'skills');
		let warned = false;

		if (existsSync(projectSkillsDir)) {
			logError(
				'Skills have been merged into commands. Move your SKILL.md files from .nanocoder/skills/ to .nanocoder/commands/ and rename them.',
			);
			warned = true;
		}
		if (existsSync(personalSkillsDir)) {
			logError(
				'Skills have been merged into commands. Move your SKILL.md files from ~/.config/nanocoder/skills/ to ~/.config/nanocoder/commands/ and rename them.',
			);
			warned = true;
		}

		if (warned) this.deprecationWarned = true;
	}

	/**
	 * Recursively scan directory for .md files, supporting directory-as-command
	 */
	private scanDirectory(
		dir: string,
		namespace?: string,
		source?: 'personal' | 'project',
	): void {
		const entries = readdirSync(dir);

		for (const entry of entries) {
			if (!isSafeEntry(entry)) continue;
			const fullPath = join(dir, entry); // nosemgrep
			const stat = statSync(fullPath);

			if (stat.isDirectory()) {
				// Check if this is a directory-as-command pattern:
				// directory contains <dirname>.md + optional resources/
				const commandFile = join(fullPath, `${entry}.md`); // nosemgrep
				if (existsSync(commandFile)) {
					this.loadCommand(commandFile, namespace, source, fullPath);
				} else {
					// Regular subdirectory becomes a namespace
					const subNamespace = namespace ? `${namespace}:${entry}` : entry;
					this.scanDirectory(fullPath, subNamespace, source);
				}
			} else if (entry.endsWith('.md')) {
				// Parse and register command
				this.loadCommand(fullPath, namespace, source);
			}
		}
	}

	/**
	 * Load a single command file.
	 * If commandDir is provided, also load resources from its resources/ subdirectory.
	 */
	private loadCommand(
		filePath: string,
		namespace?: string,
		source?: 'personal' | 'project',
		commandDir?: string,
	): void {
		try {
			const parsed = parseCommandFile(filePath);
			const commandName = basename(filePath, '.md');
			const fullName = namespace ? `${namespace}:${commandName}` : commandName;

			// Load resources if this is a directory-based command
			let loadedResources: CommandResource[] | undefined;
			if (commandDir) {
				loadedResources = this.loadResources(commandDir);
			}

			// Get file modification time
			let lastModified: Date | undefined;
			try {
				const st = statSync(filePath);
				lastModified = st.mtime;
			} catch {
				// ignore
			}

			const command: CustomCommand = {
				name: commandName,
				path: filePath,
				namespace,
				fullName,
				metadata: parsed.metadata,
				content: parsed.content,
				source,
				lastModified,
				loadedResources:
					loadedResources && loadedResources.length > 0
						? loadedResources
						: undefined,
			};

			// Register main command (project commands override personal with same name)
			this.commands.set(fullName, command);

			// Register aliases
			if (parsed.metadata.aliases) {
				for (const alias of parsed.metadata.aliases) {
					const fullAlias = namespace ? `${namespace}:${alias}` : alias;
					this.aliases.set(fullAlias, fullName);
				}
			}
		} catch (error) {
			logError(
				`Failed to load custom command from ${filePath}: ${String(error)}`,
			);
		}
	}

	/**
	 * Load resources from a command's resources/ subdirectory
	 */
	private loadResources(commandDir: string): CommandResource[] {
		const resourcesDir = join(commandDir, RESOURCES_DIR); // nosemgrep
		if (!existsSync(resourcesDir)) {
			return [];
		}

		const entries = readdirSync(resourcesDir);
		const resources: CommandResource[] = [];

		for (const entry of entries) {
			if (!isSafeEntry(entry)) continue;
			const resourcePath = join(resourcesDir, entry); // nosemgrep
			let st: {mode: number; isFile: () => boolean};
			try {
				st = statSync(resourcePath);
			} catch {
				continue;
			}
			if (!st.isFile()) continue;

			const ext = entry.toLowerCase().slice(entry.lastIndexOf('.'));
			let type: CommandResource['type'] = 'document';
			if (['.py', '.js', '.sh', '.bat', '.ts'].includes(ext)) {
				type = 'script';
			} else if (['.txt', '.md'].includes(ext)) {
				type = entry.endsWith('.template') ? 'template' : 'document';
			} else if (['.json', '.yaml', '.yml', '.toml'].includes(ext)) {
				type = 'config';
			}

			const executable = Boolean(type === 'script' && st.mode & 0o111);
			resources.push({
				name: entry,
				path: resourcePath,
				type,
				executable: executable || undefined,
			});
		}

		return resources;
	}

	/**
	 * Get a command by name (checking aliases too)
	 */
	getCommand(name: string): CustomCommand | undefined {
		// Check direct command name
		const command = this.commands.get(name);
		if (command) return command;

		// Check aliases
		const aliasTarget = this.aliases.get(name);
		if (aliasTarget) {
			return this.commands.get(aliasTarget);
		}

		return undefined;
	}

	/**
	 * Get all available commands
	 */
	getAllCommands(): CustomCommand[] {
		return Array.from(this.commands.values());
	}

	/**
	 * Get only commands that participate in auto-injection
	 * (those with triggers or tags defined)
	 */
	getAutoInjectableCommands(): CustomCommand[] {
		return this.getAllCommands().filter(
			cmd => cmd.metadata.triggers?.length || cmd.metadata.tags?.length,
		);
	}

	/**
	 * Get command suggestions for autocomplete
	 */
	getSuggestions(prefix: string): string[] {
		const suggestions: string[] = [];
		const lowerPrefix = prefix.toLowerCase();

		// Add matching command names
		for (const [name, _command] of this.commands.entries()) {
			if (name.toLowerCase().startsWith(lowerPrefix)) {
				suggestions.push(name);
			}
		}

		// Add matching aliases
		for (const [alias, _target] of this.aliases.entries()) {
			if (
				alias.toLowerCase().startsWith(lowerPrefix) &&
				!suggestions.includes(alias)
			) {
				suggestions.push(alias);
			}
		}

		return suggestions.sort();
	}

	/**
	 * Find relevant commands for auto-injection based on user request
	 */
	findRelevantCommands(
		request: string,
		availableTools: string[],
	): CustomCommand[] {
		const requestLower = request.toLowerCase();
		const scored: {command: CustomCommand; score: number}[] = [];

		for (const command of this.getAutoInjectableCommands()) {
			const score = this.calculateRelevanceScore(
				command,
				requestLower,
				availableTools,
			);
			if (score >= RELEVANCE_THRESHOLD) {
				scored.push({command, score});
			}
		}

		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, MAX_COMMANDS_IN_CONTEXT).map(s => s.command);
	}

	/**
	 * Calculate relevance score for a command against a user request
	 */
	private calculateRelevanceScore(
		command: CustomCommand,
		requestLower: string,
		availableTools: string[],
	): number {
		let score = 0;
		const meta = command.metadata;

		if (meta.description?.toLowerCase().includes(requestLower)) {
			score += 10;
		}
		if (meta.category?.toLowerCase().includes(requestLower)) {
			score += 5;
		}
		if (meta.triggers?.length) {
			for (const trigger of meta.triggers) {
				if (requestLower.includes(trigger.toLowerCase())) {
					score += 15;
				}
			}
		}
		if (meta.tags?.length) {
			for (const tag of meta.tags) {
				if (requestLower.includes(tag.toLowerCase())) {
					score += 5;
				}
			}
		}
		return score;
	}

	/**
	 * Check if commands directory exists
	 */
	hasCustomCommands(): boolean {
		return (
			existsSync(this.projectCommandsDir) ||
			existsSync(this.personalCommandsDir)
		);
	}

	/**
	 * Get the project commands directory path
	 */
	getCommandsDirectory(): string {
		return this.projectCommandsDir;
	}

	/**
	 * Get the personal commands directory path
	 */
	getPersonalCommandsDirectory(): string {
		return this.personalCommandsDir;
	}
}
