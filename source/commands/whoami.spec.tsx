import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import {describeCredentials, maskApiKey, Whoami} from './whoami';
import type {AIProviderConfig} from '@/types/config';

console.log('\nwhoami.spec.tsx');

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal styling before text-only assertions.
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (value: string) => value.replace(ANSI_RE, '');

// Test fixture shaped like the fixtures in redaction.spec.ts; never a real key.
const TEST_KEY = 'sk-test-key-value-do-not-use';

function makeProvider(
	overrides: Partial<AIProviderConfig> = {},
): AIProviderConfig {
	return {
		name: 'OpenRouter',
		type: 'openai',
		models: ['anthropic/claude-sonnet-4'],
		config: {
			baseURL: 'https://openrouter.ai/api/v1',
			apiKey: TEST_KEY,
		},
		...overrides,
	} as AIProviderConfig;
}

test('maskApiKey hides the middle and does not disclose length', t => {
	// Boundary lengths: at and just above the fixed threshold everything
	// collapses to the same fixed-width mask.
	t.is(maskApiKey('sk-1234567890abcdef'), 'sk-1...cdef');
	t.is(maskApiKey('123456789'), '********');
	t.is(maskApiKey('123456789012'), '********');
	t.is(maskApiKey(), 'Not set');
	t.is(maskApiKey('dummy-key'), 'Not set');
});

test('maskApiKey never emits the raw key', t => {
	const masked = maskApiKey(TEST_KEY);
	t.false(masked.includes('test-key-value'));
	t.not(masked, TEST_KEY);
});

test('Whoami render never shows the raw API key', async t => {
	const {lastFrame} = renderWithTheme(
		<Whoami
			provider="OpenRouter"
			model="anthropic/claude-sonnet-4"
			baseURL="https://openrouter.ai/api/v1"
			credentials={maskApiKey(TEST_KEY)}
		/>,
	);
	const output = stripAnsi(lastFrame()!);
	t.true(output.includes('Active Configuration'));
	t.true(output.includes('Provider: OpenRouter'));
	t.true(output.includes('Model: anthropic/claude-sonnet-4'));
	t.false(output.includes('test-key-value'));
});

test('Whoami render shows the local-provider credentials line', async t => {
	const {lastFrame} = renderWithTheme(
		<Whoami
			provider="Ollama"
			model="llama3"
			credentials="Not required (local)"
		/>,
	);
	const output = stripAnsi(lastFrame()!);
	t.true(output.includes('Not required (local)'));
	t.false(output.includes('API Key: Not set'));
});

test('describeCredentials branches per provider kind', t => {
	const hosted = describeCredentials(
		makeProvider({
			config: {baseURL: 'https://openrouter.ai/api/v1', apiKey: TEST_KEY},
		}),
	);
	t.false(hosted.includes('test-key-value'));

	const local = describeCredentials(
		makeProvider({
			name: 'Ollama',
			config: {baseURL: 'http://localhost:11434/v1', apiKey: undefined},
		}),
	);
	t.is(local, 'Not required (local)');
});
