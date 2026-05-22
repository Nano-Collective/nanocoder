/**
 * Single source of truth for "is this an OpenRouter provider?". Used by:
 *   - provider-factory.ts to attach OpenRouter attribution headers
 *   - chat/provider-options.ts to forward the `openrouter` request body block
 *   - client-factory.ts to lint provider configs at load time
 *
 * Matching by `name` (case-insensitive) keeps configuration simple — users
 * just name the provider "openrouter" / "OpenRouter" / "OPENROUTER" and
 * everything OpenRouter-specific lights up.
 */
export function isOpenRouterProvider(providerName: string): boolean {
	return providerName.toLowerCase() === 'openrouter';
}
