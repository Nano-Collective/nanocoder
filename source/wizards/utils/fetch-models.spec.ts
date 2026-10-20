import test from 'ava';
import {fetchModels, resolveOpenAICompatibleModelsEndpoint} from './fetch-models.js';

test.serial('wizard filters legacy MiniMax discovery and orders Flash before M3', async t => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(JSON.stringify({data: [
		{id: 'MiniMax-M2.7'},
		{id: 'MiniMax-M3'},
		{id: 'MiniMax-M3.1-Flash'},
		{id: 'speech-2.8-hd'},
	]}));
	try {
		const result = await fetchModels('https://api.minimax.io/anthropic/v1', 'anthropic', 'offline-test-key');
		t.true(result.success);
		t.deepEqual(result.models.map(model => model.id), ['MiniMax-M3.1-Flash', 'MiniMax-M3', 'speech-2.8-hd']);
		const custom = await fetchModels('https://custom.example/v1', 'openai-compatible');
		t.true(custom.models.some(model => model.id === 'MiniMax-M2.7'));
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('filtered discovery offers a useful manual-entry fallback', async t => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(JSON.stringify({data: [{id: 'MiniMax-M2.7'}]}));
	try {
		const result = await fetchModels('https://api.minimax.io/anthropic/v1', 'anthropic', 'offline-test-key');
		t.false(result.success);
		t.deepEqual(result.models, []);
		t.is(result.error, 'No current MiniMax text models found; enter a model ID manually');
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
