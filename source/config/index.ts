import {config as loadEnv} from 'dotenv';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {homedir} from 'os';
import {dirname, join} from 'path';
import {fileURLToPath} from 'url';
import {substituteEnvVars} from '@/config/env-substitution';
import {getConfigPath} from '@/config/paths';
import {loadPreferences} from '@/config/preferences';
import {defaultTheme, getThemeColors} from '@/config/themes';
import type {AppConfig, Colors, ContextManagementConfig} from '@/types/index';
import {logError, logWarning} from '@/utils/message-queue';

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

// Function to load app configuration from agents.config.json if it exists
function loadAppConfig(): AppConfig {
	const agentsJsonPath = getClosestConfigFile('agents.config.json');

	try {
		const rawData = readFileSync(agentsJsonPath, 'utf-8');
		const agentsData = JSON.parse(rawData) as {
			nanocoder?: AppConfig & {
				contextManagement?: Partial<ContextManagementConfig>;
			};
		};

		// Apply environment variable substitution
		const processedData = substituteEnvVars(agentsData);

		if (processedData.nanocoder) {
			return {
				providers: processedData.nanocoder.providers ?? [],
				mcpServers: processedData.nanocoder.mcpServers ?? [],
				contextManagement: processedData.nanocoder.contextManagement,
			};
		}
	} catch (error) {
		logWarning(
			`Failed to load agents.config.json: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	return {};
}

export let appConfig = loadAppConfig();

// Function to reload the app configuration (useful after config file changes)
export function reloadAppConfig(): void {
	appConfig = loadAppConfig();
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
