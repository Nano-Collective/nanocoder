import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import {type Agent, fetch as undiciFetch} from 'undici';
import type {AIProviderConfig} from '@/types/index';

/**
 * Creates an OpenAI-compatible provider with custom fetch using undici
 */
export function createProvider(
	providerConfig: AIProviderConfig,
	undiciAgent: Agent,
): ReturnType<typeof createOpenAICompatible> {
	const {config} = providerConfig;

	// Custom fetch using undici
	const customFetch = (
		url: string | URL | Request,
		options?: RequestInit,
	): Promise<Response> => {
		// Type cast to string | URL since undici's fetch accepts these types
		// Request objects are converted to URL internally by the fetch spec
		return undiciFetch(url as string | URL, {
			...options,
			dispatcher: undiciAgent,
		}) as Promise<Response>;
	};

	// Add OpenRouter-specific headers for app attribution
	const headers: Record<string, string> = config.headers ?? {};
	if (providerConfig.name.toLowerCase() === 'openrouter') {
		headers['HTTP-Referer'] = 'https://github.com/Nano-Collective/nanocoder';
		headers['X-Title'] = 'Nanocoder';
	}

	return createOpenAICompatible({
		name: providerConfig.name,
		baseURL: config.baseURL ?? '',
		apiKey: config.apiKey ?? 'dummy-key',
		fetch: customFetch,
		headers,
	});
}
