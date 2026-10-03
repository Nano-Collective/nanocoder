/**
 * Unified model fetching for all provider types.
 *
 * Determines the right endpoint URL, auth headers, and response parsing
 * based on the API compatibility type:
 * - openai-compatible: GET {baseUrl}/models with Bearer auth
 * - ollama: GET {baseUrl}/api/tags (no auth)
 * - anthropic: GET {baseUrl}/models with X-Api-Key header
 * - google: GET {baseUrl}/models with x-goog-api-key header
 */

import {formatError} from '@/utils/error-formatter';

export interface FetchedModel {
	id: string;
	name: string;
}

export interface FetchModelsResult {
	success: boolean;
	models: FetchedModel[];
	error?: string;
}

export type ApiCompatibility =
	| 'openai-compatible'
	| 'ollama'
	| 'anthropic'
	| 'google';

interface FetchModelsOptions {
	timeoutMs?: number;
}

/**
 * Fetch available models from a provider.
 * @param baseUrl The provider's base URL
 * @param apiCompatibility The API type to determine endpoint/auth/parsing
 * @param apiKey Optional API key for authentication
 * @param options Optional settings
 */
export async function fetchModels(
	baseUrl: string,
	apiCompatibility: ApiCompatibility,
	apiKey?: string,
	options: FetchModelsOptions = {},
): Promise<FetchModelsResult> {
	const {timeoutMs = 5000} = options;

	try {
		let normalizedUrl = baseUrl.trim().replace(/\/$/, '');

		// Build endpoint URL and headers based on API type
		let endpoint: string;
		const headers: Record<string, string> = {Accept: 'application/json'};

		switch (apiCompatibility) {
			case 'ollama': {
				// Ollama: GET /api/tags, strip /v1 if present
				normalizedUrl = normalizedUrl.replace(/\/v1$/, '');
				endpoint = `${normalizedUrl}/api/tags`;
				break;
			}
			case 'anthropic': {
				// Anthropic: GET {baseUrl}/models with X-Api-Key
				endpoint = `${normalizedUrl}/models`;
				if (apiKey) {
					headers['X-Api-Key'] = apiKey;
					headers['anthropic-version'] = '2023-06-01';
				}
				break;
			}
			case 'google': {
				// Google: GET {baseUrl}/models with x-goog-api-key
				endpoint = `${normalizedUrl}/models`;
				if (apiKey) {
					headers['x-goog-api-key'] = apiKey;
				}
				break;
			}
			default: {
				// OpenAI-compatible: GET {baseUrl}/models with Bearer auth
				endpoint = resolveOpenAICompatibleModelsEndpoint(normalizedUrl);
				if (apiKey) {
					headers.Authorization = `Bearer ${apiKey}`;
				}
				break;
			}
		}

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		let data: unknown;
		try {
			const response = await fetch(endpoint, {
				method: 'GET',
				signal: controller.signal,
				headers,
			});

			if (!response.ok) {
				return {
					success: false,
					models: [],
					error: `Server returned ${response.status}: ${response.statusText}`,
				};
			}

			data = await response.json();
		} finally {
			clearTimeout(timeoutId);
		}

		// Parse response based on API type
		const models = parseModelsResponse(data, apiCompatibility);

		if (models.length === 0) {
			return {
				success: false,
				models: [],
				error: 'No models found',
			};
		}

		models.sort((a, b) => a.name.localeCompare(b.name));

		return {success: true, models};
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			return {success: false, models: [], error: 'Connection timed out'};
		}
		return {
			success: false,
			models: [],
			error: formatError(err),
		};
	}
}

/**
 * Work out the `/models` URL for an OpenAI-compatible base URL. Most base
 * URLs end in an API version segment (`/v1`, `/v4`, `/v1beta`) and list
 * models directly under it; a bare host (`http://localhost:8000`) gets `/v1`
 * added. GitHub Models serves its catalogue outside the inference path.
 */
export function resolveOpenAICompatibleModelsEndpoint(baseUrl: string): string {
	const url = baseUrl.trim().replace(/\/+$/, '');

	if (/^https?:\/\/models\.github\.ai(\/|$)/i.test(url)) {
		return 'https://models.github.ai/catalog/models';
	}

	const versionSegment = /\/v\d+(?:alpha|beta)?\d*(?=\/|$)/i;
	const match = versionSegment.exec(url);
	if (match) {
		return `${url.slice(0, match.index + match[0].length)}/models`;
	}

	return `${url}/v1/models`;
}

function parseModelsResponse(
	data: unknown,
	apiCompatibility: ApiCompatibility,
): FetchedModel[] {
	if (!data || typeof data !== 'object') return [];

	if (apiCompatibility === 'ollama') {
		const d = data as {models?: Array<{name?: string}>};
		if (!Array.isArray(d.models)) return [];
		return d.models
			.filter(
				(m): m is {name: string} =>
					!!m && typeof m.name === 'string' && !!m.name.trim(),
			)
			.map(m => ({id: m.name.trim(), name: m.name.trim()}));
	}

	if (apiCompatibility === 'google') {
		const d = data as {
			models?: Array<{name?: string; displayName?: string}>;
		};
		if (!Array.isArray(d.models)) return [];
		return d.models
			.filter(
				(m): m is {name: string; displayName?: string} =>
					!!m && typeof m.name === 'string' && !!m.name.trim(),
			)
			.map(m => {
				// Google returns "models/gemini-2.0-flash" — strip the prefix
				const id = m.name.replace(/^models\//, '').trim();
				return {id, name: m.displayName || id};
			});
	}

	// GitHub Models' catalogue is a bare array of { id, name }.
	if (Array.isArray(data)) {
		return parseIdNameList(data);
	}

	// OpenAI-compatible and Anthropic both return { data: [{ id, ... }] }
	const d = data as {
		data?: Array<{id?: string; name?: string; display_name?: string}>;
	};
	if (!Array.isArray(d.data)) return [];
	return parseIdNameList(d.data);
}

function parseIdNameList(
	list: Array<{id?: string; name?: string; display_name?: string}>,
): FetchedModel[] {
	return list
		.filter(
			(m): m is {id: string; name?: string; display_name?: string} =>
				!!m && typeof m.id === 'string' && !!m.id.trim(),
		)
		.map(m => ({
			id: m.id.trim(),
			name: m.display_name || m.name || m.id.trim(),
		}));
}
