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
import {
	COPILOT_HEADERS,
	getCopilotAccessToken,
	getCopilotBaseUrl,
} from '@/auth/github-copilot';
import {
	getCopilotNoCredentialsMessage,
	loadCopilotCredential,
} from '@/config/copilot-credentials';
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

	if (sdkProvider === 'github-copilot') {
		logger.info('Using GitHub Copilot subscription provider', {
			provider: providerConfig.name,
		});

		const credential = loadCopilotCredential(providerConfig.name);
		if (!credential) {
			throw new Error(getCopilotNoCredentialsMessage(providerConfig.name));
		}

		const domain = credential.enterpriseUrl ?? 'github.com';
		const baseURL = config.baseURL?.trim() || getCopilotBaseUrl(domain);

		const copilotFetch = async (
			input: string | URL | Request,
			init?: RequestInit,
		): Promise<Response> => {
			const {token} = await getCopilotAccessToken(
				credential.oauthToken,
				domain,
			);
			const headers = new Headers(init?.headers);
			headers.set('Authorization', `Bearer ${token}`);
			headers.set('Openai-Intent', 'conversation-edits');
			headers.set('X-Initiator', 'agent');
			for (const [k, v] of Object.entries(COPILOT_HEADERS)) {
				headers.set(k, v);
			}
			return undiciFetch(input as string | URL, {
				...init,
				headers,
				dispatcher: undiciAgent,
			}) as Promise<Response>;
		};

		return createOpenAICompatible({
			name: providerConfig.name,
			baseURL,
			// Non-empty placeholder; auth is via custom fetch Authorization header
			apiKey: 'dummy-key',
			fetch: copilotFetch,
			headers: config.headers ?? {},
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
