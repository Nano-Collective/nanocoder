/**
 * Single source of truth for "is this a vLLM provider?". Used by:
 *   - provider-factory.ts to potentially add vLLM-specific headers
 *   - chat/provider-options.ts to forward constrained generation parameters
 *
 * Matching by `name` (case-insensitive) keeps configuration simple — users
 * just name the provider "vllm" / "vLLM" / "VLLM" and constrained generation
 * support activates automatically.
 */
export function isVLLMProvider(providerName: string): boolean {
	return providerName.toLowerCase() === 'vllm';
}
