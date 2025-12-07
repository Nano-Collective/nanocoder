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

// ============================================================================
// Planning Preferences
// ============================================================================

export interface PlanningPreferences {
	enabled: boolean;
	maxTasksPerPlan: number;
}

const DEFAULT_PLANNING_PREFERENCES: PlanningPreferences = {
	enabled: false, // Disabled by default until feature is stable
	maxTasksPerPlan: 20,
};

export function getPlanningPreferences(): PlanningPreferences {
	const preferences = loadPreferences();
	return {
		enabled:
			preferences.planning?.enabled ?? DEFAULT_PLANNING_PREFERENCES.enabled,
		maxTasksPerPlan:
			preferences.planning?.maxTasksPerPlan ??
			DEFAULT_PLANNING_PREFERENCES.maxTasksPerPlan,
	};
}

export function setPlanningPreferences(
	planningPrefs: Partial<PlanningPreferences>,
): void {
	const preferences = loadPreferences();
	preferences.planning = {
		...preferences.planning,
		...planningPrefs,
	};
	savePreferences(preferences);
}
