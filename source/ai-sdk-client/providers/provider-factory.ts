import {type AnthropicProvider, createAnthropic} from '@ai-sdk/anthropic';
import {
	createGoogleGenerativeAI,
	type GoogleGenerativeAIProvider,
} from '@ai-sdk/google';
import {
	createOpenAICompatible,
	type OpenAICompatibleProvider,
} from '@ai-sdk/openai-compatible';
import {type Agent, fetch as undiciFetch} from 'undici';
import type {AIProviderConfig} from '@/types/index';
import {getLogger} from '@/utils/logging';

// Union type for supported providers
export type AIProvider =
	| OpenAICompatibleProvider<string, string, string, string>
	| GoogleGenerativeAIProvider
	| AnthropicProvider;

/**
 * Creates an AI SDK provider based on the sdkProvider configuration.
 * Defaults to 'openai-compatible' if not specified.
 */
export function createProvider(
	providerConfig: AIProviderConfig,
	undiciAgent: Agent,
): AIProvider {
	const logger = getLogger();
	const {config, sdkProvider} = providerConfig;

	// Use explicit sdkProvider if set, otherwise default to 'openai-compatible'
	if (sdkProvider === 'anthropic') {
		logger.info('Using @ai-sdk/anthropic provider', {
			provider: providerConfig.name,
			sdkProvider,
		});

		return createAnthropic({
			baseURL: config.baseURL || undefined,
			apiKey: config.apiKey ?? '',
			headers: config.headers,
		});
	}

	if (sdkProvider === 'google') {
		logger.info('Using @ai-sdk/google provider', {
			provider: providerConfig.name,
			sdkProvider,
		});

		return createGoogleGenerativeAI({
			apiKey: config.apiKey ?? '',
		});
	}

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
