import {config as loadEnv} from 'dotenv';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, join} from 'path';
import {fileURLToPath} from 'url';
import {
	loadAllMCPConfigs,
	loadAllProviderConfigs,
} from '@/config/mcp-config-loader';
import {getConfigPath} from '@/config/paths';
import {loadPreferences} from '@/config/preferences';
import {defaultTheme, getThemeColors} from '@/config/themes';
import type {
	AppConfig,
	AutoCompactConfig,
	Colors,
	CompressionMode,
	PasteConfig,
} from '@/types/index';
import {logError} from '@/utils/message-queue';

// Load .env file from working directory (shell environment takes precedence)
// Suppress dotenv console output by temporarily redirecting stdout
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
	const originalWrite = process.stdout.write.bind(process.stdout);
	process.stdout.write = () => true;
	try {
		loadEnv({path: envPath});
	} finally {
		process.stdout.write = originalWrite;
	}
}

// Hold a map of what config files are where
export const confDirMap: Record<string, string> = {};

// Find the closest config file for the requested configuration file
export function getClosestConfigFile(fileName: string): string {
	try {
		const configDir = getConfigPath();

		// If NANOCODER_CONFIG_DIR is explicitly set, skip cwd and home checks
		// and use only the config directory (important for tests and explicit overrides)
		const isExplicitConfigDir = Boolean(process.env.NANOCODER_CONFIG_DIR);

		if (!isExplicitConfigDir) {
			// First, lets check for a working directory config
			const cwdPath = join(process.cwd(), fileName); // nosemgrep
			if (existsSync(cwdPath)) {
				// nosemgrep
				confDirMap[fileName] = cwdPath; // nosemgrep

				return cwdPath; // nosemgrep
			}
		}

		// Last, lets look for an user level config.

		// If the file doesn't exist, create it
		const configPath = join(configDir, fileName); // nosemgrep
		if (!existsSync(configPath)) {
			// nosemgrep
			createDefaultConfFile(configDir, fileName);
		}

		confDirMap[fileName] = configPath; // nosemgrep

		return configPath; // nosemgrep
	} catch (error) {
		logError(`Failed to load ${fileName}: ${String(error)}`);
	}

	// The code should never hit this, but it makes the TS compiler happy.
	return fileName;
}

function createDefaultConfFile(filePath: string, fileName: string): void {
	try {
		// If we cant find any, lets assume this is the first user run, create the
		// correct file and direct the user to configure them correctly,
		const configFilePath = join(filePath, fileName); // nosemgrep
		if (!existsSync(configFilePath)) {
			// nosemgrep
			// Maybe add a better sample config?
			const sampleConfig = {};

			mkdirSync(filePath, {recursive: true});
			writeFileSync(
				configFilePath, // nosemgrep
				JSON.stringify(sampleConfig, null, 2),
				'utf-8',
			);
		}
	} catch (error) {
		logError(`Failed to write ${filePath}: ${String(error)}`);
	}
}

// Try to load auto-compact config from a specific path
// Returns the config if found and valid, null otherwise
function tryLoadAutoCompactFromPath(
	configPath: string,
	defaults: AutoCompactConfig,
): AutoCompactConfig | null {
	if (!existsSync(configPath)) {
		return null;
	}

	try {
		const rawData = readFileSync(configPath, 'utf-8');
		const config = JSON.parse(rawData);
		const autoCompact = config.nanocoder?.autoCompact;
		if (autoCompact && typeof autoCompact === 'object') {
			return {
				enabled:
					autoCompact.enabled !== undefined
						? Boolean(autoCompact.enabled)
						: defaults.enabled,
				threshold: validateThreshold(
					autoCompact.threshold ?? defaults.threshold,
				),
				mode: validateMode(autoCompact.mode ?? defaults.mode),
				notifyUser:
					autoCompact.notifyUser !== undefined
						? Boolean(autoCompact.notifyUser)
						: defaults.notifyUser,
			};
		}
	} catch (error) {
		logError(
			`Failed to load auto-compact config from ${configPath}: ${String(error)}`,
		);
	}

	return null;
}

// Load auto-compact configuration and Returns default config if not specified
function loadAutoCompactConfig(): AutoCompactConfig {
	const defaults: AutoCompactConfig = {
		enabled: true,
		threshold: 60,
		mode: 'conservative',
		notifyUser: true,
	};

	// Try to load from project-level config first
	const projectConfigPath = join(process.cwd(), 'agents.config.json');
	const projectConfig = tryLoadAutoCompactFromPath(projectConfigPath, defaults);
	if (projectConfig) {
		return projectConfig;
	}

	// Try global config
	const configDir = getConfigPath();
	const globalConfigPath = join(configDir, 'agents.config.json');
	const globalConfig = tryLoadAutoCompactFromPath(globalConfigPath, defaults);
	if (globalConfig) {
		return globalConfig;
	}

	return defaults;
}

// Validate and clamp threshold to valid range (50-95)
function validateThreshold(threshold: unknown): number {
	const num = typeof threshold === 'number' ? threshold : 60;
	return Math.max(50, Math.min(95, Math.round(num)));
}

// Validate compression mode
function validateMode(mode: unknown): CompressionMode {
	if (mode === 'default' || mode === 'aggressive' || mode === 'conservative') {
		return mode;
	}
	return 'conservative';
}

// Try to load session config from a specific path
// Returns the config if found and valid, null otherwise
function tryLoadSessionsFromPath(
	configPath: string,
	defaults: NonNullable<AppConfig['sessions']>,
): AppConfig['sessions'] | null {
	if (!existsSync(configPath)) {
		return null;
	}

	try {
		const rawData = readFileSync(configPath, 'utf-8');
		const config = JSON.parse(rawData);
		const sessions = config.nanocoder?.sessions;
		if (sessions && typeof sessions === 'object') {
			const normalizeSessionNumber = (
				value: unknown,
				min: number,
				fallback: number,
			): number => {
				if (typeof value === 'number' && Number.isFinite(value)) {
					return Math.max(min, value);
				}
				return fallback;
			};

			return {
				autoSave:
					sessions.autoSave !== undefined
						? Boolean(sessions.autoSave)
						: defaults.autoSave,
				saveInterval: normalizeSessionNumber(
					sessions.saveInterval,
					1000, // Minimum 1 second
					defaults.saveInterval ?? 30000,
				),
				maxSessions: normalizeSessionNumber(
					sessions.maxSessions,
					1,
					defaults.maxSessions ?? 100,
				),
				maxMessages: normalizeSessionNumber(
					sessions.maxMessages,
					1,
					defaults.maxMessages ?? 1000,
				),
				retentionDays: normalizeSessionNumber(
					sessions.retentionDays,
					1,
					defaults.retentionDays ?? 30,
				),
				directory: sessions.directory || defaults.directory,
			};
		}
	} catch (error) {
		logError(
			`Failed to load session config from ${configPath}: ${String(error)}`,
		);
	}

	return null;
}

// Load session configuration and Returns default config if not specified
function loadSessionConfig(): AppConfig['sessions'] {
	const defaults: NonNullable<AppConfig['sessions']> = {
		autoSave: true,
		saveInterval: 30000, // 30 seconds
		maxSessions: 100,
		maxMessages: 1000,
		retentionDays: 30,
		directory: '',
	};

	// Try to load from project-level config first
	const projectConfigPath = join(process.cwd(), 'agents.config.json');
	const projectConfig = tryLoadSessionsFromPath(projectConfigPath, defaults);
	if (projectConfig) {
		return projectConfig;
	}

	// Try global config
	const configDir = getConfigPath();
	const globalConfigPath = join(configDir, 'agents.config.json');
	const globalConfig = tryLoadSessionsFromPath(globalConfigPath, defaults);
	if (globalConfig) {
		return globalConfig;
	}

	return defaults;
}

// Try to load paste config from a specific path
// Returns the config if found and valid, null otherwise
function tryLoadPasteFromPath(
	configPath: string,
	defaults: PasteConfig,
): PasteConfig | null {
	if (!existsSync(configPath)) {
		return null;
	}

	try {
		const rawData = readFileSync(configPath, 'utf-8');
		const config = JSON.parse(rawData);
		const paste = config.nanocoder?.paste;
		if (paste && typeof paste === 'object') {
			return {
				singleLineThreshold:
					typeof paste.singleLineThreshold === 'number' &&
					Number.isFinite(paste.singleLineThreshold) &&
					paste.singleLineThreshold > 0
						? Math.round(paste.singleLineThreshold)
						: defaults.singleLineThreshold,
			};
		}
	} catch (error) {
		logError(
			`Failed to load paste config from ${configPath}: ${String(error)}`,
		);
	}

	return null;
}

// Load paste configuration and Returns default config if not specified
function loadPasteConfig(): PasteConfig {
	const defaults: PasteConfig = {
		singleLineThreshold: 800,
	};

	// Try to load from project-level config first
	const projectConfigPath = join(process.cwd(), 'agents.config.json');
	const projectConfig = tryLoadPasteFromPath(projectConfigPath, defaults);
	if (projectConfig) {
		return projectConfig;
	}

	// Try global config
	const configDir = getConfigPath();
	const globalConfigPath = join(configDir, 'agents.config.json');
	const globalConfig = tryLoadPasteFromPath(globalConfigPath, defaults);
	if (globalConfig) {
		return globalConfig;
	}

	return defaults;
}

// Function to load app configuration from agents.config.json if it exists
function loadAppConfig(): AppConfig {
	// Load providers from the new hierarchical configuration system
	const providers = loadAllProviderConfigs();

	// Load MCP servers from the new hierarchical configuration system
	const mcpServersWithSource = loadAllMCPConfigs();
	const mcpServers = mcpServersWithSource.map(item => item.server);

	// Load auto-compact configuration
	const autoCompact = loadAutoCompactConfig();

	// Load session configuration
	const sessions = loadSessionConfig();

	// Load paste configuration
	const paste = loadPasteConfig();

	return {
		providers,
		mcpServers,
		autoCompact,
		sessions,
		paste,
	};
}

let _appConfig: AppConfig | null = null;

/**
 * Lazy-loaded app config to avoid circular dependencies during module initialization
 * @public
 */
export function getAppConfig(): AppConfig {
	if (!_appConfig) {
		_appConfig = loadAppConfig();
	}
	return _appConfig;
}

// Function to reload the app configuration (useful after config file changes)
export function reloadAppConfig(): void {
	_appConfig = loadAppConfig();
}

// Function to clear the cached app configuration (useful for testing)
export function clearAppConfig(): void {
	_appConfig = null;
}

let cachedColors: Colors | null = null;

export function getColors(): Colors {
	if (!cachedColors) {
		const preferences = loadPreferences();
		const selectedTheme = preferences.selectedTheme || defaultTheme;
		cachedColors = getThemeColors(selectedTheme);
	}
	return cachedColors;
}

// Get the package root directory (where this module is installed)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Go up from dist/config to package root, then to source/app/prompts/main-prompt.md
// This works because source/app/prompts/main-prompt.md is included in the package.json files array
export const promptPath = join(
	__dirname,
	'../../source/app/prompts/main-prompt.md',
);
