import type {
	AIProviderConfig,
	AppConfig,
	TuneConfig,
	UserPreferences,
} from '@/types/config';
import {TUNE_DEFAULTS} from '@/types/config';

/**
 * Resolves tune configuration by merging layers:
 * hardcoded defaults → config per-provider → preferences → config top-level → session
 *
 * Precedence (lowest → highest):
 *   1. hardcoded defaults
 *   2. per-provider config
 *   3. user preferences
 *   4. app config (agents.config.json) — overrides preferences
 *   5. session override (highest priority)
 */
export function resolveTune(
	appConfig?: AppConfig,
	providerConfig?: AIProviderConfig,
	preferences?: UserPreferences,
	sessionOverride?: TuneConfig,
): TuneConfig {
	// Start with hardcoded defaults
	let resolved: TuneConfig = {...TUNE_DEFAULTS};

	// Layer: config per-provider
	if (providerConfig?.tune) {
		resolved = {...resolved, ...providerConfig.tune};
	}

	// Layer: preferences (last-used settings)
	if (preferences?.tune) {
		resolved = {...resolved, ...preferences.tune};
	}

	// Layer: config top-level (agents.config.json) — overrides preferences
	if (appConfig?.tune) {
		resolved = {...resolved, ...appConfig.tune};
	}

	// Layer: session override (highest priority)
	if (sessionOverride) {
		resolved = {...resolved, ...sessionOverride};
	}

	return resolved;
}
