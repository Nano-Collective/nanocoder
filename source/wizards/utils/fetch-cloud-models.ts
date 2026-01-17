/**
 * Fetch models from cloud LLM providers
 * - Anthropic: GET /v1/models with X-Api-Key header
 * - OpenAI: GET /v1/models with Authorization: Bearer header
 * - Mistral: GET /v1/models with Authorization: Bearer header
 * - GitHub: GET /catalog/models with Bearer token and X-GitHub-Api-Version header
 */

import type {
	CloudModelsEndpointType,
	FetchModelsResult,
	LocalModel,
} from './fetch-local-models';

interface CloudProviderConfig {
	endpoint: string;
	getHeaders: (apiKey: string) => Record<string, string>;
}

const CLOUD_PROVIDERS: Record<CloudModelsEndpointType, CloudProviderConfig> = {
	anthropic: {
		endpoint: 'https://api.anthropic.com/v1/models',
		getHeaders: apiKey => ({
			'X-Api-Key': apiKey,
			'anthropic-version': '2023-06-01',
			Accept: 'application/json',
		}),
	},
	openai: {
		endpoint: 'https://api.openai.com/v1/models',
		getHeaders: apiKey => ({
			Authorization: `Bearer ${apiKey}`,
			Accept: 'application/json',
		}),
	},
	mistral: {
		endpoint: 'https://api.mistral.ai/v1/models',
		getHeaders: apiKey => ({
			Authorization: `Bearer ${apiKey}`,
			Accept: 'application/json',
		}),
	},
	github: {
		endpoint: 'https://models.github.ai/catalog/models',
		getHeaders: apiKey => ({
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${apiKey}`,
			'X-GitHub-Api-Version': '2022-11-28',
		}),
	},
};

interface CloudModelsResponse {
	data?: Array<{
		id: string;
		name?: string; // GitHub
		display_name?: string; // Anthropic
		object?: string; // OpenAI/Mistral
	}>;
}

export interface FetchCloudModelsOptions {
	timeoutMs?: number;
	debug?: boolean;
}

/**
 * Fetch available models from a cloud LLM provider
 * @param providerType The cloud provider type ('anthropic', 'openai', 'mistral', 'github')
 * @param apiKey The API key for authentication
 * @param options Optional settings (timeoutMs, debug)
 */
export async function fetchCloudModels(
	providerType: CloudModelsEndpointType,
	apiKey: string,
	options: FetchCloudModelsOptions = {},
): Promise<FetchModelsResult> {
	const {timeoutMs = 10000, debug = false} = options;

	const log = (message: string) => {
		if (debug) {
			console.log(`[fetch-cloud-models] ${message}`);
		}
	};

	const providerConfig = CLOUD_PROVIDERS[providerType];
	if (!providerConfig) {
		return {
			success: false,
			models: [],
			error: `Unknown cloud provider: ${providerType}`,
		};
	}

	if (!apiKey || !apiKey.trim()) {
		return {
			success: false,
			models: [],
			error: 'API key is required',
		};
	}

	try {
		log(`Fetching models from ${providerType}: ${providerConfig.endpoint}`);

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		let data: CloudModelsResponse;
		try {
			const response = await fetch(providerConfig.endpoint, {
				method: 'GET',
				signal: controller.signal,
				headers: providerConfig.getHeaders(apiKey),
			});

			if (!response.ok) {
				log(`Server error: ${response.status} ${response.statusText}`);

				// Provide helpful error messages for common cases
				if (response.status === 401) {
					return {
						success: false,
						models: [],
						error: 'Invalid API key',
					};
				}
				if (response.status === 403) {
					return {
						success: false,
						models: [],
						error: 'API key does not have permission to list models',
					};
				}

				return {
					success: false,
					models: [],
					error: `API returned ${response.status}: ${response.statusText}`,
				};
			}

			log(`Response OK, parsing JSON...`);
			data = (await response.json()) as CloudModelsResponse;
			log(`JSON parsed successfully`);
		} finally {
			clearTimeout(timeoutId);
		}

		// GitHub returns a direct array, others return { data: [...] }
		type ModelEntry = {id: string; name?: string; display_name?: string};
		let modelArray: ModelEntry[];

		if (providerType === 'github') {
			// GitHub returns array directly
			if (!Array.isArray(data)) {
				return {
					success: false,
					models: [],
					error: 'Invalid response format from API',
				};
			}
			modelArray = data as unknown as ModelEntry[];
		} else {
			// Other providers return { data: [...] }
			if (!data.data || !Array.isArray(data.data)) {
				return {
					success: false,
					models: [],
					error: 'Invalid response format from API',
				};
			}
			modelArray = data.data;
		}

		// Parse models - use name (GitHub) or display_name (Anthropic), otherwise id
		const models: LocalModel[] = modelArray
			.filter(m => m && typeof m.id === 'string' && m.id.trim())
			.map(m => ({
				id: m.id.trim(),
				name: m.name || m.display_name || m.id.trim(),
			}))
			.sort((a, b) => a.name.localeCompare(b.name));

		log(`Found ${models.length} models (sorted)`);

		if (models.length === 0) {
			return {
				success: false,
				models: [],
				error: 'No models found for this API key',
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
