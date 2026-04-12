import {readFileSync, writeFileSync} from 'fs';
import type {TitleShape} from '@/components/ui/styled-title';
import {getClosestConfigFile} from '@/config/index';
import type {TuneConfig} from '@/types/config';
import type {UserPreferences} from '@/types/index';
import type {NanocoderShape, ThemePreset} from '@/types/ui';
import {logError} from '@/utils/message-queue';

let PREFERENCES_PATH: string | null = null;
let CACHED_CONFIG_DIR: string | undefined = undefined;

function getPreferencesPath(): string {
	// Re-compute path if NANOCODER_CONFIG_DIR has changed (important for tests)
	const currentConfigDir = process.env.NANOCODER_CONFIG_DIR;
	if (!PREFERENCES_PATH || CACHED_CONFIG_DIR !== currentConfigDir) {
		PREFERENCES_PATH = getClosestConfigFile('nanocoder-preferences.json');
		CACHED_CONFIG_DIR = currentConfigDir;
	}
	return PREFERENCES_PATH;
}

// Export for testing purposes - allows tests to reset the cache
export function resetPreferencesCache(): void {
	PREFERENCES_PATH = null;
	CACHED_CONFIG_DIR = undefined;
}

export function loadPreferences(): UserPreferences {
	try {
		const data = readFileSync(getPreferencesPath(), 'utf-8');
		return JSON.parse(data) as UserPreferences;
	} catch (error) {
		logError(`Failed to load preferences: ${String(error)}`);
	}
	return {};
}

export function savePreferences(preferences: UserPreferences): void {
	try {
		writeFileSync(getPreferencesPath(), JSON.stringify(preferences, null, 2));
	} catch (error) {
		logError(`Failed to save preferences: ${String(error)}`);
	}
}

export function updateLastUsed(provider: string, model: string): void {
	const preferences = loadPreferences();
	preferences.lastProvider = provider;
	preferences.lastModel = model;

	// Also save the model for this specific provider
	if (!preferences.providerModels) {
		preferences.providerModels = {};
	}
	preferences.providerModels[provider] = model;

	savePreferences(preferences);
}

export function updateTitleShape(shape: string): void {
	const preferences = loadPreferences();
	preferences.titleShape = shape as TitleShape;
	savePreferences(preferences);
}

export function getTitleShape(): TitleShape | undefined {
	const preferences = loadPreferences();
	return preferences.titleShape;
}

export function updateSelectedTheme(theme: string): void {
	const preferences = loadPreferences();
	preferences.selectedTheme = theme as ThemePreset;
	savePreferences(preferences);
}

export function getLastUsedModel(provider: string): string | undefined {
	const preferences = loadPreferences();
	return preferences.providerModels?.[provider];
}

export function updateNanocoderShape(shape: NanocoderShape): void {
	const preferences = loadPreferences();
	preferences.nanocoderShape = shape;
	savePreferences(preferences);
}

export function getNanocoderShape(): NanocoderShape | undefined {
	const preferences = loadPreferences();
	return preferences.nanocoderShape;
}

export function saveTune(config: TuneConfig): void {
	const preferences = loadPreferences();
	preferences.tune = config;
	savePreferences(preferences);
}

/**
 * Get the notifications config from nanocoder.notifications in the preferences file.
 */
export function getNotificationsPreference():
	| import('@/types/config').NotificationsConfig
	| undefined {
	try {
		const data = readFileSync(getPreferencesPath(), 'utf-8');
		const raw = JSON.parse(data) as Record<string, unknown>;
		const nanocoder = raw.nanocoder as Record<string, unknown> | undefined;
		const notifications = nanocoder?.notifications as
			| Record<string, unknown>
			| undefined;
		if (
			notifications &&
			typeof notifications === 'object' &&
			'enabled' in notifications
		) {
			return {
				enabled: Boolean(notifications.enabled),
				sound:
					'sound' in notifications ? Boolean(notifications.sound) : undefined,
				timeout:
					'timeout' in notifications &&
					typeof notifications.timeout === 'number'
						? notifications.timeout
						: undefined,
				events:
					'events' in notifications &&
					notifications.events &&
					typeof notifications.events === 'object'
						? (notifications.events as import('@/types/config').NotificationsConfig['events'])
						: undefined,
				customMessages:
					'customMessages' in notifications &&
					notifications.customMessages &&
					typeof notifications.customMessages === 'object'
						? (notifications.customMessages as import('@/types/config').NotificationsConfig['customMessages'])
						: undefined,
			};
		}
	} catch {
		// File doesn't exist or is invalid
	}
	return undefined;
}

/**
 * Save the notifications config to nanocoder.notifications in the preferences file.
 */
export function updateNotificationsPreference(
	config: import('@/types/config').NotificationsConfig,
): void {
	try {
		let raw: Record<string, unknown> = {};
		try {
			const data = readFileSync(getPreferencesPath(), 'utf-8');
			raw = JSON.parse(data) as Record<string, unknown>;
		} catch {
			// Start fresh if file doesn't exist
		}

		if (!raw.nanocoder || typeof raw.nanocoder !== 'object') {
			raw.nanocoder = {};
		}
		const nanocoder = raw.nanocoder as Record<string, unknown>;
		nanocoder.notifications = config;

		writeFileSync(getPreferencesPath(), JSON.stringify(raw, null, 2));
	} catch (error) {
		logError(`Failed to save notifications config: ${String(error)}`);
	}
}

/**
 * Get the paste threshold from the nanocoder.paste.singleLineThreshold
 * field in the preferences file (same path that loadPasteConfig reads).
 */
export function getPasteThreshold(): number | undefined {
	try {
		const data = readFileSync(getPreferencesPath(), 'utf-8');
		const raw = JSON.parse(data) as Record<string, unknown>;
		const nanocoder = raw.nanocoder as Record<string, unknown> | undefined;
		const paste = nanocoder?.paste as Record<string, unknown> | undefined;
		const threshold = paste?.singleLineThreshold;
		if (typeof threshold === 'number' && threshold > 0) {
			return Math.round(threshold);
		}
	} catch {
		// File doesn't exist or is invalid — return undefined
	}
	return undefined;
}

/**
 * Save the paste threshold to nanocoder.paste.singleLineThreshold
 * in the preferences file (same path that loadPasteConfig reads).
 */
export function updatePasteThreshold(threshold: number): void {
	try {
		let raw: Record<string, unknown> = {};
		try {
			const data = readFileSync(getPreferencesPath(), 'utf-8');
			raw = JSON.parse(data) as Record<string, unknown>;
		} catch {
			// Start fresh if file doesn't exist
		}

		if (!raw.nanocoder || typeof raw.nanocoder !== 'object') {
			raw.nanocoder = {};
		}
		const nanocoder = raw.nanocoder as Record<string, unknown>;

		if (!nanocoder.paste || typeof nanocoder.paste !== 'object') {
			nanocoder.paste = {};
		}
		const paste = nanocoder.paste as Record<string, unknown>;

		paste.singleLineThreshold = Math.round(threshold);

		writeFileSync(getPreferencesPath(), JSON.stringify(raw, null, 2));
	} catch (error) {
		logError(`Failed to save paste threshold: ${String(error)}`);
	}
}
