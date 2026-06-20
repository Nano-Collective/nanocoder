/**
 * Single source of truth for "is this a Requesty provider?". Used by:
 *   - provider-factory.ts to attach Requesty attribution headers
 *
 * Matching by `name` (case-insensitive) keeps configuration simple — users
 * just name the provider "requesty" / "Requesty" / "REQUESTY" and everything
 * Requesty-specific lights up. Mirrors `isOpenRouterProvider`.
 *
 * Requesty (https://requesty.ai) is an OpenAI-compatible router, so it flows
 * through the generic `openai-compatible` SDK path with a fixed base URL
 * (https://router.requesty.ai/v1) and provider/model naming like OpenRouter
 * (e.g. `openai/gpt-4o-mini`).
 */
export function isRequestyProvider(providerName: string): boolean {
	return providerName.toLowerCase() === 'requesty';
}
