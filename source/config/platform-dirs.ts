import {homedir} from 'node:os';
import {join} from 'node:path';

/**
 * Where Nanocoder keeps its files on each platform. Pure path resolution
 * from the environment and OS, with no other imports, so both config/paths
 * and utils/logging can use it without importing each other.
 *
 * Every directory has an explicit NANOCODER_* override, checked first.
 */

/** Sessions, stats, artifacts. */
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

/** agents.config.json, preferences, personal commands/agents/tools. */
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

/**
 * Log files. Follows OS conventions:
 * - macOS: ~/Library/Logs/nanocoder
 * - Linux: ~/.local/state/nanocoder/logs (XDG_STATE_HOME)
 * - Windows: %LOCALAPPDATA%/nanocoder/logs
 */
export function getLogPath(): string {
	if (process.env.NANOCODER_LOG_DIR) {
		return process.env.NANOCODER_LOG_DIR;
	}

	switch (process.platform) {
		case 'win32':
			return join(
				process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
				'nanocoder',
				'logs',
			);
		case 'darwin':
			return join(homedir(), 'Library', 'Logs', 'nanocoder');
		default:
			return join(
				process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'),
				'nanocoder',
				'logs',
			);
	}
}

/**
 * Re-downloadable caches (the models.dev database). XDG_CACHE_HOME wins on
 * every platform when set; otherwise:
 * - macOS: ~/Library/Caches/nanocoder
 * - Linux: ~/.cache/nanocoder
 * - Windows: %LOCALAPPDATA%/nanocoder/cache
 */
export function getCachePath(): string {
	if (process.env.XDG_CACHE_HOME) {
		return join(process.env.XDG_CACHE_HOME, 'nanocoder');
	}

	switch (process.platform) {
		case 'win32':
			return join(
				process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
				'nanocoder',
				'cache',
			);
		case 'darwin':
			return join(homedir(), 'Library', 'Caches', 'nanocoder');
		default:
			return join(homedir(), '.cache', 'nanocoder');
	}
}
