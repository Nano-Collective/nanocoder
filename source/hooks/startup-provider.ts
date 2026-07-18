/**
 * Pure decision logic for resolving which provider name should be used at
 * startup, and whether the resolved name is "stale" (saved/mode provider no
 * longer present in the configured provider list).
 *
 * Kept side-effect free on purpose: the caller owns loading the configured
 * provider names (`loadAllProviderConfigs()`) and any UI side effects (e.g.
 * queuing a warning message) triggered by a stale result.
 */
export interface ResolvedStartupProvider {
	/** The provider name to pass through, or undefined to use the default. */
	provider: string | undefined;
	/**
	 * Set to the original (stale) name when a saved/mode provider was
	 * rejected because it isn't in the configured provider list. Absent when
	 * no fallback occurred (including the strict `cliProvider` path, which
	 * never triggers a fallback).
	 */
	staleName?: string;
}

/**
 * Resolve the startup provider name from CLI args, mode config, and saved
 * preferences, applying the "unknown saved/mode provider falls back to the
 * default provider" rule.
 *
 * An explicit `cliProvider` is always passed through unchanged, even if it
 * isn't in `configuredNames` — the user asked for that provider by name, so
 * a hard error downstream (in `createLLMClient`) is the honest response.
 */
export function resolveStartupProvider(
	cliProvider: string | undefined,
	modeProvider: string | undefined,
	lastProvider: string | undefined,
	configuredNames: readonly string[],
): ResolvedStartupProvider {
	const provider = cliProvider || modeProvider || lastProvider;

	if (!cliProvider && provider) {
		const staleName = provider;
		const known = configuredNames.some(
			name => name.toLowerCase() === staleName.toLowerCase(),
		);
		if (!known) {
			return {provider: undefined, staleName};
		}
	}

	return {provider};
}
