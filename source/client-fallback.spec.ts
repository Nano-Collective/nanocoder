import test from 'ava';
import {APICallError, RetryError} from 'ai';
import {
	buildFallbackNotice,
	FallbackLLMClient,
	isRetryableProviderError,
	parseFallbackEntry,
} from './client-fallback';
import type {AIProviderConfig} from '@/types/config';
import type {
	LLMChatResponse,
	LLMClient,
	Message,
	StreamCallbacks,
} from '@/types/index';

function apiError(statusCode: number): APICallError {
	return new APICallError({
		message: `HTTP ${statusCode}`,
		url: 'https://example.com/v1/chat/completions',
		requestBodyValues: {},
		statusCode,
	});
}

function response(content: string): LLMChatResponse {
	return {
		choices: [{message: {role: 'assistant', content}}],
	};
}

interface FakeClientOptions {
	name: string;
	model?: string;
	/** Errors (or responses) served in order, one per chat() call. */
	script: Array<Error | LLMChatResponse>;
}

function fakeClient({name, model = 'test-model', script}: FakeClientOptions) {
	let calls = 0;
	const client: LLMClient & {calls: () => number} = {
		calls: () => calls,
		getCurrentModel: () => model,
		setModel: () => {},
		getContextSize: () => 0,
		getAvailableModels: async () => [model],
		getProviderConfig: (): AIProviderConfig => ({
			name,
			type: 'openai',
			models: [model],
			config: {},
		}),
		clearContext: async () => {},
		getTimeout: () => undefined,
		chat: async () => {
			const next = script[calls] ?? script[script.length - 1];
			calls++;
			if (next instanceof Error) throw next;
			return next as LLMChatResponse;
		},
	};
	return client;
}

const messages: Message[] = [{role: 'user', content: 'Hello'}];

// ===========================================================================
// parseFallbackEntry
// ===========================================================================

test('parseFallbackEntry accepts a bare provider name', t => {
	t.deepEqual(parseFallbackEntry('openrouter'), {provider: 'openrouter'});
});

test('parseFallbackEntry accepts a provider/model pair', t => {
	t.deepEqual(parseFallbackEntry('ollama/llama3.1:8b'), {
		provider: 'ollama',
		model: 'llama3.1:8b',
	});
});

test('parseFallbackEntry trims surrounding whitespace', t => {
	t.deepEqual(parseFallbackEntry('  openrouter/gpt-4o  '), {
		provider: 'openrouter',
		model: 'gpt-4o',
	});
});

test('parseFallbackEntry rejects empty and malformed entries', t => {
	t.is(parseFallbackEntry(''), null);
	t.is(parseFallbackEntry('   '), null);
	t.is(parseFallbackEntry('/gpt-4o'), null);
	t.is(parseFallbackEntry('openrouter/'), null);
});

// ===========================================================================
// isRetryableProviderError
// ===========================================================================

test('isRetryableProviderError: 429 and 5xx APICallErrors are retryable', t => {
	t.true(isRetryableProviderError(apiError(429)));
	t.true(isRetryableProviderError(apiError(500)));
	t.true(isRetryableProviderError(apiError(502)));
	t.true(isRetryableProviderError(apiError(503)));
	t.true(isRetryableProviderError(apiError(504)));
});

test('isRetryableProviderError: 4xx APICallErrors are not retryable', t => {
	t.false(isRetryableProviderError(apiError(400)));
	t.false(isRetryableProviderError(apiError(401)));
	t.false(isRetryableProviderError(apiError(403)));
	t.false(isRetryableProviderError(apiError(404)));
});

test('isRetryableProviderError: unwraps RetryError to the last error', t => {
	const wrapped = new RetryError({
		message: 'Failed after 3 attempts',
		reason: 'maxRetriesExceeded',
		errors: [apiError(429)],
	});
	t.true(isRetryableProviderError(wrapped));

	const authWrapped = new RetryError({
		message: 'Failed after 3 attempts',
		reason: 'maxRetriesExceeded',
		errors: [apiError(401)],
	});
	t.false(isRetryableProviderError(authWrapped));
});

test('isRetryableProviderError: parsed user-facing messages from parseAPIError', t => {
	// Retryable: the strings handleChat throws after its own retries.
	t.true(
		isRetryableProviderError(
			new Error('Rate limit exceeded: Too many requests. Please wait and try again'),
		),
	);
	t.true(isRetryableProviderError(new Error('Server error: Bad gateway')));
	t.true(
		isRetryableProviderError(
			new Error(
				'Connection failed: Could not reach provider "ollama" (ECONNREFUSED). Check baseUrl in your provider configuration.',
			),
		),
	);
	t.true(
		isRetryableProviderError(
			new Error('Request timed out: The model took too long to respond'),
		),
	);
	t.true(isRetryableProviderError(new Error('Request failed (429): slow down')));
	t.true(isRetryableProviderError(new Error('Request failed (504): timeout')));
	t.true(isRetryableProviderError(new TypeError('Failed to fetch')));

	// Non-retryable: auth, invalid request, context errors, cancellation.
	t.false(
		isRetryableProviderError(
			new Error('Authentication failed: Invalid API key or credentials'),
		),
	);
	t.false(
		isRetryableProviderError(
			new Error('Access forbidden: Check your API permissions'),
		),
	);
	t.false(isRetryableProviderError(new Error('Bad request: bad input')));
	t.false(
		isRetryableProviderError(
			new Error('Model not found: The requested model may not exist'),
		),
	);
	t.false(
		isRetryableProviderError(
			new Error('Context too large: Please reduce the conversation length'),
		),
	);
	t.false(isRetryableProviderError(new Error('Operation was cancelled')));
	t.false(
		isRetryableProviderError(new Error('Tool "read_file" does not exist')),
	);
});

// ===========================================================================
// buildFallbackNotice
// ===========================================================================

test('buildFallbackNotice names the answering provider and model', t => {
	const notice = buildFallbackNotice('primary', {
		provider: 'openrouter',
		model: 'gpt-4o',
	});
	t.true(notice.includes('"openrouter"'));
	t.true(notice.includes('gpt-4o'));
	t.true(notice.includes('"primary"'));
});

// ===========================================================================
// FallbackLLMClient
// ===========================================================================

test('FallbackLLMClient: primary success never touches a fallback', async t => {
	const primary = fakeClient({
		name: 'primary',
		script: [response('from primary')],
	});
	const factoryCalls: Array<{provider: string; model?: string}> = [];
	const client = new FallbackLLMClient(
		primary,
		['openrouter'],
		async (provider, model) => {
			factoryCalls.push({provider, model});
			return fakeClient({name: provider, script: [response('from fallback')]});
		},
	);
	const notices: string[] = [];
	const callbacks: StreamCallbacks = {
		onNotice: message => {
			notices.push(message);
		},
	};

	const result = await client.chat(messages, {}, callbacks);

	t.is(result.choices[0].message.content, 'from primary');
	t.is(result.fallbackProvider, undefined);
	t.deepEqual(factoryCalls, []);
	t.deepEqual(notices, []);
	t.is(primary.calls(), 1);
});

test('FallbackLLMClient: retryable primary failure falls back and names the provider that answered', async t => {
	const primary = fakeClient({
		name: 'primary',
		script: [new Error('Rate limit exceeded: Too many requests.')],
	});
	const fallback = fakeClient({
		name: 'openrouter',
		script: [response('from fallback')],
	});
	const factoryCalls: Array<{provider: string; model?: string}> = [];
	const client = new FallbackLLMClient(
		primary,
		['openrouter'],
		async (provider, model) => {
			factoryCalls.push({provider, model});
			return fallback;
		},
	);
	const notices: string[] = [];

	const result = await client.chat(messages, {}, {
		onNotice: message => {
			notices.push(message);
		},
	});

	t.is(result.choices[0].message.content, 'from fallback');
	t.is(result.fallbackProvider, 'openrouter');
	t.is(result.fallbackModel, 'test-model');
	t.deepEqual(factoryCalls, [{provider: 'openrouter', model: undefined}]);
	t.is(notices.length, 1);
	t.true(notices[0].includes('"openrouter"'));
	t.is(primary.calls(), 1);
});

test('FallbackLLMClient: provider/model entry passes the model through', async t => {
	const primary = fakeClient({
		name: 'primary',
		script: [new Error('Server error: Bad gateway')],
	});
	const fallback = fakeClient({
		name: 'ollama',
		model: 'llama3.1:8b',
		script: [response('from ollama')],
	});
	let seenModel: string | undefined;
	const client = new FallbackLLMClient(
		primary,
		['ollama/llama3.1:8b'],
		async (provider, model) => {
			seenModel = model;
			return fallback;
		},
	);

	const result = await client.chat(messages, {}, {});

	t.is(result.fallbackProvider, 'ollama');
	t.is(result.fallbackModel, 'llama3.1:8b');
	t.is(seenModel, 'llama3.1:8b');
});

test('FallbackLLMClient: auth errors never trigger a fallback', async t => {
	const primary = fakeClient({
		name: 'primary',
		script: [new Error('Authentication failed: Invalid API key')],
	});
	let factoryCalled = false;
	const client = new FallbackLLMClient(primary, ['openrouter'], async () => {
		factoryCalled = true;
		return fakeClient({name: 'openrouter', script: [response('nope')]});
	});

	await t.throwsAsync(client.chat(messages, {}, {}), {
		message: 'Authentication failed: Invalid API key',
	});
	t.false(factoryCalled);
});

test('FallbackLLMClient: tries each fallback in order and throws when all fail', async t => {
	const primary = fakeClient({
		name: 'primary',
		script: [new Error('Rate limit exceeded')],
	});
	const first = fakeClient({
		name: 'openrouter',
		script: [new Error('Server error: down')],
	});
	const second = fakeClient({
		name: 'ollama',
		script: [new Error('Connection failed: Could not reach provider')],
	});
	const tried: string[] = [];
	const client = new FallbackLLMClient(
		primary,
		['openrouter', 'ollama'],
		async provider => {
			tried.push(provider);
			return provider === 'openrouter' ? first : second;
		},
	);

	await t.throwsAsync(client.chat(messages, {}, {}), {
		message: 'Connection failed: Could not reach provider',
	});
	t.deepEqual(tried, ['openrouter', 'ollama']);
});

test('FallbackLLMClient: a non-retryable fallback error stops the chain', async t => {
	const primary = fakeClient({
		name: 'primary',
		script: [new Error('Rate limit exceeded')],
	});
	const first = fakeClient({
		name: 'openrouter',
		script: [new Error('Authentication failed: bad key')],
	});
	let triedSecond = false;
	const client = new FallbackLLMClient(
		primary,
		['openrouter', 'ollama'],
		async provider => {
			if (provider === 'ollama') triedSecond = true;
			return first;
		},
	);

	await t.throwsAsync(client.chat(messages, {}, {}), {
		message: 'Authentication failed: bad key',
	});
	t.false(triedSecond);
});

test('FallbackLLMClient: an unbuildable fallback is skipped, the next one answers', async t => {
	const primary = fakeClient({
		name: 'primary',
		script: [new Error('Rate limit exceeded')],
	});
	const second = fakeClient({
		name: 'ollama',
		script: [response('from ollama')],
	});
	const client = new FallbackLLMClient(
		primary,
		['openrouter', 'ollama'],
		async provider => {
			if (provider === 'openrouter') {
				throw new Error('API key required for hosted providers');
			}
			return second;
		},
	);

	const result = await client.chat(messages, {}, {});
	t.is(result.fallbackProvider, 'ollama');
});

test('FallbackLLMClient: primary stays selected — the next turn tries it first', async t => {
	const primary = fakeClient({
		name: 'primary',
		script: [
			new Error('Rate limit exceeded'),
			response('primary recovered'),
		],
	});
	const client = new FallbackLLMClient(primary, ['openrouter'], async () => {
		// The factory is only reached while the primary is failing; a fresh
		// client per attempt means the fallback's own script replays.
		return fakeClient({name: 'openrouter', script: [response('from fallback')]});
	});

	const first = await client.chat(messages, {}, {});
	t.is(first.fallbackProvider, 'openrouter');

	const second = await client.chat(messages, {}, {});
	t.is(second.choices[0].message.content, 'primary recovered');
	t.is(second.fallbackProvider, undefined);
	t.is(primary.calls(), 2);
});

test('FallbackLLMClient: entries naming the primary or a duplicate are skipped', async t => {
	const primary = fakeClient({
		name: 'primary',
		script: [new Error('Rate limit exceeded')],
	});
	const fallback = fakeClient({
		name: 'openrouter',
		script: [response('from fallback')],
	});
	const tried: string[] = [];
	const client = new FallbackLLMClient(
		primary,
		['primary', 'openrouter', 'OPENROUTER', 'openrouter/gpt-4o'],
		async provider => {
			tried.push(provider);
			return fallback;
		},
	);

	const result = await client.chat(messages, {}, {});
	t.is(result.fallbackProvider, 'openrouter');
	t.deepEqual(tried, ['openrouter']);
});

test('FallbackLLMClient: an aborted request never falls back', async t => {
	const primary = fakeClient({
		name: 'primary',
		script: [new Error('Rate limit exceeded')],
	});
	let factoryCalled = false;
	const client = new FallbackLLMClient(primary, ['openrouter'], async () => {
		factoryCalled = true;
		return fakeClient({name: 'openrouter', script: [response('nope')]});
	});
	const controller = new AbortController();
	controller.abort();

	await t.throwsAsync(
		client.chat(messages, {}, {}, controller.signal),
		{message: 'Rate limit exceeded'},
	);
	t.false(factoryCalled);
});

test('FallbackLLMClient: delegates provider identity to the primary', t => {
	const primary = fakeClient({name: 'primary', script: [response('hi')]});
	const client = new FallbackLLMClient(primary, ['openrouter'], async () => {
		throw new Error('unreachable');
	});

	t.is(client.getCurrentModel(), 'test-model');
	t.is(client.getProviderConfig().name, 'primary');
});
