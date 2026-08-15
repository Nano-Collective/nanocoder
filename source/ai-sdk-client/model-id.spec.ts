import test from 'ava';
import {normalizeModelIdForRequest} from './model-id.js';

test('normalizes unqualified Atlas Cloud GPT-5.6 model IDs', t => {
	t.is(
		normalizeModelIdForRequest(
			'https://api.atlascloud.ai/v1',
			'gpt-5.6-sol',
		),
		'openai/gpt-5.6-sol',
	);

	t.is(
		normalizeModelIdForRequest(
			'https://api.atlascloud.ai/v1',
			'GPT-5.6-TERRA',
		),
		'openai/gpt-5.6-terra',
	);
});

test('preserves already-qualified Atlas Cloud and unrelated model IDs', t => {
	t.is(
		normalizeModelIdForRequest(
			'https://api.atlascloud.ai/v1',
			'openai/gpt-5.6-sol',
		),
		'openai/gpt-5.6-sol',
	);
	t.is(
		normalizeModelIdForRequest(
			'https://api.atlascloud.ai/v1',
			'deepseek-v3',
		),
		'deepseek-v3',
	);
	t.is(
		normalizeModelIdForRequest('https://api.openai.com/v1', 'gpt-5.6-sol'),
		'gpt-5.6-sol',
	);
});

test('does not throw for missing or malformed base URLs', t => {
	t.is(normalizeModelIdForRequest(undefined, 'gpt-5.6-sol'), 'gpt-5.6-sol');
	t.is(normalizeModelIdForRequest('not a URL', 'gpt-5.6-sol'), 'gpt-5.6-sol');
});
