import type {
	AIProviderConfig,
	AppConfig,
	TuneConfig,
	UserPreferences,
} from '@/types/config';
import {TUNE_DEFAULTS} from '@/types/config';

/**
 * Resolves tune configuration by merging layers:
 * hardcoded defaults → config top-level → config per-provider → preferences → session
 */
export function resolveTune(
	appConfig?: AppConfig,
	providerConfig?: AIProviderConfig,
	preferences?: UserPreferences,
	sessionOverride?: TuneConfig,
): TuneConfig {
	// Start with hardcoded defaults
	let resolved: TuneConfig = {...TUNE_DEFAULTS};

	// Layer: config top-level
	if (appConfig?.tune) {
		resolved = {...resolved, ...appConfig.tune};
	}

	// Layer: config per-provider
	if (providerConfig?.tune) {
		resolved = {...resolved, ...providerConfig.tune};
	}

	// Layer: preferences (last-used settings)
	if (preferences?.tune) {
		resolved = {...resolved, ...preferences.tune};
	}

	// Layer: session override (highest priority)
	if (sessionOverride) {
		resolved = {...resolved, ...sessionOverride};
	}

	return resolved;
}
