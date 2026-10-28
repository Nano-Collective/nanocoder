/**
 * Single source of truth for "is this an Opper provider?". Used by:
 *   - provider-factory.ts to attach the Opper trace-naming header
 *
 * Matching by `name` (case-insensitive) keeps configuration simple — users
 * just name the provider "opper" / "Opper" / "OPPER" and everything
 * Opper-specific lights up. Mirrors `isOpenRouterProvider`.
 *
 * Opper (https://opper.ai) is an EU-hosted OpenAI-compatible gateway, so it
 * flows through the generic `openai-compatible` SDK path with a fixed base URL
 * (https://api.opper.ai/v3/compat). Model ids are bare pool names such as
 * `claude-sonnet-4-6`, with `provider/model` ids available to pin one route.
 */
export function isOpperProvider(providerName: string): boolean {
	return providerName.toLowerCase() === 'opper';
}
