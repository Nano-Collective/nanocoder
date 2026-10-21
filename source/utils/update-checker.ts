import {loadPreferences, savePreferences} from '@/config/preferences';
import {TIMEOUT_UPDATE_CHECK_MS} from '@/constants';
import type {NpmRegistryResponse, UpdateInfo} from '@/types/index';
import {formatError} from '@/utils/error-formatter';
import {getLogger} from '@/utils/logging';
import {detectInstallationMethod} from './installation-detector';
import {getPackageVersion, UNKNOWN_VERSION} from './package-version';

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const UPDATE_COMMANDS = {
	NPM: 'npm update -g @nanocollective/nanocoder',
	// Check if package exists before upgrading to provide better error messages
	HOMEBREW:
		'brew list nanocoder >/dev/null 2>&1 && brew upgrade nanocoder || (echo "Error: nanocoder not found in Homebrew. Please install it first with: brew install nanocoder" && exit 1)',
} as const;

const UPDATE_MESSAGES = {
	NIX: 'To update, re-run: nix run github:Nano-Collective/nanocoder (or update your flake).',
	UNKNOWN:
		'A new version is available. Please update using your package manager.',
} as const;

/**
 * Compare two semver version strings
 * Returns true if latest is greater than current
 */
function isNewerVersion(current: string, latest: string): boolean {
	const parseVersion = (version: string) => {
		const clean = version.replace(/^v/, '').split('-')[0]; // Remove 'v' prefix and pre-release info
		return clean.split('.').map(num => parseInt(num) || 0);
	};

	const currentParts = parseVersion(current);
	const latestParts = parseVersion(latest);

	const maxLength = Math.max(currentParts.length, latestParts.length);

	for (let i = 0; i < maxLength; i++) {
		const currentPart = currentParts[i] || 0;
		const latestPart = latestParts[i] || 0;

		if (latestPart > currentPart) {
			return true;
		} else if (latestPart < currentPart) {
			return false;
		}
	}

	return false;
}

/**
 * Fetch the latest version from npm registry
 */
async function fetchLatestVersion(): Promise<string | null> {
	try {
		const response = await fetch(
			'https://registry.npmjs.org/@nanocollective/nanocoder/latest',
			{
				method: 'GET',
				headers: {
					Accept: 'application/json',
					'User-Agent': 'nanocoder-update-checker',
				},
				// Add timeout
				signal: AbortSignal.timeout(TIMEOUT_UPDATE_CHECK_MS),
			},
		);

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const data = (await response.json()) as NpmRegistryResponse;
		if (typeof data.version !== 'string' || data.version.length === 0) {
			throw new Error('Registry response did not contain a version');
		}

		return data.version;
	} catch (error) {
		const errorMessage = formatError(error);
		getLogger().warn(
			{error: errorMessage},
			'Failed to fetch the latest Nanocoder version',
		);
		return null;
	}
}

/**
 * Update the last update check timestamp in preferences
 */
function updateLastCheckTime(): void {
	const preferences = loadPreferences();
	preferences.lastUpdateCheck = Date.now();
	savePreferences(preferences);
}

/**
 * Automatic checks run at most once every 24 hours after a successful check.
 * Future timestamps are ignored so a clock change cannot disable checks.
 */
function hasRecentSuccessfulCheck(): boolean {
	const lastUpdateCheck = loadPreferences().lastUpdateCheck;
	const now = Date.now();

	return (
		typeof lastUpdateCheck === 'number' &&
		Number.isFinite(lastUpdateCheck) &&
		lastUpdateCheck > 0 &&
		lastUpdateCheck <= now &&
		now - lastUpdateCheck < UPDATE_CHECK_INTERVAL_MS
	);
}

/**
 * Check for package updates. Pass `force` for an explicit user-requested check.
 */
export async function checkForUpdates(
	options: {force?: boolean} = {},
): Promise<UpdateInfo> {
	const currentVersion = getPackageVersion();

	// A broken install has no version to compare. The banner and /doctor
	// already show "unknown"; posting an error to the chat on top of that (it
	// used to, and it pushed the welcome screen away) helps nobody.
	if (currentVersion === UNKNOWN_VERSION) {
		return {hasUpdate: false, currentVersion};
	}

	if (
		!options.force &&
		(process.env.NANOCODER_NO_UPDATE_CHECK === '1' ||
			hasRecentSuccessfulCheck())
	) {
		return {hasUpdate: false, currentVersion};
	}

	try {
		const latestVersion = await fetchLatestVersion();
		if (latestVersion !== null) {
			updateLastCheckTime();
		}

		if (!latestVersion) {
			return {
				hasUpdate: false,
				currentVersion,
			};
		}

		const hasUpdate = isNewerVersion(currentVersion, latestVersion);

		function getUpdateDetails(hasUpdate: boolean): {
			command?: string;
			message?: string;
		} {
			if (!hasUpdate) {
				return {};
			}

			const method = detectInstallationMethod();

			// Use constants defined at top of file for maintainability

			switch (method) {
				case 'npm':
					return {command: UPDATE_COMMANDS.NPM};
				case 'homebrew':
					return {command: UPDATE_COMMANDS.HOMEBREW};
				case 'nix':
					return {message: UPDATE_MESSAGES.NIX};
				default:
					// For 'unknown' fallback to a general message (do not attempt to run a command)
					return {message: UPDATE_MESSAGES.UNKNOWN};
			}
		}

		const updateDetails = getUpdateDetails(hasUpdate);

		return {
			hasUpdate,
			currentVersion,
			latestVersion,
			updateCommand: updateDetails.command,
			updateMessage: updateDetails.message,
		};
	} catch (error) {
		const errorMessage = formatError(error);
		getLogger().error({error: errorMessage}, 'Update check failed');

		return {
			hasUpdate: false,
			currentVersion,
		};
	}
}
