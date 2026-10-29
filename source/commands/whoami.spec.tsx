import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import type {AIProviderConfig} from '../types/index.js';
import {lazyCommands} from './lazy-registry';
import {
	collectWhoami,
	maskApiKey,
	Whoami,
	whoamiCommand,
} from './whoami';

console.log('\nwhoami.spec.tsx');

const LONG_KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef';

function provider(
	name: string,
	config: AIProviderConfig['config'],
	extra: Partial<AIProviderConfig> = {},
): AIProviderConfig {
	return {name, type: 'openai', models: ['m'], config, ...extra};
}

test('maskApiKey keeps the start and end and hides the middle', t => {
	const masked = maskApiKey(LONG_KEY);
	t.is(masked, 'sk-...cdef');
	t.false(masked.includes('0123456789'));
});

test('maskApiKey hides a short key entirely', t => {
	t.is(maskApiKey('ollama'), '********');
	t.is(maskApiKey('x'.repeat(19)), '********');
	t.not(maskApiKey('x'.repeat(20)), '********');
});

test('collectWhoami reports the active provider with a masked key', t => {
	const info = collectWhoami('OpenRouter', 'claude', [
		provider('Ollama', {baseURL: 'http://localhost:11434/v1'}),
		provider('OpenRouter', {
			baseURL: 'https://openrouter.ai/api/v1',
			apiKey: LONG_KEY,
		}),
	]);
	t.deepEqual(info, {
		provider: 'OpenRouter',
		model: 'claude',
		baseURL: 'https://openrouter.ai/api/v1',
		apiKey: 'sk-...cdef',
	});
});

test('collectWhoami strips credentials embedded in the base URL', t => {
	const info = collectWhoami('Proxy', 'm', [
		provider('Proxy', {baseURL: 'https://user:hunter2@proxy.example/v1'}),
	]);
	t.is(info.baseURL, 'https://proxy.example/v1');
});

test('collectWhoami reports a missing key instead of the placeholder', t => {
	// loadProviderConfigs fills in "dummy-key" when a provider has no key.
	const info = collectWhoami('Ollama', 'llama3', [
		provider('Ollama', {apiKey: 'dummy-key'}),
	]);
	t.is(info.apiKey, 'not set');
	t.is(info.baseURL, 'provider default');
});

test('collectWhoami names OAuth providers instead of showing a key', t => {
	for (const sdkProvider of ['chatgpt-codex', 'github-copilot'] as const) {
		const info = collectWhoami('P', 'm', [
			provider('P', {apiKey: LONG_KEY}, {sdkProvider}),
		]);
		t.is(info.apiKey, 'OAuth login (no API key)');
	}
});

test('collectWhoami copes with a provider that is not in the config', t => {
	const info = collectWhoami('Gone', 'm', []);
	t.is(info.provider, 'Gone');
	t.is(info.apiKey, 'unknown (provider not found in config)');
	t.is(collectWhoami('', '', []).provider, 'none');
});

test('Whoami renders the details and never the raw key', t => {
	const info = collectWhoami('OpenRouter', 'claude', [
		provider('OpenRouter', {
			baseURL: 'https://openrouter.ai/api/v1',
			apiKey: LONG_KEY,
		}),
	]);
	const {lastFrame} = renderWithTheme(<Whoami info={info} />);
	const output = lastFrame() ?? '';
	t.regex(output, /\/whoami/);
	t.regex(output, /OpenRouter/);
	t.regex(output, /claude/);
	t.regex(output, /https:\/\/openrouter\.ai\/api\/v1/);
	t.regex(output, /sk-\.\.\.cdef/);
	t.false(output.includes(LONG_KEY));
	t.false(output.includes('0123456789'));
});

test('whoami handler returns an element and is registered with a matching description', async t => {
	const element = await whoamiCommand.handler([], [], {
		provider: 'Nope',
		model: 'm',
		tokens: 0,
		getMessageTokens: () => 0,
	});
	t.true(React.isValidElement(element));

	const registered = lazyCommands.find(c => c.name === 'whoami');
	t.is(registered?.description, whoamiCommand.description);
});
