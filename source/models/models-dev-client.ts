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
	// Llama 3.2 models
	'llama3.2': 128000,
	'llama3.2:1b': 128000,
	'llama3.2:3b': 128000,

	// Llama 3.1 models
	'llama3.1': 128000,
	'llama3.1:8b': 128000,
	'llama3.1:70b': 128000,
	'llama3.1:405b': 128000,

	// Llama 3 models
	llama3: 8192,
	'llama3:8b': 8192,
	'llama3:70b': 8192,

	// Llama 2 models
	llama2: 4096,
	'llama2:7b': 4096,
	'llama2:13b': 4096,
	'llama2:70b': 4096,

	// Mistral models
	mistral: 32000,
	'mistral:7b': 32000,
	'mistral-large': 256000,
	mixtral: 32000,
	'mixtral:8x7b': 32000,
	'mixtral:8x22b': 64000,
	ministral: 256000,
	'ministral:3b': 256000,
	'ministral:8b': 256000,
	'devstral-small-2:24b': 256000,
	'devstral-2': 256000,

	// Essentials AI models
	'rnj-1:8b': 32000,

	// Qwen models
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
	'qwen3-coder:480b': 256000,

	// Gemma models
	gemma: 8192,
	'gemma:2b': 8192,
	'gemma:7b': 8192,
	gemma2: 8192,
	'gemma2:9b': 8192,
	'gemma2:27b': 8192,

	// Command-R models
	'command-r': 128000,
	'command-r-plus': 128000,

	// DeepSeek models
	'deepseek-coder': 16000,
	'deepseek-coder-v2': 128000,
	'deepseek-v3.1': 128000,
	'deepseek-v3.2': 128000,

	// Phi models
	phi3: 128000,
	'phi3:mini': 128000,
	'phi3:medium': 128000,

	// OpenAI models
	'gpt-oss:120b': 128000,
	'gpt-oss:20b': 128000,

	// Z.ai models
	'glm-4.7': 200000,

	// Moonshot AI models
	'kimi-k2:1t-cloud': 256000,
	'kimi-k2-thinking:cloud': 256000,

	// Cloud models
	'minimax-m2:cloud': 196608,
};

/**
 * Extract base model architecture from Ollama model name
 * e.g., "llama3.1:8b-instruct-q4_0" -> "llama3.1:8b"
 */
function extractOllamaModelBase(modelName: string): string | null {
	const lower = modelName.toLowerCase();

	// Try exact matches first
	for (const key of Object.keys(OLLAMA_MODEL_CONTEXT_LIMITS)) {
		if (
			lower === key ||
			lower.startsWith(`${key}-`) ||
			lower.startsWith(`${key}:`)
		) {
			return key;
		}
	}

	// Try to match base architecture
	if (lower.includes('llama3.2')) return 'llama3.2';
	if (lower.includes('llama3.1')) return 'llama3.1';
	if (lower.includes('llama3')) return 'llama3';
	if (lower.includes('llama2')) return 'llama2';
	if (lower.includes('mixtral:8x22b')) return 'mixtral:8x22b';
	if (lower.includes('mixtral')) return 'mixtral';
	if (lower.includes('ministral')) return 'ministral';
	if (lower.includes('mistral-large')) return 'mistral-large';
	if (lower.includes('mistral')) return 'mistral';
	if (lower.includes('qwen2.5')) return 'qwen2.5';
	if (lower.includes('qwen2')) return 'qwen2';
	if (lower.includes('qwen')) return 'qwen';
	if (lower.includes('gemma2')) return 'gemma2';
	if (lower.includes('gemma')) return 'gemma';
	if (lower.includes('command-r-plus')) return 'command-r-plus';
	if (lower.includes('command-r')) return 'command-r';
	if (lower.includes('deepseek-coder-v2')) return 'deepseek-coder-v2';
	if (lower.includes('deepseek')) return 'deepseek-coder';
	if (lower.includes('phi3')) return 'phi3';

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
		const model = provider.models[modelId];
		if (model) {
			return {
				id: model.id,
				name: model.name,
				provider: provider.name,
				contextLimit: model.limit.context,
				outputLimit: model.limit.output,
				supportsToolCalls: model.tool_call,
				cost: {
					input: model.cost.input,
					output: model.cost.output,
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

	// Search through all providers
	for (const [_providerId, provider] of Object.entries(data)) {
		for (const [_modelId, model] of Object.entries(provider.models)) {
			if (
				model.id.toLowerCase().includes(lowerName) ||
				model.name.toLowerCase().includes(lowerName)
			) {
				return {
					id: model.id,
					name: model.name,
					provider: provider.name,
					contextLimit: model.limit.context,
					outputLimit: model.limit.output,
					supportsToolCalls: model.tool_call,
					cost: {
						input: model.cost.input,
						output: model.cost.output,
					},
				};
			}
		}
	}

	return null;
}

/**
 * Get context limit for a model
 * Returns null if model not found and no fallback available
 */
export async function getModelContextLimit(
	modelId: string,
): Promise<number | null> {
	// Try Ollama fallback first with original model ID (before normalization)
	// This handles cloud models like gpt-oss:20b-cloud
	const ollamaLimitOriginal = getOllamaFallbackContextLimit(modelId);
	if (ollamaLimitOriginal) {
		return ollamaLimitOriginal;
	}

	// Strip :cloud or -cloud suffix if present (Ollama cloud models)
	const normalizedModelId =
		modelId.endsWith(':cloud') || modelId.endsWith('-cloud')
			? modelId.slice(0, -6) // Remove ":cloud" or "-cloud"
			: modelId;

	// Try exact ID match first
	let modelInfo = await findModelById(normalizedModelId);

	// Try partial name match if exact match fails
	if (!modelInfo) {
		modelInfo = await findModelByName(normalizedModelId);
	}

	// If found in models.dev, return that
	if (modelInfo) {
		return modelInfo.contextLimit;
	}

	// Fall back to Ollama model defaults with normalized ID
	const ollamaLimit = getOllamaFallbackContextLimit(normalizedModelId);
	if (ollamaLimit) {
		return ollamaLimit;
	}

	// No context limit found
	return null;
}
