import test from 'ava';
import {resolveStartupProvider} from './startup-provider';

test('stale saved provider falls back to undefined with staleName set', t => {
	const result = resolveStartupProvider(
		undefined,
		undefined,
		'ghost-provider',
		['openai', 'anthropic'],
	);

	t.deepEqual(result, {provider: undefined, staleName: 'ghost-provider'});
});

test('valid saved provider passes through unchanged', t => {
	const result = resolveStartupProvider(undefined, undefined, 'openai', [
		'openai',
		'anthropic',
	]);

	t.deepEqual(result, {provider: 'openai'});
});

test('cliProvider is strict passthrough even when unknown', t => {
	const result = resolveStartupProvider(
		'totally-unknown',
		undefined,
		'openai',
		['openai', 'anthropic'],
	);

	t.deepEqual(result, {provider: 'totally-unknown'});
});

test('cliProvider takes precedence over modeProvider and lastProvider', t => {
	const result = resolveStartupProvider('cli-provider', 'mode-provider', 'last-provider', [
		'cli-provider',
		'mode-provider',
		'last-provider',
	]);

	t.deepEqual(result, {provider: 'cli-provider'});
});

test('modeProvider takes precedence over lastProvider when no cliProvider', t => {
	const result = resolveStartupProvider(undefined, 'mode-provider', 'last-provider', [
		'mode-provider',
		'last-provider',
	]);

	t.deepEqual(result, {provider: 'mode-provider'});
});

test('match is case-insensitive', t => {
	const result = resolveStartupProvider(undefined, undefined, 'OpenAI', [
		'openai',
	]);

	t.deepEqual(result, {provider: 'OpenAI'});
});

test('stale mode provider (not cli) also falls back with staleName set', t => {
	const result = resolveStartupProvider(undefined, 'stale-mode', 'openai', [
		'openai',
	]);

	t.deepEqual(result, {provider: undefined, staleName: 'stale-mode'});
});

test('no configured providers and a saved provider is always stale', t => {
	const result = resolveStartupProvider(undefined, undefined, 'openai', []);

	t.deepEqual(result, {provider: undefined, staleName: 'openai'});
});

test('no provider anywhere resolves to undefined with no staleName', t => {
	const result = resolveStartupProvider(undefined, undefined, undefined, [
		'openai',
	]);

	t.deepEqual(result, {provider: undefined});
});
