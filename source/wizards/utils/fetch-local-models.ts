/**
 * Fetch models from local LLM providers
 * - Ollama: GET /api/tags → { models: [{ name: "llama3:8b" }] }
 * - OpenAI-compatible (LM Studio, llama.cpp): GET /v1/models → { data: [{ id: "model-name" }] }
 */

export interface LocalModel {
	id: string;
	name: string;
}

export type LocalModelsEndpointType = 'ollama' | 'openai-compatible';
export type CloudModelsEndpointType =
	| 'anthropic'
	| 'openai'
	| 'mistral'
	| 'github';
export type ModelsEndpointType =
	| LocalModelsEndpointType
	| CloudModelsEndpointType;

interface OllamaResponse {
	models: Array<{name: string}>;
}

interface OpenAICompatibleResponse {
	data: Array<{id: string; object?: string}>;
}

export interface FetchModelsResult {
	success: boolean;
	models: LocalModel[];
	error?: string;
}

export interface FetchLocalModelsOptions {
	timeoutMs?: number;
	debug?: boolean;
}

/**
 * Fetch available models from a local LLM provider
 * @param baseUrl The base URL of the provider
 * @param providerType The type of API endpoint ('ollama' or 'openai-compatible')
 * @param options Optional settings (timeoutMs, debug)
 */
export async function fetchLocalModels(
	baseUrl: string,
	providerType: LocalModelsEndpointType,
	options: FetchLocalModelsOptions = {},
): Promise<FetchModelsResult> {
	const {timeoutMs = 2000, debug = false} = options;

	const log = (message: string) => {
		if (debug) {
			console.log(`[fetch-local-models] ${message}`);
		}
	};

	try {
		// Normalize the base URL
		let normalizedUrl = baseUrl.trim();
		log(`Input URL: ${baseUrl}, Provider type: ${providerType}`);
		if (normalizedUrl.endsWith('/')) {
			normalizedUrl = normalizedUrl.slice(0, -1);
		}

		// Build the endpoint URL based on provider type
		let endpoint: string;
		if (providerType === 'ollama') {
			// Ollama's models endpoint is at /api/tags
			// If baseUrl contains /v1, we need to strip it for the models endpoint
			normalizedUrl = normalizedUrl.replace(/\/v1$/, '');
			endpoint = `${normalizedUrl}/api/tags`;
		} else {
			// OpenAI-compatible endpoint is at /v1/models
			// Ensure we have /v1 in the path (exact match, not /v10, /v1beta, etc.)
			if (normalizedUrl.endsWith('/v1')) {
				// Already ends with /v1, use as-is
				endpoint = `${normalizedUrl}/models`;
			} else if (normalizedUrl.includes('/v1/')) {
				// Has /v1/ somewhere in the path - extract base up to and including /v1
				const v1Index = normalizedUrl.indexOf('/v1/');
				normalizedUrl = normalizedUrl.substring(0, v1Index + 3); // +3 for '/v1'
				endpoint = `${normalizedUrl}/models`;
			} else {
				// No /v1 in path - append it
				endpoint = `${normalizedUrl}/v1/models`;
			}
		}

		log(`Fetching from endpoint: ${endpoint}`);

		// Create AbortController for timeout
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		let data: unknown;
		try {
			const response = await fetch(endpoint, {
				method: 'GET',
				signal: controller.signal,
				headers: {
					Accept: 'application/json',
				},
			});

			if (!response.ok) {
				log(`Server error: ${response.status} ${response.statusText}`);
				return {
					success: false,
					models: [],
					error: `Server returned ${response.status}: ${response.statusText}`,
				};
			}

			log(`Response OK, parsing JSON...`);
			data = await response.json();
			log(`JSON parsed successfully`);
		} finally {
			// Always clear timeout, even if fetch or JSON parsing throws
			clearTimeout(timeoutId);
		}

		let models: LocalModel[] = [];

		if (providerType === 'ollama') {
			const ollamaData = data as OllamaResponse;
			if (ollamaData.models && Array.isArray(ollamaData.models)) {
				// Runtime validation: filter out invalid entries
				models = ollamaData.models
					.filter(m => m && typeof m.name === 'string' && m.name.trim())
					.map(m => ({
						id: m.name.trim(),
						name: m.name.trim(),
					}));
			}
		} else {
			const openaiData = data as OpenAICompatibleResponse;
			if (openaiData.data && Array.isArray(openaiData.data)) {
				// Runtime validation: filter out invalid entries
				models = openaiData.data
					.filter(m => m && typeof m.id === 'string' && m.id.trim())
					.map(m => ({
						id: m.id.trim(),
						name: m.id.trim(),
					}));
			}
		}

		// Sort models alphabetically
		models.sort((a, b) => a.name.localeCompare(b.name));

		log(`Found ${models.length} valid models (sorted)`);

		if (models.length === 0) {
			return {
				success: false,
				models: [],
				error: 'No models found on the server',
			};
		}

		return {
			success: true,
			models,
		};
	} catch (err) {
		if (err instanceof Error) {
			if (err.name === 'AbortError') {
				log(`Request timed out after ${timeoutMs}ms`);
				return {
					success: false,
					models: [],
					error: 'Connection timed out',
				};
			}
			log(`Error: ${err.message}`);
			return {
				success: false,
				models: [],
				error: err.message,
			};
		}
		log(`Unknown error occurred`);
		return {
			success: false,
			models: [],
			error: 'Unknown error occurred',
		};
	}
}
