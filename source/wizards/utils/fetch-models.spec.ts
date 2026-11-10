import test from 'ava';
import {
	fetchModels,
	resolveOpenAICompatibleModelsEndpoint,
} from './fetch-models.js';

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

test('keeps the /compat path for the Opper models endpoint', t => {
	t.is(
		resolveOpenAICompatibleModelsEndpoint('https://api.opper.ai/v3/compat'),
		'https://api.opper.ai/v3/compat/models',
	);
});

test.serial('fetchModels surfaces OpenLLM unsigned-in 401 hint', async t => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () =>
		new Response(
			JSON.stringify({
				error: {
					message:
						'[openllm] API key required.\nRun `openllm login` in a terminal to sign in through the browser (https://www.openllm.sh/sign-in), or `openllm login --api-key` to paste a key.\n',
					type: 'auth_error',
				},
			}),
			{status: 401, statusText: 'Unauthorized'},
		)) as typeof fetch;

	try {
		const result = await fetchModels(
			'http://127.0.0.1:8787/v1',
			'openai-compatible',
		);
		t.false(result.success);
		t.is(
			result.error,
			'OpenLLM is not signed in. Run `openllm login` in a terminal, then try again.',
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchModels keeps generic 401 message for other providers', async t => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () =>
		new Response(JSON.stringify({error: {message: 'Invalid API key'}}), {
			status: 401,
			statusText: 'Unauthorized',
		})) as typeof fetch;

	try {
		const result = await fetchModels(
			'https://api.openai.com/v1',
			'openai-compatible',
			'sk-test',
		);
		t.false(result.success);
		t.is(result.error, 'Server returned 401: Unauthorized');
	} finally {
		globalThis.fetch = originalFetch;
	}
});


test.serial('fetchModels gives an OpenLLM hint when the daemon refuses the connection', async t => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		throw new TypeError('fetch failed', {
			cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8787'), {
				code: 'ECONNREFUSED',
			}),
		});
	}) as typeof fetch;

	try {
		const result = await fetchModels(
			'http://127.0.0.1:8787/v1',
			'openai-compatible',
		);
		t.false(result.success);
		t.true(result.error?.startsWith('OpenLLM is not'));
	} finally {
		globalThis.fetch = originalFetch;
	}
});
