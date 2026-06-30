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
import {isOpenRouterProvider} from './openrouter.js';
import {isRequestyProvider} from './requesty.js';

/**
 * Discriminated union pairing each underlying SDK provider with its `kind`.
 * Lets callers narrow the provider type via `kind` without `as unknown as`
 * casts. The pairing is enforced by `createProvider`'s return value.
 */
export type TaggedProvider =
	| {kind: 'chatgpt-codex'; provider: OpenAIProvider}
	| {kind: 'github-copilot'; provider: OpenAIProvider}
	| {
			kind: 'openai-compatible';
			provider: OpenAICompatibleProvider<string, string, string, string>;
	  }
	| {kind: 'anthropic'; provider: AnthropicProvider}
	| {kind: 'google'; provider: GoogleGenerativeAIProvider};

/**
 * Wraps undici's fetch so requests flow through the shared Agent. The Agent
 * carries TLS connect options (e.g. caCertPath), so any SDK provider given
 * this fetch will honor the configured CA bundle — even Anthropic and Google,
 * which would otherwise use the global fetch and bypass our TLS settings.
 */
export function createUndiciFetch(undiciAgent: Agent) {
	return async (
		url: string | URL | Request,
		options?: RequestInit,
	): Promise<Response> => {
		const response = await undiciFetch(url as string | URL, {
			...(options as UndiciRequestInit),
			dispatcher: undiciAgent,
		});

		const contentType = response.headers.get('content-type') || '';
		if (response.body && contentType.includes('text/event-stream')) {
			const decoder = new TextDecoder('utf-8');
			const encoder = new TextEncoder();
			let buffer = '';

			const transform = new TransformStream({
				transform(chunk, controller) {
					buffer += decoder.decode(chunk, {stream: true});

					if (buffer.includes('data:  [DONE]')) {
						buffer = buffer.replace(/data:\s\s\[DONE\]/g, 'data: [DONE]');
					}

					if (buffer.length > 13) {
						const toEnqueue = buffer.slice(0, -13);
						buffer = buffer.slice(-13);
						controller.enqueue(encoder.encode(toEnqueue));
					}
				},
				flush(controller) {
					buffer += decoder.decode();
					if (buffer.includes('data:  [DONE]')) {
						buffer = buffer.replace(/data:\s\s\[DONE\]/g, 'data: [DONE]');
					}
					if (buffer.length > 0) {
						controller.enqueue(encoder.encode(buffer));
					}
				},
			});

			return new Response(response.body.pipeThrough(transform), {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			}) as unknown as Response;
		}

		return response as unknown as Response;
	};
}

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
): Promise<TaggedProvider> {
	const logger = getLogger();
	const {config, sdkProvider} = providerConfig;

	// Use explicit sdkProvider if set, otherwise default to 'openai-compatible'
	if (sdkProvider === 'anthropic') {
		logger.info('Using @ai-sdk/anthropic provider', {
			provider: providerConfig.name,
			sdkProvider,
		});

		const {createAnthropic} = await import('@ai-sdk/anthropic');
		return {
			kind: 'anthropic',
			provider: createAnthropic({
				baseURL: config.baseURL || undefined,
				apiKey: config.apiKey ?? '',
				headers: config.headers,
				fetch: createUndiciFetch(undiciAgent),
			}),
		};
	}

	if (sdkProvider === 'google') {
		logger.info('Using @ai-sdk/google provider', {
			provider: providerConfig.name,
			sdkProvider,
		});

		const {createGoogleGenerativeAI} = await import('@ai-sdk/google');
		return {
			kind: 'google',
			provider: createGoogleGenerativeAI({
				apiKey: config.apiKey ?? '',
				fetch: createUndiciFetch(undiciAgent),
			}),
		};
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
		return {
			kind: 'github-copilot',
			provider: createOpenAI({
				baseURL,
				// Empty key — auth is handled entirely by copilotFetch's Authorization header
				apiKey: '',
				fetch: copilotFetch,
				headers: config.headers ?? {},
			}),
		};
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
		return {
			kind: 'chatgpt-codex',
			provider: createOpenAI({
				baseURL,
				apiKey: '',
				fetch: codexFetch,
				headers: config.headers ?? {},
			}),
		};
	}

	// Add OpenRouter-specific headers for app attribution
	const headers: Record<string, string> = config.headers ?? {};
	if (isOpenRouterProvider(providerConfig.name)) {
		headers['HTTP-Referer'] = 'https://github.com/Nano-Collective/nanocoder';
		headers['X-Title'] = 'Nanocoder';
	}

	// Requesty (https://requesty.ai) is an OpenAI-compatible router and uses
	// the same app-attribution headers as OpenRouter.
	if (isRequestyProvider(providerConfig.name)) {
		headers['HTTP-Referer'] = 'https://github.com/Nano-Collective/nanocoder';
		headers['X-Title'] = 'Nanocoder';
	}

	const {createOpenAICompatible} = await import('@ai-sdk/openai-compatible');
	return {
		kind: 'openai-compatible',
		provider: createOpenAICompatible({
			name: providerConfig.name,
			baseURL: config.baseURL ?? '',
			apiKey: config.apiKey ?? 'dummy-key',
			fetch: createUndiciFetch(undiciAgent),
			headers,
		}),
	};
}
