import test from 'ava';
import {
	fetchModels,
	resolveOpenAICompatibleModelsEndpoint,
} from './fetch-models.js';

test('fetchModels returns HTTP status and applies provider headers', async t => {
	const originalFetch = globalThis.fetch;
	let requestHeaders: Headers | undefined;
	globalThis.fetch = async (_input, init) => {
		requestHeaders = new Headers(init?.headers);
		return new Response(JSON.stringify({data: [{id: 'gpt-test'}]}), {
			status: 200,
			statusText: 'OK',
			headers: {'content-type': 'application/json'},
		});
	};
	try {
		const result = await fetchModels(
			'https://provider.example/v1',
			'openai-compatible',
			'test-key',
			{headers: {'X-Tenant': 'tenant-1'}},
		);
		t.deepEqual(result, {
			success: true,
			statusCode: 200,
			models: [{id: 'gpt-test', name: 'gpt-test'}],
		});
		t.is(requestHeaders?.get('Authorization'), 'Bearer test-key');
		t.is(requestHeaders?.get('X-Tenant'), 'tenant-1');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('fetchModels exposes auth rejection status without parsing an error body', async t => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () =>
		new Response('do not surface provider response body', {
			status: 403,
			statusText: 'Forbidden',
		});
	try {
		const result = await fetchModels(
			'https://provider.example/v1',
			'openai-compatible',
			'test-key',
		);
		t.is(result.statusCode, 403);
		t.notRegex(result.error ?? '', /do not surface/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('fetchModels keeps successful HTTP status when the body is malformed', async t => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () =>
		new Response('not json', {
			status: 200,
			headers: {'content-type': 'application/json'},
		});
	try {
		const result = await fetchModels(
			'https://provider.example/v1',
			'openai-compatible',
			'test-key',
		);
		t.is(result.statusCode, 200);
		t.is(result.success, false);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('appends /models to a /v1 base URL', t => {
	t.is(
		resolveOpenAICompatibleModelsEndpoint('https://openrouter.ai/api/v1'),
		'https://openrouter.ai/api/v1/models',
	);
});

test('keeps non-v1 version segments (z.ai /v4)', t => {
	t.is(
		resolveOpenAICompatibleModelsEndpoint('https://api.z.ai/api/paas/v4/'),
		'https://api.z.ai/api/paas/v4/models',
	);
	t.is(
		resolveOpenAICompatibleModelsEndpoint(
			'https://api.z.ai/api/coding/paas/v4/',
		),
		'https://api.z.ai/api/coding/paas/v4/models',
	);
});

test('truncates a path after the version segment', t => {
	t.is(
		resolveOpenAICompatibleModelsEndpoint(
			'http://localhost:8000/v1/chat/completions',
		),
		'http://localhost:8000/v1/models',
	);
});

test('adds /v1 to a bare host', t => {
	t.is(
		resolveOpenAICompatibleModelsEndpoint('http://localhost:8000'),
		'http://localhost:8000/v1/models',
	);
});

test('uses the GitHub Models catalogue endpoint', t => {
	t.is(
		resolveOpenAICompatibleModelsEndpoint('https://models.github.ai/inference'),
		'https://models.github.ai/catalog/models',
	);
});

