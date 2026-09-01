import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

/**
 * Shape of the settings data sent to the webview. This is a flattened,
 * UI-friendly view of agents.config.json + .mcp.json + nanocoder-preferences.json.
 */
export interface SettingsData {
	providers: Array<{ name: string; baseUrl?: string; models: string[]; apiKeySet: boolean }>;
	mcpServers: Array<{ name: string; transport: string; command?: string; url?: string }>;
	alwaysAllow: string[];
	defaultMode: string | null;
	autoCompact: { enabled: boolean; threshold: number; mode: string };
	reasoningTraces: boolean;
	sessions: { autoSave: boolean };
	webSearch: { configured: boolean };
	showTokenUsage: boolean;
}

/**
 * Manages reading and writing Nanocoder configuration files from the
 * extension host. Mirrors the resolution logic in the CLI's config/index.ts:
 *   1. Check <cwd>/agents.config.json
 *   2. Fall back to ~/.config/nanocoder/agents.config.json
 * Same for nanocoder-preferences.json.
 *
 * MCP servers are the exception: they never live in agents.config.json. The
 * CLI reads them from .mcp.json (see config/mcp-config-loader.ts), merging
 * project, global and env sources rather than picking one file.
 */
export class SettingsManager {
	constructor(private outputChannel: { appendLine: (msg: string) => void }) {}

	/**
	 * Discover the active config file paths, preferring project-level files.
	 *
	 * `mcpConfig` is the file the "Edit" button should open: the project
	 * .mcp.json when it exists, otherwise the global one.
	 */
	getConfigPaths(cwd: string): { agentsConfig: string; preferences: string; mcpConfig: string } {
		const globalDir = this.getGlobalConfigDir();

		const agentsConfig = this.resolveConfigPath(cwd, globalDir, 'agents.config.json');
		const preferences = this.resolveConfigPath(cwd, globalDir, 'nanocoder-preferences.json');
		const mcpConfig = this.resolveConfigPath(cwd, globalDir, '.mcp.json');

		return { agentsConfig, preferences, mcpConfig };
	}

	/**
	 * Read current settings from disk and return a flattened SettingsData.
	 */
	readSettings(cwd: string): SettingsData {
		const paths = this.getConfigPaths(cwd);
		const agentsConfig = this.readJsonSafe(paths.agentsConfig);
		const preferences = this.readJsonSafe(paths.preferences);

		const nc = agentsConfig?.nanocoder ?? {};

		// Parse providers — mask API keys
		const providers = Array.isArray(nc.providers) ? nc.providers.map((p: any) => ({
			name: p.name || 'unnamed',
			baseUrl: p.baseUrl,
			models: Array.isArray(p.models) ? p.models : [],
			apiKeySet: Boolean(p.apiKey),
		})) : [];

		// MCP servers come from .mcp.json, never agents.config.json
		const mcpServers = this.readMcpServers(cwd);

		// Parse alwaysAllow
		const alwaysAllow: string[] = Array.isArray(nc.alwaysAllow)
			? nc.alwaysAllow.filter((x: unknown) => typeof x === 'string')
			: [];

		// Parse defaultMode
		const validModes = ['normal', 'auto-accept', 'yolo', 'plan'];
		let defaultMode: string | null = typeof nc.defaultMode === 'string' ? nc.defaultMode : null;
		if (defaultMode && !validModes.includes(defaultMode)) {
			defaultMode = 'normal';
		}

		// Parse autoCompact
		const ac = nc.autoCompact ?? {};
		const autoCompact = {
			enabled: ac.enabled !== false,
			threshold: typeof ac.threshold === 'number' ? ac.threshold : 60,
			mode: typeof ac.mode === 'string' ? ac.mode : 'conservative',
		};

		// Parse reasoning traces from preferences
		const reasoningTraces = preferences?.reasoningExpanded ?? false;

		// Parse sessions from preferences
		const sessionsPref = preferences?.nanocoder?.sessions ?? {};
		const sessions = {
			autoSave: sessionsPref.autoSave !== false,
		};

		// Web search
		const webSearch = {
			configured: Boolean(nc.nanocoderTools?.webSearch?.apiKey),
		};

		return {
			providers,
			mcpServers,
			alwaysAllow,
			defaultMode,
			autoCompact,
			reasoningTraces,
			sessions,
			webSearch,
			showTokenUsage: false,
		};
	}

	/**
	 * Update a setting by dot-notated key. Returns success/error.
	 *
	 * Supported keys:
	 *   - 'defaultMode' → agents.config.json → nanocoder.defaultMode
	 *   - 'autoCompact.enabled' → agents.config.json → nanocoder.autoCompact.enabled
	 *   - 'autoCompact.threshold' → agents.config.json → nanocoder.autoCompact.threshold
	 *   - 'autoCompact.mode' → agents.config.json → nanocoder.autoCompact.mode
	 *   - 'reasoningTraces' → nanocoder-preferences.json → reasoningExpanded
	 *   - 'sessions.autoSave' → nanocoder-preferences.json → nanocoder.sessions.autoSave
	 */
	updateSetting(cwd: string, key: string, value: unknown): { success: boolean; error?: string } {
		try {
			const paths = this.getConfigPaths(cwd);

			if (key === 'defaultMode') {
				if (value === null) {
					this.updateAgentsConfig(paths.agentsConfig, 'defaultMode', null);
				} else if (typeof value === 'string') {
					const normalized = value.toLowerCase().trim();
					const validModes = ['normal', 'auto-accept', 'yolo', 'plan'] as const;
					if (!validModes.includes(normalized as (typeof validModes)[number])) {
						return { success: false, error: `Invalid defaultMode: ${value}` };
					}
					this.updateAgentsConfig(paths.agentsConfig, 'defaultMode', normalized);
				} else {
					return {
						success: false,
						error: `Invalid defaultMode value type: ${typeof value}`,
					};
				}
			} else if (key === 'autoCompact.enabled') {
				if (typeof value !== 'boolean') {
					return { success: false, error: 'autoCompact.enabled must be a boolean' };
				}
				this.updateAgentsConfigNested(paths.agentsConfig, 'autoCompact', 'enabled', value);
			} else if (key === 'autoCompact.threshold') {
				if (typeof value !== 'number' || !Number.isFinite(value)) {
					return { success: false, error: 'autoCompact.threshold must be a number' };
				}
				const threshold = Math.max(50, Math.min(95, Math.round(value)));
				this.updateAgentsConfigNested(paths.agentsConfig, 'autoCompact', 'threshold', threshold);
			} else if (key === 'autoCompact.mode') {
				if (typeof value !== 'string') {
					return { success: false, error: 'autoCompact.mode must be a string' };
				}
				const validModes = ['conservative', 'default', 'aggressive'] as const;
				if (!validModes.includes(value as (typeof validModes)[number])) {
					return { success: false, error: `Invalid autoCompact.mode: ${value}` };
				}
				this.updateAgentsConfigNested(paths.agentsConfig, 'autoCompact', 'mode', value);
			} else if (key === 'reasoningTraces') {
				if (typeof value !== 'boolean') {
					return { success: false, error: 'reasoningTraces must be a boolean' };
				}
				this.updatePreferences(paths.preferences, 'reasoningExpanded', value);
			} else if (key === 'sessions.autoSave') {
				if (typeof value !== 'boolean') {
					return { success: false, error: 'sessions.autoSave must be a boolean' };
				}
				this.updatePreferencesNested(paths.preferences, 'nanocoder', 'sessions', 'autoSave', value);
			} else {
				return { success: false, error: `Unknown setting key: ${key}` };
			}

			return { success: true };
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.outputChannel.appendLine(`[Settings] Failed to update ${key}: ${msg}`);
			return { success: false, error: msg };
		}
	}

	// ----- Private helpers -----

	/**
	 * Read MCP servers the way the CLI does: merge <cwd>/.mcp.json, the global
	 * .mcp.json and NANOCODER_MCPSERVERS(_FILE), first writer of a given name
	 * wins. Precedence is env > project > global, matching mergeMCPConfigs().
	 */
	private readMcpServers(cwd: string): SettingsData['mcpServers'] {
		const globalDir = this.getGlobalConfigDir();
		const byName = new Map<string, SettingsData['mcpServers'][number]>();

		const add = (servers: SettingsData['mcpServers']) => {
			for (const server of servers) {
				if (!byName.has(server.name)) {
					byName.set(server.name, server);
				}
			}
		};

		add(this.parseMcpServers(this.readEnvMcpConfig()));
		// cwd is the workspace folder, and the joined segment is a string literal,
		// so there is no attacker-controlled component to traverse with.
		add(this.parseMcpServers(this.readJsonSafe(path.join(cwd, '.mcp.json')))); // nosemgrep
		add(this.parseMcpServers(this.readJsonSafe(path.join(globalDir, '.mcp.json')))); // nosemgrep

		return Array.from(byName.values());
	}

	/**
	 * Pull the raw config out of NANOCODER_MCPSERVERS, or the file that
	 * NANOCODER_MCPSERVERS_FILE points at.
	 */
	private readEnvMcpConfig(): any {
		let rawData = process.env.NANOCODER_MCPSERVERS;

		if (!rawData && process.env.NANOCODER_MCPSERVERS_FILE) {
			const envPath = process.env.NANOCODER_MCPSERVERS_FILE;
			try {
				if (fs.existsSync(envPath)) {
					rawData = fs.readFileSync(envPath, 'utf-8');
				}
			} catch (error) {
				this.outputChannel.appendLine(`[Settings] Failed to read ${envPath}: ${error}`);
			}
		}

		if (!rawData) return {};

		try {
			return JSON.parse(rawData);
		} catch (error) {
			this.outputChannel.appendLine(`[Settings] Failed to parse NANOCODER_MCPSERVERS: ${error}`);
			return null;
		}
	}

	/**
	 * Accept the .mcp.json wrapper shape `{ mcpServers: { name: {...} } }`, plus
	 * the bare array the env vars also allow.
	 */
	private parseMcpServers(config: any): SettingsData['mcpServers'] {
		if (!config || typeof config !== 'object') return [];

		let entries: Array<[string, any]>;

		if (Array.isArray(config)) {
			entries = config.map((s: any) => [s?.name, s]);
		} else if (config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)) {
			entries = Object.entries(config.mcpServers);
		} else {
			return [];
		}

		return entries
			.filter(([, server]) => server && typeof server === 'object')
			.map(([name, server]) => ({
				name: name || server.name || 'unnamed',
				// transport is required by the CLI, but hand-written .mcp.json files
				// routinely omit it, so infer the same way the transport factory
				// would rather than mislabelling a remote server as stdio.
				transport: server.transport || (server.url && !server.command ? 'http' : 'stdio'),
				command: server.command,
				url: server.url,
			}));
	}

	private getGlobalConfigDir(): string {
		if (process.env.NANOCODER_CONFIG_DIR) {
			return process.env.NANOCODER_CONFIG_DIR;
		}

		let baseConfigPath: string;
		switch (process.platform) {
			case 'win32':
				baseConfigPath = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
				break;
			case 'darwin':
				baseConfigPath = path.join(os.homedir(), 'Library', 'Preferences');
				break;
			default:
				baseConfigPath = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
		}
		return path.join(baseConfigPath, 'nanocoder');
	}

	/**
	 * Resolve a config file: project-level first, then global.
	 * If neither exists, return the global path (it will be created on write).
	 */
	private resolveConfigPath(cwd: string, globalDir: string, fileName: string): string {
		// fileName is never user input - both call sites pass a string literal.
		// Same shape as getConfigPath() in source/config/index.ts.
		const projectPath = path.join(cwd, fileName); // nosemgrep
		if (fs.existsSync(projectPath)) {
			return projectPath;
		}
		return path.join(globalDir, fileName); // nosemgrep
	}

	private readJsonSafe(filePath: string): any {
		try {
			if (fs.existsSync(filePath)) {
				return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
			}
			return {};
		} catch (error) {
			this.outputChannel.appendLine(`[Settings] Failed to read ${filePath}: ${error}`);
			return null;
		}
	}

	private updateAgentsConfig(configPath: string, key: string, value: unknown): void {
		let config = this.readJsonSafe(configPath);
		if (config === null) throw new Error(`Config file ${configPath} contains invalid JSON. Cannot update.`);
		config = config || {};
		if (!config.nanocoder || typeof config.nanocoder !== 'object') {
			config.nanocoder = {};
		}
		config.nanocoder[key] = value;
		this.atomicWrite(configPath, config);
	}

	private updateAgentsConfigNested(configPath: string, parentKey: string, childKey: string, value: unknown): void {
		let config = this.readJsonSafe(configPath);
		if (config === null) throw new Error(`Config file ${configPath} contains invalid JSON. Cannot update.`);
		config = config || {};
		if (!config.nanocoder || typeof config.nanocoder !== 'object') {
			config.nanocoder = {};
		}
		if (!config.nanocoder[parentKey] || typeof config.nanocoder[parentKey] !== 'object') {
			config.nanocoder[parentKey] = {};
		}
		config.nanocoder[parentKey][childKey] = value;
		this.atomicWrite(configPath, config);
	}

	private updatePreferences(filePath: string, key: string, value: unknown): void {
		let prefs = this.readJsonSafe(filePath);
		if (prefs === null) throw new Error(`Preferences file ${filePath} contains invalid JSON. Cannot update.`);
		prefs = prefs || {};
		prefs[key] = value;
		this.atomicWrite(filePath, prefs);
	}

	private updatePreferencesNested(filePath: string, ...keys: (string | unknown)[]): void {
		let prefs = this.readJsonSafe(filePath);
		if (prefs === null) throw new Error(`Preferences file ${filePath} contains invalid JSON. Cannot update.`);
		prefs = prefs || {};
		const value = keys[keys.length - 1];
		const pathArgs = keys.slice(0, -1) as string[];

		let obj = prefs;
		for (let i = 0; i < pathArgs.length - 1; i++) {
			if (!obj[pathArgs[i]] || typeof obj[pathArgs[i]] !== 'object') {
				obj[pathArgs[i]] = {};
			}
			// Keys are string literals from this file's own call sites, never
			// user input, so no __proto__ can reach the walk.
			obj = obj[pathArgs[i]]; // nosemgrep
		}
		obj[pathArgs[pathArgs.length - 1]] = value;
		this.atomicWrite(filePath, prefs);
	}

	/**
	 * Atomic write: write to a temp file, then rename. Mirrors
	 * config-writer.ts's atomicWriteFileSync pattern to prevent
	 * truncated config files on crash.
	 */
	private atomicWrite(filePath: string, data: unknown): void {
		const dir = path.dirname(filePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		const tmpPath = `${filePath}.${crypto.randomUUID()}.tmp`;
		try {
			fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
			fs.renameSync(tmpPath, filePath);
		} catch (error) {
			try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup error */ }
			throw error;
		}
	}
}
