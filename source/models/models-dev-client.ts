/**
 * API client for models.dev
 * Fetches and caches model metadata
 */

import {request} from 'undici';
import {TIMEOUT_HTTP_BODY_MS, TIMEOUT_HTTP_HEADERS_MS} from '@/constants';
import type {AIProviderConfig, ProviderConfig} from '@/types/config';
import {formatError} from '@/utils/error-formatter';
import {getLogger} from '@/utils/logging';
import {createSessionOverride} from '@/utils/session-override';
import {readCache, writeCache} from './models-cache.js';
import {
	buildModelsIndex,
	findIndexedModelById,
	findIndexedModelByName,
	indexedModelAcceptsImages,
} from './models-index.js';
import type {
	ModelInfo,
	ModelsDevDatabase,
	ModelsIndex,
} from './models-types.js';

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
	gemma4: 128000,
	'gemma4:e2b': 128000,
	'gemma4:e4b': 128000,
	'gemma4:26b': 256000,
	'gemma4:31b': 256000,

	// DeepSeek models (base matches wrong model on models.dev)
	'deepseek-coder': 16000,
	'deepseek-coder-v2': 128000,
	'deepseek-v3.1': 128000,

	// Phi models (not on models.dev)
	phi3: 128000,
	'phi3:mini': 128000,
	'phi3:medium': 128000,

	// Moonshot AI models (kimi-for-coding is a provider, not a model ID)
	'kimi-k2': 128000,
	'kimi-for-coding': 256000,

	// Mistral cloud aliases
	'devstral-small-2': 128000,
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
 * Fetch models data from models.dev API and reduce it to the compact index.
 * Falls back to cache if API is unavailable
 */
async function fetchModelsData(): Promise<ModelsIndex | null> {
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

		// Only the compact index is cached and kept: the raw ~10MB database is
		// garbage as soon as this function returns.
		const index = buildModelsIndex(body as ModelsDevDatabase);

		// Cache the successful response
		await writeCache(index);

		return index;
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
 * In-process memo of the models.dev index. The cache file is parsed once per
 * process, and what stays in memory is the compact index, not the ~10MB
 * database it was built from. The in-flight promise is shared so concurrent
 * lookups don't stampede, and negative results (no cache, fetch failed) are
 * memoized too: an offline session pays the fetch timeout once per process,
 * not once per response.
 */
let modelsDataMemo: Promise<ModelsIndex | null> | null = null;

/**
 * Get the models index, preferring cache if valid
 */
function getModelsData(): Promise<ModelsIndex | null> {
	if (!modelsDataMemo) {
		modelsDataMemo = (async () => {
			// Try cache first
			const cached = await readCache();
			if (cached) {
				return cached.data;
			}

			// Fetch fresh data if cache is invalid
			return fetchModelsData();
		})();
	}
	return modelsDataMemo;
}

/**
 * Per-name lookup memos. A name that isn't on models.dev (every local Ollama
 * tag) scans the whole index, and the same names are looked up again for
 * compaction and usage reports, so results are cached for the process,
 * including misses.
 */
const modelByIdMemo = new Map<string, ModelInfo | null>();
const modelByNameMemo = new Map<string, ModelInfo | null>();

/**
 * Find a model by ID across all providers
 */
async function findModelById(modelId: string): Promise<ModelInfo | null> {
	const memoized = modelByIdMemo.get(modelId);
	if (memoized !== undefined) {
		return memoized;
	}

	const index = await getModelsData();
	if (!index) {
		return null;
	}

	const found = findIndexedModelById(index, modelId);
	modelByIdMemo.set(modelId, found);
	return found;
}

/**
 * Find a model by partial name match
 * Useful for local models where exact ID might not match
 */
async function findModelByName(modelName: string): Promise<ModelInfo | null> {
	const memoized = modelByNameMemo.get(modelName);
	if (memoized !== undefined) {
		return memoized;
	}

	const index = await getModelsData();
	if (!index) {
		return null;
	}

	const found = findIndexedModelByName(index, modelName);
	modelByNameMemo.set(modelName, found);
	return found;
}

/**
 * Session-level context limit override.
 * Allows users to manually set a context limit via /context-max command.
 * Non-positive values collapse back to null (no override).
 */
const contextLimitSession = createSessionOverride<number>(limit =>
	limit !== null && limit > 0 ? limit : null,
);

export function setSessionContextLimit(limit: number | null): void {
	contextLimitSession.set(limit);
}

export function getSessionContextLimit(): number | null {
	return contextLimitSession.get();
}

export function resetSessionContextLimit(): void {
	contextLimitSession.reset();
}

export type ContextLimitSource =
	| 'session'
	| 'provider-model-config'
	| 'provider-config'
	| 'env'
	| 'model-lookup'
	| 'unknown';

export interface ModelContextLimitOptions {
	providerConfig?: AIProviderConfig | ProviderConfig;
}

export interface ResolvedContextLimit {
	limit: number | null;
	source: ContextLimitSource;
}

function getProviderConfiguredContextLimit(
	modelId: string,
	providerConfig?: AIProviderConfig | ProviderConfig,
): ResolvedContextLimit | null {
	if (!providerConfig) {
		return null;
	}

	const normalizedModelId = modelId.toLowerCase();
	const contextWindows = providerConfig.contextWindows;
	if (contextWindows) {
		for (const [configuredModel, configuredLimit] of Object.entries(
			contextWindows,
		)) {
			if (
				configuredModel.toLowerCase() === normalizedModelId &&
				typeof configuredLimit === 'number' &&
				configuredLimit > 0
			) {
				return {
					limit: configuredLimit,
					source: 'provider-model-config',
				};
			}
		}
	}

	if (
		typeof providerConfig.contextWindow === 'number' &&
		providerConfig.contextWindow > 0
	) {
		return {
			limit: providerConfig.contextWindow,
			source: 'provider-config',
		};
	}

	return null;
}

/**
 * Get context limit for a model.
 * Resolution order:
 * 1. Session override (from /context-max command)
 * 2. Provider model config override
 * 3. Provider default context window
 * 4. NANOCODER_CONTEXT_LIMIT env variable
 * 5. models.dev lookup / hardcoded Ollama defaults
 * 6. null (unknown)
 */
export async function resolveModelContextLimit(
	modelId: string,
	options: ModelContextLimitOptions = {},
): Promise<ResolvedContextLimit> {
	try {
		// Check session override first (highest priority)
		const sessionLimit = contextLimitSession.get();
		if (sessionLimit !== null) {
			return {limit: sessionLimit, source: 'session'};
		}

		const providerConfiguredLimit = getProviderConfiguredContextLimit(
			modelId,
			options.providerConfig,
		);
		if (providerConfiguredLimit) {
			return providerConfiguredLimit;
		}

		// Check environment variable fallback
		const envLimit = process.env.NANOCODER_CONTEXT_LIMIT;
		if (envLimit) {
			const parsed = Number.parseInt(envLimit, 10);
			if (!Number.isNaN(parsed) && parsed > 0) {
				return {limit: parsed, source: 'env'};
			}
		}

		// Strip :cloud or -cloud suffix if present (Ollama cloud models)
		const normalizedModelId =
			modelId.endsWith(':cloud') || modelId.endsWith('-cloud')
				? modelId.slice(0, -6)
				: modelId;

		// Try models.dev exact ID match first (primary source)
		let modelInfo = await findModelById(normalizedModelId);

		// Try models.dev partial name match if exact match fails
		if (!modelInfo) {
			modelInfo = await findModelByName(normalizedModelId);
		}

		// If found in models.dev, return that
		if (modelInfo) {
			return {limit: modelInfo.contextLimit, source: 'model-lookup'};
		}

		// Fall back to hardcoded Ollama model defaults (offline fallback)
		const ollamaLimitOriginal = getOllamaFallbackContextLimit(modelId);
		if (ollamaLimitOriginal) {
			return {limit: ollamaLimitOriginal, source: 'model-lookup'};
		}

		const ollamaLimit = getOllamaFallbackContextLimit(normalizedModelId);
		if (ollamaLimit) {
			return {limit: ollamaLimit, source: 'model-lookup'};
		}

		return {limit: null, source: 'unknown'};
	} catch (error) {
		const logger = getLogger();
		logger.error(
			{error: formatError(error), modelId},
			'Error getting model context limit',
		);
		return {limit: null, source: 'unknown'};
	}
}

export async function getModelContextLimit(
	modelId: string,
	options: ModelContextLimitOptions = {},
): Promise<number | null> {
	const resolved = await resolveModelContextLimit(modelId, options);
	return resolved.limit;
}

/**
 * Whether models.dev lists image input for this exact model id. Providers
 * can disagree, so any listing with image input wins. null when the model is
 * not listed (most local models), so callers can still try.
 */
export async function getModelAcceptsImages(
	modelId: string,
): Promise<boolean | null> {
	try {
		const index = await getModelsData();
		return index ? indexedModelAcceptsImages(index, modelId) : null;
	} catch {
		// Lookup failure is the same as an unlisted model.
		return null;
	}
}

/**
 * Per-model pricing memo. Both lookups below scan the whole database (and a
 * miss scans it twice), so the result — including the negative one for local
 * models that will never be on models.dev — is cached for the process.
 */
const pricingMemo = new Map<string, ModelInfo['cost'] | null>();

/**
 * Get pricing for a model in USD per 1M tokens.
 * Returns { input, output } from the cached models.dev database,
 * or null when the model isn't found (local model, no pricing data).
 */
export async function getModelPricing(
	modelId: string,
): Promise<ModelInfo['cost'] | null> {
	const memoized = pricingMemo.get(modelId);
	if (memoized !== undefined) {
		return memoized;
	}
	try {
		let modelInfo = await findModelById(modelId);

		if (!modelInfo) {
			modelInfo = await findModelByName(modelId);
		}

		const pricing = modelInfo ? modelInfo.cost : null;
		pricingMemo.set(modelId, pricing);
		return pricing;
	} catch {
		return null;
	}
}
