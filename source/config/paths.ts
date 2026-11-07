import {existsSync, mkdirSync, writeFileSync} from 'fs';
import {homedir} from 'os';
import {join} from 'path';
import {log} from '@/utils/logging';

export function getAppDataPath(): string {
	// Allow explicit override via environment variable
	if (process.env.NANOCODER_DATA_DIR) {
		return process.env.NANOCODER_DATA_DIR;
	}

	// Check XDG_DATA_HOME first (works cross-platform for testing)
	if (process.env.XDG_DATA_HOME) {
		return join(process.env.XDG_DATA_HOME, 'nanocoder');
	}

	// Platform-specific app data directories
	let baseAppDataPath: string;
	switch (process.platform) {
		case 'win32': {
			baseAppDataPath =
				process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
			break;
		}
		case 'darwin': {
			baseAppDataPath = join(homedir(), 'Library', 'Application Support');
			break;
		}
		default: {
			baseAppDataPath = join(homedir(), '.local', 'share');
		}
	}
	return join(baseAppDataPath, 'nanocoder');
}

export function getConfigPath(): string {
	// Allow explicit override via environment variable
	if (process.env.NANOCODER_CONFIG_DIR) {
		return process.env.NANOCODER_CONFIG_DIR;
	}

	// Platform-specific defaults
	let baseConfigPath: string;
	switch (process.platform) {
		case 'win32':
			baseConfigPath =
				process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
			break;
		case 'darwin':
			baseConfigPath = join(homedir(), 'Library', 'Preferences');
			break;
		default:
			baseConfigPath =
				process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
	}
	return join(baseConfigPath, 'nanocoder');
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
		log.error(`Failed to load ${fileName}: ${String(error)}`);
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
		log.error(`Failed to write ${filePath}: ${String(error)}`);
	}
}
