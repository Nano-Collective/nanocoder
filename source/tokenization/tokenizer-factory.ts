/**
 * Tokenizer factory
 * Creates appropriate tokenizer based on provider and model
 */

import type {Tokenizer, TokenizerProvider} from '../types/tokenization.js';
import {AnthropicTokenizer} from './tokenizers/anthropic-tokenizer.js';
import {FallbackTokenizer} from './tokenizers/fallback-tokenizer.js';
import {LlamaTokenizer} from './tokenizers/llama-tokenizer.js';
import {OpenAITokenizer} from './tokenizers/openai-tokenizer.js';

/**
 * Detect provider from model ID or provider name
 */
function detectProvider(
	providerName: string,
	modelId: string,
): TokenizerProvider {
	const lowerProvider = providerName.toLowerCase();
	const lowerModel = modelId.toLowerCase();

	// Check provider name
	if (lowerProvider.includes('openai')) {
		return 'openai';
	}

	if (lowerProvider.includes('anthropic') || lowerProvider.includes('claude')) {
		return 'anthropic';
	}

	// Check model ID for common patterns
	if (lowerModel.includes('gpt') || lowerModel.includes('openai')) {
		return 'openai';
	}

	if (lowerModel.includes('claude')) {
		return 'anthropic';
	}

	if (
		lowerModel.includes('llama') ||
		lowerModel.includes('mistral') ||
		lowerModel.includes('qwen') ||
		lowerModel.includes('gemma') ||
		lowerModel.includes('phi') ||
		lowerModel.includes('codellama') ||
		lowerModel.includes('deepseek') ||
		lowerModel.includes('mixtral')
	) {
		return 'llama';
	}

	// Default to llama for local models (most common for local inference)
	if (
		lowerProvider.includes('ollama') ||
		lowerProvider.includes('llama.cpp') ||
		lowerProvider.includes('local')
	) {
		return 'llama';
	}

	return 'fallback';
}

/**
 * Create a tokenizer based on provider and model
 */
export function createTokenizer(
	providerName: string,
	modelId: string,
): Tokenizer {
	// Strip :cloud suffix if present (Ollama cloud models)
	const normalizedModelId =
		modelId.endsWith(':cloud') || modelId.endsWith('-cloud')
			? modelId.slice(0, -6)
			: modelId;

	const provider = detectProvider(providerName, normalizedModelId);

	switch (provider) {
		case 'openai':
			return new OpenAITokenizer(normalizedModelId);

		case 'anthropic':
			return new AnthropicTokenizer(normalizedModelId);

		case 'llama':
			return new LlamaTokenizer(normalizedModelId);

		case 'fallback':
		default:
			return new FallbackTokenizer();
	}
}
