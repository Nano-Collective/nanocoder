import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

/**
 * Shape of the settings data sent to the webview. This is a flattened,
 * UI-friendly view of agents.config.json + nanocoder-preferences.json.
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
}

/**
 * Manages reading and writing Nanocoder configuration files from the
 * extension host. Mirrors the resolution logic in the CLI's config/index.ts:
 *   1. Check <cwd>/agents.config.json
 *   2. Fall back to ~/.config/nanocoder/agents.config.json
 * Same for nanocoder-preferences.json.
 */
export class SettingsManager {
	constructor(private outputChannel: { appendLine: (msg: string) => void }) {}

	/**
	 * Discover the active config file paths, preferring project-level files.
	 */
	getConfigPaths(cwd: string): { agentsConfig: string; preferences: string } {
		const globalDir = this.getGlobalConfigDir();

		const agentsConfig = this.resolveConfigPath(cwd, globalDir, 'agents.config.json');
		const preferences = this.resolveConfigPath(cwd, globalDir, 'nanocoder-preferences.json');

		return { agentsConfig, preferences };
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

		// Parse MCP servers
		const mcpServers = Array.isArray(nc.mcpServers) ? nc.mcpServers.map((s: any) => ({
			name: s.name || 'unnamed',
			transport: s.transport || 'stdio',
			command: s.command,
			url: s.url,
		})) : [];

		// Parse alwaysAllow
		const alwaysAllow: string[] = Array.isArray(nc.alwaysAllow)
			? nc.alwaysAllow.filter((x: unknown) => typeof x === 'string')
			: [];

		// Parse defaultMode
		const defaultMode: string | null = typeof nc.defaultMode === 'string' ? nc.defaultMode : null;

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
				this.updateAgentsConfig(paths.agentsConfig, 'defaultMode', value);
			} else if (key.startsWith('autoCompact.')) {
				const childKey = key.split('.')[1];
				this.updateAgentsConfigNested(paths.agentsConfig, 'autoCompact', childKey, value);
			} else if (key === 'reasoningTraces') {
				this.updatePreferences(paths.preferences, 'reasoningExpanded', value);
			} else if (key === 'sessions.autoSave') {
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

	private getGlobalConfigDir(): string {
		const xdg = process.env['XDG_CONFIG_HOME'];
		if (xdg) return path.join(xdg, 'nanocoder');
		return path.join(os.homedir(), '.config', 'nanocoder');
	}

	/**
	 * Resolve a config file: project-level first, then global.
	 * If neither exists, return the global path (it will be created on write).
	 */
	private resolveConfigPath(cwd: string, globalDir: string, fileName: string): string {
		const projectPath = path.join(cwd, fileName);
		if (fs.existsSync(projectPath)) {
			return projectPath;
		}
		return path.join(globalDir, fileName);
	}

	private readJsonSafe(filePath: string): any {
		try {
			if (fs.existsSync(filePath)) {
				return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
			}
		} catch (error) {
			this.outputChannel.appendLine(`[Settings] Failed to read ${filePath}: ${error}`);
		}
		return {};
	}

	private updateAgentsConfig(configPath: string, key: string, value: unknown): void {
		const config = this.readJsonSafe(configPath) || {};
		if (!config.nanocoder || typeof config.nanocoder !== 'object') {
			config.nanocoder = {};
		}
		config.nanocoder[key] = value;
		this.atomicWrite(configPath, config);
	}

	private updateAgentsConfigNested(configPath: string, parentKey: string, childKey: string, value: unknown): void {
		const config = this.readJsonSafe(configPath) || {};
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
		const prefs = this.readJsonSafe(filePath) || {};
		prefs[key] = value;
		this.atomicWrite(filePath, prefs);
	}

	private updatePreferencesNested(filePath: string, ...keys: (string | unknown)[]): void {
		const prefs = this.readJsonSafe(filePath) || {};
		const value = keys[keys.length - 1];
		const path = keys.slice(0, -1) as string[];

		let obj = prefs;
		for (let i = 0; i < path.length - 1; i++) {
			if (!obj[path[i]] || typeof obj[path[i]] !== 'object') {
				obj[path[i]] = {};
			}
			obj = obj[path[i]];
		}
		obj[path[path.length - 1]] = value;
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
