/**
 * Single source of truth for "is this an Ollama provider?". Used by:
 *   - provider-factory.ts to potentially add Ollama-specific headers
 *   - chat/provider-options.ts to forward constrained generation parameters
 *
 * Matching by `name` (case-insensitive) keeps configuration simple — users
 * just name the provider "ollama" / "Ollama" / "OLLAMA" and constrained
 * generation support activates automatically.
 */
export function isOllamaProvider(providerName: string): boolean {
	return providerName.toLowerCase() === 'ollama';
}
