/**
 * Single source of truth for "is this a llama.cpp provider?". Used by:
 *   - provider-factory.ts to potentially add llama.cpp-specific headers
 *   - chat/provider-options.ts to forward constrained generation parameters
 *
 * Matching by `name` (case-insensitive) keeps configuration simple — users
 * name the provider "llama.cpp" / "llamacpp" / "llama-cpp" and constrained
 * generation support activates automatically.
 */
export function isLlamaCppProvider(providerName: string): boolean {
	const normalized = providerName.toLowerCase().replace(/[.\-_]/g, '');
	return normalized === 'llamacpp';
}
