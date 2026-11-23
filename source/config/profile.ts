import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {readCachedConfigFile} from '@/config/cached-reader';
import {getConfigPath} from '@/config/paths';
import type {DiskProfileConfig, DiskProfilesConfig} from '@/types/config';
import {notifyError} from '@/utils/message-queue-core';

let _cliProfile: string | undefined;
let _explicitlyCleared = false;

/**
 * Set the profile name specified via CLI flag (`--profile <name>`).
 */
export function setCliProfile(profile: string | undefined): void {
	_cliProfile = profile && profile.trim() !== '' ? profile.trim() : undefined;
	_explicitlyCleared = false;
}

/**
 * Get the profile name explicitly set via CLI.
 */
export function getCliProfile(): string | undefined {
	return _cliProfile;
}

/**
 * Reset all cached profile state. Useful for tests.
 */
export function clearProfileCache(): void {
	_cliProfile = undefined;
	_explicitlyCleared = false;
}

/**
 * Safely parse a JSON file using the cached config reader and return its object content,
 * or null if missing/invalid. Reports syntax errors through notifyError.
 */
function tryReadJsonObject(filePath: string): Record<string, unknown> | null {
	if (!existsSync(filePath)) {
		return null;
	}
	try {
		const parsed = readCachedConfigFile(filePath);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch (error) {
		notifyError(`Failed to load config from ${filePath}: ${String(error)}`);
		return null;
	}
}

/**
 * Read the `nanocoder.profiles` block from a single agents.config.json file.
 */
function readProfilesFromFile(filePath: string): DiskProfilesConfig | null {
	const json = tryReadJsonObject(filePath);
	if (!json) return null;
	const nanocoder = json.nanocoder;
	if (
		nanocoder &&
		typeof nanocoder === 'object' &&
		!Array.isArray(nanocoder) &&
		'profiles' in nanocoder
	) {
		const profiles = (nanocoder as Record<string, unknown>).profiles;
		if (profiles && typeof profiles === 'object' && !Array.isArray(profiles)) {
			return profiles as DiskProfilesConfig;
		}
	}
	return null;
}

/**
 * Read the `nanocoder.defaultProfile` property from a single agents.config.json file.
 */
function readDefaultProfileFromFile(filePath: string): string | null {
	const json = tryReadJsonObject(filePath);
	if (!json) return null;
	const nanocoder = json.nanocoder;
	if (
		nanocoder &&
		typeof nanocoder === 'object' &&
		!Array.isArray(nanocoder) &&
		'defaultProfile' in nanocoder
	) {
		const defaultProfile = (nanocoder as Record<string, unknown>)
			.defaultProfile;
		if (typeof defaultProfile === 'string' && defaultProfile.trim() !== '') {
			return defaultProfile.trim();
		}
	}
	return null;
}

/**
 * Load all available profiles, merging global and project configurations.
 * Project profiles override global profiles with the same name.
 */
export function loadAvailableProfiles(
	cwd: string = process.cwd(),
): DiskProfilesConfig {
	const globalPath = join(getConfigPath(), 'agents.config.json');
	const projectPath = join(cwd, 'agents.config.json');

	const globalProfiles = readProfilesFromFile(globalPath) ?? {};
	const projectProfiles = readProfilesFromFile(projectPath) ?? {};

	return {
		...globalProfiles,
		...projectProfiles,
	};
}

/**
 * Determine which file defined the given profile (project or global).
 */
function getProfileOriginFile(
	name: string,
	cwd: string = process.cwd(),
): string | undefined {
	const projectPath = join(cwd, 'agents.config.json');
	const projectProfiles = readProfilesFromFile(projectPath);
	if (projectProfiles && Object.hasOwn(projectProfiles, name)) {
		return projectPath;
	}

	const globalPath = join(getConfigPath(), 'agents.config.json');
	const globalProfiles = readProfilesFromFile(globalPath);
	if (globalProfiles && Object.hasOwn(globalProfiles, name)) {
		return globalPath;
	}

	return undefined;
}

/**
 * Load the default profile name specified in agents.config.json (project-over-global).
 */
export function loadDefaultProfileName(
	cwd: string = process.cwd(),
): string | undefined {
	const projectPath = join(cwd, 'agents.config.json');
	const projectDefault = readDefaultProfileFromFile(projectPath);
	if (projectDefault) return projectDefault;

	const globalPath = join(getConfigPath(), 'agents.config.json');
	const globalDefault = readDefaultProfileFromFile(globalPath);
	if (globalDefault) return globalDefault;

	return undefined;
}

export type ProfileOrigin = 'cli' | 'env' | 'defaultProfile';

export interface ActiveProfileInfo {
	name: string;
	profile: DiskProfileConfig;
	origin: ProfileOrigin;
	originFile?: string;
}

/**
 * Resolve the active profile name according to selection precedence:
 * 1. `--profile` CLI flag
 * 2. `NANOCODER_PROFILE` environment variable
 * 3. `nanocoder.defaultProfile` from agents.config.json
 * 4. undefined
 */
export function getActiveProfileName(
	cwd: string = process.cwd(),
): string | undefined {
	if (_explicitlyCleared) {
		return undefined;
	}

	if (_cliProfile) {
		return _cliProfile;
	}

	const envProfile = process.env.NANOCODER_PROFILE?.trim();
	if (envProfile) {
		return envProfile;
	}

	return loadDefaultProfileName(cwd);
}

/**
 * Resolve the active profile configuration.
 *
 * If a profile was requested (via CLI, env, or defaultProfile) but does not
 * exist among available profiles, this throws an error listing all available
 * profile names (fail-fast).
 */
export function resolveActiveProfile(
	cwd: string = process.cwd(),
): ActiveProfileInfo | undefined {
	if (_explicitlyCleared) {
		return undefined;
	}

	let requestedName: string | undefined;
	let origin: ProfileOrigin | undefined;

	if (_cliProfile) {
		requestedName = _cliProfile;
		origin = 'cli';
	} else if (process.env.NANOCODER_PROFILE?.trim()) {
		requestedName = process.env.NANOCODER_PROFILE.trim();
		origin = 'env';
	} else {
		requestedName = loadDefaultProfileName(cwd);
		origin = 'defaultProfile';
	}

	if (!requestedName) {
		return undefined;
	}

	const available = loadAvailableProfiles(cwd);
	if (!Object.hasOwn(available, requestedName)) {
		const availableNames = Object.keys(available);
		const listText =
			availableNames.length > 0
				? `Available profiles: ${availableNames.join(', ')}`
				: 'No profiles are configured in agents.config.json.';
		throw new Error(`Unknown profile "${requestedName}". ${listText}`);
	}

	const profile = available[requestedName];
	const originFile = getProfileOriginFile(requestedName, cwd);
	return {
		name: requestedName,
		profile,
		origin: origin ?? 'defaultProfile',
		originFile,
	};
}

/**
 * Get the active profile's configuration overrides, or undefined if no profile is active.
 * Throws if an unknown profile was requested.
 */
export function getActiveProfile(
	cwd: string = process.cwd(),
): DiskProfileConfig | undefined {
	return resolveActiveProfile(cwd)?.profile;
}

/**
 * Switch the active profile at runtime.
 * Throws if the profile name does not exist.
 * Passing undefined or empty string clears the active profile and overrides
 * both NANOCODER_PROFILE and defaultProfile.
 */
export function setActiveProfile(
	name: string | undefined,
	cwd: string = process.cwd(),
): void {
	if (!name || name.trim() === '') {
		_cliProfile = undefined;
		_explicitlyCleared = true;
		return;
	}

	const trimmed = name.trim();
	const available = loadAvailableProfiles(cwd);
	if (!Object.hasOwn(available, trimmed)) {
		const availableNames = Object.keys(available);
		const listText =
			availableNames.length > 0
				? `Available profiles: ${availableNames.join(', ')}`
				: 'No profiles are configured in agents.config.json.';
		throw new Error(`Unknown profile "${trimmed}". ${listText}`);
	}

	_cliProfile = trimmed;
	_explicitlyCleared = false;
}
