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

export function getLastUsedModel(provider: string): string | undefined {
	const preferences = loadPreferences();
	return preferences.providerModels?.[provider];
}

export function isStreamingEnabled(): boolean {
	const preferences = loadPreferences();
	// Default to true if not set
	return preferences.streamingEnabled ?? true;
}

export function setStreamingEnabled(enabled: boolean): void {
	const preferences = loadPreferences();
	preferences.streamingEnabled = enabled;
	savePreferences(preferences);
}

export function isDebuggingEnabled(): boolean {
	const preferences = loadPreferences();
	// Default to false if not set
	return preferences.debuggingEnabled ?? false;
}

export function setDebuggingEnabled(enabled: boolean): void {
	const preferences = loadPreferences();
	preferences.debuggingEnabled = enabled;
	savePreferences(preferences);
}

export function getAutoContinuationMode(): 'always' | 'smart' | 'never' {
	const preferences = loadPreferences();
	// Default to 'smart' if not set
	return preferences.autoContinuationMode ?? 'smart';
}

export function setAutoContinuationMode(
	mode: 'always' | 'smart' | 'never',
): void {
	const preferences = loadPreferences();
	preferences.autoContinuationMode = mode;
	savePreferences(preferences);
}
