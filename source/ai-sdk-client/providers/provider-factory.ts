// `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai`, and
// `@ai-sdk/openai-compatible` are loaded lazily inside `createProvider`.
// Importing them statically would load every provider SDK at startup even
// though only one provider is used per session. Types are erased at compile
// time via `import type`, so they cost nothing at runtime.
import type {AnthropicProvider} from '@ai-sdk/anthropic';
import type {GoogleGenerativeAIProvider} from '@ai-sdk/google';
import type {OpenAIProvider} from '@ai-sdk/openai';
import type {OpenAICompatibleProvider} from '@ai-sdk/openai-compatible';
import {
	type Agent,
	type RequestInit as UndiciRequestInit,
	fetch as undiciFetch,
} from 'undici';
import {getValidCodexToken} from '@/auth/chatgpt-codex';
import {
	COPILOT_HEADERS,
	getCopilotAccessToken,
	getCopilotBaseUrl,
} from '@/auth/github-copilot';
import {
	getCodexNoCredentialsMessage,
	loadCodexCredential,
	updateCodexCredential,
} from '@/config/codex-credentials';
import {
	getCopilotNoCredentialsMessage,
	loadCopilotCredential,
} from '@/config/copilot-credentials';
import type {AIProviderConfig} from '@/types/index';
import {getLogger} from '@/utils/logging';

// Union type for supported providers
export type AIProvider =
	| OpenAICompatibleProvider<string, string, string, string>
	| OpenAIProvider
	| GoogleGenerativeAIProvider
	| AnthropicProvider;

/**
 * Creates an AI SDK provider based on the sdkProvider configuration.
 * Defaults to 'openai-compatible' if not specified.
 *
 * Async because provider SDK packages are loaded lazily — only the one that
 * matches the caller's `sdkProvider` is imported, so a session that only
 * uses Anthropic never loads the Google or OpenAI packages.
 */
export async function createProvider(
	providerConfig: AIProviderConfig,
	undiciAgent: Agent,
): Promise<AIProvider> {
	const logger = getLogger();
	const {config, sdkProvider} = providerConfig;

	// Use explicit sdkProvider if set, otherwise default to 'openai-compatible'
	if (sdkProvider === 'anthropic') {
		logger.info('Using @ai-sdk/anthropic provider', {
			provider: providerConfig.name,
			sdkProvider,
		});

		const {createAnthropic} = await import('@ai-sdk/anthropic');
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

		const {createGoogleGenerativeAI} = await import('@ai-sdk/google');
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

			// Build headers via Headers (case-insensitive) to avoid
			// duplicate keys when merging SDK lowercase and Copilot mixed-case.
			const h = new Headers();
			if (init?.headers) {
				const src =
					init.headers instanceof Headers
						? init.headers
						: new Headers(
								init.headers as ConstructorParameters<typeof Headers>[0],
							);
				src.forEach((v, k) => {
					if (k !== 'authorization') {
						h.set(k, v);
					}
				});
			}
			for (const [k, v] of Object.entries(COPILOT_HEADERS)) {
				h.set(k, v);
			}
			h.set('Authorization', `Bearer ${token}`);
			h.set('Openai-Intent', 'conversation-edits');
			h.set('X-Initiator', 'agent');

			// Convert to plain object for undici
			const headers: Record<string, string> = {};
			h.forEach((v, k) => {
				headers[k] = v;
			});

			return undiciFetch(input as string | URL, {
				method: init?.method,
				body: init?.body as UndiciRequestInit['body'],
				signal: init?.signal,
				headers,
				dispatcher: undiciAgent,
			}) as Promise<Response>;
		};

		const {createOpenAI} = await import('@ai-sdk/openai');
		return createOpenAI({
			baseURL,
			// Empty key — auth is handled entirely by copilotFetch's Authorization header
			apiKey: '',
			fetch: copilotFetch,
			headers: config.headers ?? {},
		});
	}

	if (sdkProvider === 'chatgpt-codex') {
		logger.info('Using ChatGPT/Codex subscription provider', {
			provider: providerConfig.name,
		});

		const credential = loadCodexCredential(providerConfig.name);
		if (!credential) {
			throw new Error(getCodexNoCredentialsMessage(providerConfig.name));
		}

		const baseURL =
			config.baseURL?.trim() || 'https://chatgpt.com/backend-api/codex';

		const codexFetch = async (
			input: string | URL | Request,
			init?: RequestInit,
		): Promise<Response> => {
			// Get valid token (refreshing if needed)
			const {accessToken, accountId} = await getValidCodexToken(
				credential,
				tokens => {
					updateCodexCredential(providerConfig.name, tokens);
				},
			);

			const h = new Headers();
			if (init?.headers) {
				const src =
					init.headers instanceof Headers
						? init.headers
						: new Headers(
								init.headers as ConstructorParameters<typeof Headers>[0],
							);
				src.forEach((v, k) => {
					if (k !== 'authorization') {
						h.set(k, v);
					}
				});
			}
			h.set('Authorization', `Bearer ${accessToken}`);
			h.set('ChatGPT-Account-Id', accountId);
			h.set('originator', 'codex_cli_rs');

			// Convert to plain object for undici
			const headers: Record<string, string> = {};
			h.forEach((v, k) => {
				headers[k] = v;
			});

			// Codex backend requires store: false on every request.
			// Patch the JSON body to ensure the backend accepts it.
			let body = init?.body;
			if (body && typeof body === 'string') {
				try {
					const parsed = JSON.parse(body) as Record<string, unknown>;
					parsed.store = false;
					body = JSON.stringify(parsed);
				} catch {
					// Not JSON — pass through
				}
			}

			return undiciFetch(input as string | URL, {
				method: init?.method,
				body: body as UndiciRequestInit['body'],
				signal: init?.signal,
				headers,
				dispatcher: undiciAgent,
			}) as Promise<Response>;
		};

		const {createOpenAI} = await import('@ai-sdk/openai');
		return createOpenAI({
			baseURL,
			apiKey: '',
			fetch: codexFetch,
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
			...(options as UndiciRequestInit),
			dispatcher: undiciAgent,
		}) as Promise<Response>;
	};

	// Add OpenRouter-specific headers for app attribution
	const headers: Record<string, string> = config.headers ?? {};
	if (providerConfig.name.toLowerCase() === 'openrouter') {
		headers['HTTP-Referer'] = 'https://github.com/Nano-Collective/nanocoder';
		headers['X-Title'] = 'Nanocoder';
	}

	const {createOpenAICompatible} = await import('@ai-sdk/openai-compatible');
	return createOpenAICompatible({
		name: providerConfig.name,
		baseURL: config.baseURL ?? '',
		apiKey: config.apiKey ?? 'dummy-key',
		fetch: customFetch,
		headers,
	});
}
