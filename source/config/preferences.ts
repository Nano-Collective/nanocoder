import {readFileSync, writeFileSync} from 'fs';
import {logError} from '@/utils/message-queue';
import {getClosestConfigFile} from '@/config/index';

import type {UserPreferences} from '@/types/index';

let PREFERENCES_PATH: string | null = null;

function getPreferencesPath(): string {
	if (!PREFERENCES_PATH) {
		PREFERENCES_PATH = getClosestConfigFile('nanocoder-preferences.json');
	}
	return PREFERENCES_PATH;
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

export function getSessionConfig(): UserPreferences['sessions'] {
	const preferences = loadPreferences();
	return preferences.sessions || {};
}

export function updateSessionConfig(config: UserPreferences['sessions']): void {
	const preferences = loadPreferences();
	
	if (!preferences.sessions) {
		preferences.sessions = {};
	}
	
	// Merge the new config with existing session config
	preferences.sessions = {
		...preferences.sessions,
		...config
	};

	savePreferences(preferences);
}

export function getLastUsedModel(provider: string): string | undefined {
	const preferences = loadPreferences();
	return preferences.providerModels?.[provider];
}
