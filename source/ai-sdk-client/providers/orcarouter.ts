/**
 * Single source of truth for "is this an OrcaRouter provider?". Used by:
 *   - provider-factory.ts to attach OrcaRouter attribution headers
 *
 * Matching by `name` (case-insensitive) keeps configuration simple — users
 * just name the provider "orcarouter" / "OrcaRouter" / "ORCAROUTER" and
 * everything OrcaRouter-specific lights up. Mirrors `isOpenRouterProvider`.
 *
 * OrcaRouter (https://www.orcarouter.ai) is an OpenAI-compatible router, so it
 * flows through the generic `openai-compatible` SDK path with a fixed base URL
 * (https://api.orcarouter.ai/v1) and provider/model naming like OpenRouter
 * (e.g. `openai/gpt-5.5`).
 */
export function isOrcaRouterProvider(providerName: string): boolean {
	return providerName.toLowerCase() === 'orcarouter';
}
