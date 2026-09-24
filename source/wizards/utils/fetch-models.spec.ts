import test from 'ava';
import {resolveOpenAICompatibleModelsEndpoint} from './fetch-models.js';

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
