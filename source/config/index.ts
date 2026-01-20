import {config as loadEnv} from 'dotenv';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {homedir} from 'os';
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

			// Next lets check the $HOME for a hidden file. This should only be for
			// legacy support
			const homePath = join(homedir(), `.${fileName}`); // nosemgrep
			if (existsSync(homePath)) {
				// nosemgrep
				confDirMap[fileName] = homePath; // nosemgrep

				return homePath; // nosemgrep
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

	// Fallback to home directory
	const homePath = join(homedir(), '.agents.config.json');
	const homeConfig = tryLoadAutoCompactFromPath(homePath, defaults);
	if (homeConfig) {
		return homeConfig;
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

// Function to load app configuration from agents.config.json if it exists
function loadAppConfig(): AppConfig {
	// Load providers from the new hierarchical configuration system
	const providers = loadAllProviderConfigs();

	// Load MCP servers from the new hierarchical configuration system
	const mcpServersWithSource = loadAllMCPConfigs();
	const mcpServers = mcpServersWithSource.map(item => item.server);

	// Load auto-compact configuration
	const autoCompact = loadAutoCompactConfig();

	return {
		providers,
		mcpServers,
		autoCompact,
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

// Legacy export for backward compatibility - use a getter
export const appConfig = new Proxy({} as AppConfig, {
	get(_target, prop) {
		return getAppConfig()[prop as keyof AppConfig];
	},
});

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

// Legacy export for backwards compatibility - use a getter to avoid circular dependency
export const colors = new Proxy({} as Colors, {
	get(_target, prop) {
		return getColors()[prop as keyof Colors];
	},
});

// Get the package root directory (where this module is installed)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Go up from dist/config to package root, then to source/app/prompts/main-prompt.md
// This works because source/app/prompts/main-prompt.md is included in the package.json files array
export const promptPath = join(
	__dirname,
	'../../source/app/prompts/main-prompt.md',
);
