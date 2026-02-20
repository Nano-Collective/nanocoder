/**
 * API client for models.dev
 * Fetches and caches model metadata
 */

import {request} from 'undici';
import {TIMEOUT_HTTP_BODY_MS, TIMEOUT_HTTP_HEADERS_MS} from '@/constants';
import {formatError} from '@/utils/error-formatter';
import {getLogger} from '@/utils/logging';
import {readCache, writeCache} from './models-cache.js';
import type {ModelInfo, ModelsDevDatabase} from './models-types.js';

const MODELS_DEV_API_URL = 'https://models.dev/api.json';

/**
 * Fallback context limits for common Ollama model architectures
 * Used when models.dev doesn't have the model data
 */
const OLLAMA_MODEL_CONTEXT_LIMITS: Record<string, number> = {
	// Llama 3.2 models (not on models.dev)
	'llama3.2': 128000,
	'llama3.2:1b': 128000,
	'llama3.2:3b': 128000,

	// Llama 3.1 models (base matches wrong model on models.dev)
	'llama3.1': 128000,
	'llama3.1:8b': 128000,
	'llama3.1:70b': 128000,
	'llama3.1:405b': 128000,

	// Llama 3 models (size variants not on models.dev)
	'llama3:8b': 8192,
	'llama3:70b': 8192,

	// Llama 2 models (not on models.dev)
	llama2: 4096,
	'llama2:7b': 4096,
	'llama2:13b': 4096,
	'llama2:70b': 4096,

	// Mistral models (base matches wrong model on models.dev)
	mistral: 32000,
	'mistral:7b': 32000,
	'mixtral:8x7b': 32000,
	'mixtral:8x22b': 64000,
	'ministral:3b': 256000,
	'ministral:8b': 256000,

	// Qwen models (base names match wrong models on models.dev)
	qwen: 32000,
	'qwen:7b': 32000,
	'qwen:14b': 32000,
	qwen2: 32000,
	'qwen2:7b': 32000,
	'qwen2.5': 128000,
	'qwen2.5:7b': 128000,
	qwen3: 128000,
	'qwen3:7b': 128000,
	'qwen3:14b': 128000,
	'qwen3:32b': 128000,

	// Gemma models (base matches wrong model on models.dev)
	gemma: 8192,
	'gemma:2b': 8192,
	'gemma:7b': 8192,
	'gemma2:9b': 8192,
	'gemma2:27b': 8192,

	// DeepSeek models (base matches wrong model on models.dev)
	'deepseek-coder': 16000,
	'deepseek-coder-v2': 128000,

	// Phi models (not on models.dev)
	phi3: 128000,
	'phi3:mini': 128000,
	'phi3:medium': 128000,

	// Moonshot AI models (kimi-for-coding is a provider, not a model ID)
	'kimi-for-coding': 256000,
};

/**
 * Extract base model architecture from Ollama model name
 * e.g., "llama3.1:8b-instruct-q4_0" -> "llama3.1:8b"
 */
function extractOllamaModelBase(modelName: string): string | null {
	const lower = modelName.toLowerCase();

	// Sort keys by length descending so longer/more specific keys match first
	// e.g., "qwen3-coder:480b" matches before "qwen3", "mixtral:8x22b" before "mixtral"
	const sortedKeys = Object.keys(OLLAMA_MODEL_CONTEXT_LIMITS).sort(
		(a, b) => b.length - a.length,
	);

	// Try exact and prefix matches
	for (const key of sortedKeys) {
		if (
			lower === key ||
			lower.startsWith(`${key}-`) ||
			lower.startsWith(`${key}:`)
		) {
			return key;
		}
	}

	// Try to match base architecture (also sorted by specificity)
	for (const key of sortedKeys) {
		if (lower.includes(key)) {
			return key;
		}
	}

	return null;
}

/**
 * Get fallback context limit for Ollama models
 */
function getOllamaFallbackContextLimit(modelName: string): number | null {
	const baseModel = extractOllamaModelBase(modelName);
	if (!baseModel) {
		return null;
	}

	return OLLAMA_MODEL_CONTEXT_LIMITS[baseModel] || null;
}

/**
 * Fetch models data from models.dev API
 * Falls back to cache if API is unavailable
 */
async function fetchModelsData(): Promise<ModelsDevDatabase | null> {
	try {
		const response = await request(MODELS_DEV_API_URL, {
			method: 'GET',
			headersTimeout: TIMEOUT_HTTP_HEADERS_MS,
			bodyTimeout: TIMEOUT_HTTP_BODY_MS,
		});

		if (response.statusCode !== 200) {
			throw new Error(
				`Failed to fetch models data: HTTP ${response.statusCode}`,
			);
		}

		const body = await response.body.json();
		const data = body as ModelsDevDatabase;

		// Cache the successful response
		await writeCache(data);

		return data;
	} catch (error) {
		const logger = getLogger();
		logger.warn({error: formatError(error)}, 'Failed to fetch from models.dev');

		// Try to use cached data as fallback
		const cached = await readCache();
		if (cached) {
			logger.info('Using cached models data');
			return cached.data;
		}

		return null;
	}
}

/**
 * Get models data, preferring cache if valid
 */
async function getModelsData(): Promise<ModelsDevDatabase | null> {
	// Try cache first
	const cached = await readCache();
	if (cached) {
		return cached.data;
	}

	// Fetch fresh data if cache is invalid
	return fetchModelsData();
}

/**
 * Find a model by ID across all providers
 * Returns the model info and provider name
 */
async function findModelById(modelId: string): Promise<ModelInfo | null> {
	const data = await getModelsData();
	if (!data) {
		return null;
	}

	// Search through all providers
	for (const [_providerId, provider] of Object.entries(data)) {
		// Skip malformed provider entries
		if (!provider || typeof provider !== 'object' || !provider.models) {
			continue;
		}
		const model = provider.models[modelId];
		if (model) {
			return {
				id: model.id,
				name: model.name,
				provider: provider.name,
				contextLimit: model.limit?.context ?? null,
				outputLimit: model.limit?.output ?? null,
				supportsToolCalls: model.tool_call ?? false,
				cost: {
					input: model.cost?.input ?? 0,
					output: model.cost?.output ?? 0,
				},
			};
		}
	}

	return null;
}

/**
 * Find a model by partial name match
 * Useful for local models where exact ID might not match
 */
async function findModelByName(modelName: string): Promise<ModelInfo | null> {
	// Empty string matches everything with .includes(), so return null early
	if (!modelName) {
		return null;
	}

	const data = await getModelsData();
	if (!data) {
		return null;
	}

	const lowerName = modelName.toLowerCase();

	let bestMatch: ModelInfo | null = null;
	let bestScore = 0;

	// Search through all providers with scored matching
	for (const [_providerId, provider] of Object.entries(data)) {
		// Skip malformed provider entries
		if (!provider || typeof provider !== 'object' || !provider.models) {
			continue;
		}
		for (const [_modelId, model] of Object.entries(provider.models)) {
			// Skip malformed model entries
			if (!model || typeof model !== 'object') {
				continue;
			}

			const modelIdLower = model.id?.toLowerCase() ?? '';
			const modelNameLower = model.name?.toLowerCase() ?? '';

			let score = 0;

			// Exact ID match → return immediately
			if (modelIdLower === lowerName) {
				return {
					id: model.id,
					name: model.name,
					provider: provider.name,
					contextLimit: model.limit?.context ?? null,
					outputLimit: model.limit?.output ?? null,
					supportsToolCalls: model.tool_call ?? false,
					cost: {
						input: model.cost?.input ?? 0,
						output: model.cost?.output ?? 0,
					},
				};
			}

			// ID starts with search term → high score
			if (modelIdLower.startsWith(lowerName)) {
				score = 3;
			}
			// Name starts with search term → medium score
			else if (modelNameLower.startsWith(lowerName)) {
				score = 2;
			}
			// ID or Name contains search term → low score
			else if (
				modelIdLower.includes(lowerName) ||
				modelNameLower.includes(lowerName)
			) {
				score = 1;
			}

			if (score > bestScore) {
				bestScore = score;
				bestMatch = {
					id: model.id,
					name: model.name,
					provider: provider.name,
					contextLimit: model.limit?.context ?? null,
					outputLimit: model.limit?.output ?? null,
					supportsToolCalls: model.tool_call ?? false,
					cost: {
						input: model.cost?.input ?? 0,
						output: model.cost?.output ?? 0,
					},
				};
			}
		}
	}

	return bestMatch;
}

/**
 * Get context limit for a model
 * Returns null if model not found and no fallback available
 */
export async function getModelContextLimit(
	modelId: string,
): Promise<number | null> {
	try {
		// Strip :cloud or -cloud suffix if present (Ollama cloud models)
		const normalizedModelId =
			modelId.endsWith(':cloud') || modelId.endsWith('-cloud')
				? modelId.slice(0, -6) // Remove ":cloud" or "-cloud"
				: modelId;

		// Try models.dev exact ID match first (primary source)
		let modelInfo = await findModelById(normalizedModelId);

		// Try models.dev partial name match if exact match fails
		if (!modelInfo) {
			modelInfo = await findModelByName(normalizedModelId);
		}

		// If found in models.dev, return that
		if (modelInfo) {
			return modelInfo.contextLimit;
		}

		// Fall back to hardcoded Ollama model defaults (offline fallback)
		// Try original model ID first (handles entries like "kimi-k2:1t-cloud")
		const ollamaLimitOriginal = getOllamaFallbackContextLimit(modelId);
		if (ollamaLimitOriginal) {
			return ollamaLimitOriginal;
		}

		// Try normalized ID (without cloud suffix)
		const ollamaLimit = getOllamaFallbackContextLimit(normalizedModelId);
		if (ollamaLimit) {
			return ollamaLimit;
		}

		// No context limit found
		return null;
	} catch (error) {
		// Log error but don't crash - just return null
		const logger = getLogger();
		logger.error(
			{error: formatError(error), modelId},
			'Error getting model context limit',
		);
		return null;
	}
}
