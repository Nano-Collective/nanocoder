import {readFileSync, writeFileSync} from 'fs';
import {appConfig, getClosestConfigFile} from '@/config/index';
import type {ContextManagementConfig, UserPreferences} from '@/types/index';
import {DEFAULT_CONTEXT_CONFIG} from '@/types/index';
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

export function getLastUsedModel(provider: string): string | undefined {
	const preferences = loadPreferences();
	return preferences.providerModels?.[provider];
}

// Rolling context preference helpers

export function getRollingContextEnabled(): boolean {
	const preferences = loadPreferences();
	return preferences.rollingContextEnabled ?? false;
}

export function setRollingContextEnabled(enabled: boolean): void {
	const preferences = loadPreferences();
	preferences.rollingContextEnabled = enabled;
	savePreferences(preferences);
}

export function getContextManagementConfig(): Required<ContextManagementConfig> {
	const preferences = loadPreferences();
	const userConfig = preferences.contextManagement ?? {};

	// Merge with app config context management settings if available
	const appConfigContext = appConfig.contextManagement ?? {};

	return {
		...DEFAULT_CONTEXT_CONFIG,
		...appConfigContext,
		...userConfig,
		// Sync enabled state with quick toggle
		enabled:
			preferences.rollingContextEnabled ??
			userConfig.enabled ??
			appConfigContext.enabled ??
			false,
	};
}

export function setContextManagementConfig(
	config: Partial<ContextManagementConfig>,
): void {
	const preferences = loadPreferences();
	preferences.contextManagement = {
		...preferences.contextManagement,
		...config,
	};
	savePreferences(preferences);
}

export function getMaxInputTokens(): number {
	const config = getContextManagementConfig();
	return config.maxContextTokens - config.reservedOutputTokens;
}
