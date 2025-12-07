import {ModelEntry} from '@/types/index';

// Cache for fetched model data
interface ModelCache {
	models: ModelEntry[];
	timestamp: number;
}

// OpenRouter API response structure
interface OpenRouterModel {
	id: string;
	name: string;
	description: string;
	created: number;
	context_length: number;
	architecture: {
		modality: string;
		input_modalities: string[];
		output_modalities: string[];
		tokenizer: string;
	};
	pricing: {
		prompt: string;
		completion: string;
	};
	supported_parameters?: string[];
}

interface OpenRouterResponse {
	data: OpenRouterModel[];
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache
const OPENROUTER_API = 'https://openrouter.ai/api/v1/models';

let modelCache: ModelCache | null = null;

/**
 * Known open-weight model prefixes/patterns
 */
const OPEN_WEIGHT_PATTERNS = [
	'meta-llama/',
	'mistralai/',
	'qwen/',
	'deepseek/',
	'google/gemma',
	'microsoft/phi',
	'nvidia/',
	'cohere/command-r',
	'databricks/',
	'allenai/',
	'huggingfaceh4/',
	'openchat/',
	'teknium/',
	'nousresearch/',
	'cognitivecomputations/',
	'thebloke/',
	'codellama/',
	'/llama',
	'/mistral',
	'/qwen',
	'/deepseek',
	'/gemma',
	'/phi-',
	'/wizardlm',
	'/vicuna',
	'/falcon',
	'/starcoder',
	'/codestral',
	'/devstral',
];

/**
 * Check if a model is open-weight based on ID
 */
function isOpenWeight(modelId: string): boolean {
	const lowerId = modelId.toLowerCase();
	return OPEN_WEIGHT_PATTERNS.some(pattern => lowerId.includes(pattern));
}

/**
 * Extract author from model ID
 */
function extractAuthor(modelId: string): string {
	const parts = modelId.split('/');
	if (parts.length >= 2) {
		const author = parts[0];
		// Capitalize first letter
		return author.charAt(0).toUpperCase() + author.slice(1);
	}
	return 'Unknown';
}

/**
 * Check if model supports text input and output
 */
function supportsTextInTextOut(model: OpenRouterModel): boolean {
	const inputMods = model.architecture?.input_modalities || [];
	const outputMods = model.architecture?.output_modalities || [];

	const hasTextInput = inputMods.length === 0 || inputMods.includes('text');
	const hasTextOutput = outputMods.length === 0 || outputMods.includes('text');

	return hasTextInput && hasTextOutput;
}

/**
 * Check if model is relevant for coding (has tool support or is a known coding model)
 */
function isRelevantForCoding(model: OpenRouterModel): boolean {
	const modelId = model.id.toLowerCase();
	const modelName = model.name.toLowerCase();
	const description = (model.description || '').toLowerCase();

	// Must support text in/out
	if (!supportsTextInTextOut(model)) return false;

	// Skip embedding models
	if (modelId.includes('embed') || modelName.includes('embed')) return false;

	// Skip image/audio only models
	if (
		modelId.includes('dall-e') ||
		modelId.includes('stable-diffusion') ||
		modelId.includes('whisper') ||
		modelId.includes('tts') ||
		modelId.includes('imagen')
	) {
		return false;
	}

	// Has tool calling support
	if (model.supported_parameters?.includes('tools')) return true;

	// Known coding-capable models
	const codingPatterns = [
		'gpt',
		'claude',
		'gemini',
		'deepseek',
		'qwen',
		'coder',
		'codestral',
		'devstral',
		'llama',
		'mistral',
		'phi',
		'command',
		'grok',
		'codex',
	];

	if (codingPatterns.some(p => modelId.includes(p) || modelName.includes(p))) {
		return true;
	}

	// Description mentions coding
	if (
		description.includes('code') ||
		description.includes('programming') ||
		description.includes('developer')
	) {
		return true;
	}

	return false;
}

/**
 * Calculate cost score (0-10 scale, 10 = free/cheapest)
 */
function calculateCostScore(
	promptPrice: string,
	completionPrice: string,
): number {
	const input = parseFloat(promptPrice) || 0;
	const output = parseFloat(completionPrice) || 0;

	// Price per million tokens (prices are per token)
	const inputPerMillion = input * 1_000_000;
	const outputPerMillion = output * 1_000_000;

	// Weighted average (output typically more important)
	const avgCost = inputPerMillion * 0.3 + outputPerMillion * 0.7;

	if (avgCost === 0) return 10;
	if (avgCost < 0.1) return 9;
	if (avgCost < 0.5) return 8;
	if (avgCost < 1) return 7;
	if (avgCost < 2) return 6;
	if (avgCost < 5) return 5;
	if (avgCost < 10) return 4;
	if (avgCost < 20) return 3;
	if (avgCost < 50) return 2;
	return 1;
}

/**
 * Format cost details string
 */
function formatCostDetails(
	promptPrice: string,
	completionPrice: string,
	isLocal: boolean,
): string {
	const input = parseFloat(promptPrice) || 0;
	const output = parseFloat(completionPrice) || 0;

	if (input === 0 && output === 0) {
		return isLocal ? 'Free (open weights)' : 'Free';
	}

	// Convert to per million tokens
	const inputPerMillion = input * 1_000_000;
	const outputPerMillion = output * 1_000_000;

	return `$${inputPerMillion.toFixed(2)}/M in, $${outputPerMillion.toFixed(
		2,
	)}/M out`;
}

/**
 * Format context length for display
 */
function formatContextLength(contextLength: number): string {
	if (contextLength >= 1_000_000) {
		return `${(contextLength / 1_000_000).toFixed(1)}M`;
	}
	if (contextLength >= 1000) {
		return `${Math.round(contextLength / 1000)}K`;
	}
	return `${contextLength}`;
}

/**
 * Fetch models from OpenRouter API
 */
async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
	try {
		const response = await fetch(OPENROUTER_API);
		if (!response.ok) {
			throw new Error(`OpenRouter API returned ${response.status}`);
		}

		const data = (await response.json()) as OpenRouterResponse;
		return data.data || [];
	} catch (error) {
		console.error('Failed to fetch OpenRouter models:', error);
		return [];
	}
}

/**
 * Fetch and process models from OpenRouter
 */
export async function fetchModels(): Promise<ModelEntry[]> {
	// Check cache first
	if (modelCache && Date.now() - modelCache.timestamp < CACHE_TTL_MS) {
		return modelCache.models;
	}

	const openRouterModels = await fetchOpenRouterModels();
	const models: ModelEntry[] = [];

	for (const model of openRouterModels) {
		// Skip if not relevant for coding
		if (!isRelevantForCoding(model)) continue;

		const isLocal = isOpenWeight(model.id);
		const costScore = calculateCostScore(
			model.pricing.prompt,
			model.pricing.completion,
		);

		const entry: ModelEntry = {
			id: model.id,
			name: model.name,
			author: extractAuthor(model.id),
			size: formatContextLength(model.context_length),
			local: isLocal,
			api: true,
			contextLength: model.context_length,
			created: model.created,
			quality: {
				cost: costScore,
			},
			costType: costScore >= 9 ? ('free' as const) : ('paid' as const),
			costDetails: formatCostDetails(
				model.pricing.prompt,
				model.pricing.completion,
				isLocal,
			),
			hasToolSupport: model.supported_parameters?.includes('tools') || false,
		};

		models.push(entry);
	}

	// Sort by created date (newest first)
	models.sort((a, b) => (b.created || 0) - (a.created || 0));

	// Update cache
	modelCache = {
		models,
		timestamp: Date.now(),
	};

	return models;
}

/**
 * Clear the model cache (useful for forcing a refresh)
 */
export function clearModelCache(): void {
	modelCache = null;
}

/**
 * Check if models are currently cached
 */
export function isModelsCached(): boolean {
	return (
		modelCache !== null && Date.now() - modelCache.timestamp < CACHE_TTL_MS
	);
}
