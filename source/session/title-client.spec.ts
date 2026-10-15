import {mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {clearAppConfig} from '@/config/index';
import type {LLMClient} from '@/types/core';
import {resetTitleClientCache, resolveTitleClient} from './title-client.js';

console.log('\ntitle-client.spec.ts');

// getAppConfig() lazily loads from disk, so without this the test would read
// the developer's real config and fail for anyone who has titleModel set.
const testConfigDir = join(tmpdir(), `nanocoder-title-client-${Date.now()}`);
mkdirSync(testConfigDir, {recursive: true});
process.env.NANOCODER_CONFIG_DIR = testConfigDir;
process.chdir(testConfigDir);

// Session config is read from nanocoder-preferences.json under a `nanocoder`
// key, not from agents.config.json.
function writeSessionConfig(sessions: Record<string, unknown>): void {
	writeFileSync(
		join(testConfigDir, 'nanocoder-preferences.json'),
		JSON.stringify({nanocoder: {sessions}}),
	);
	clearAppConfig();
}

function fakeClient(label: string): LLMClient {
	return {
		getCurrentModel: () => label,
		setModel: () => {},
		getContextSize: () => 8192,
		getAvailableModels: async () => [label],
		getProviderConfig: () => ({name: 'fake'}),
		chat: async () => ({
			choices: [{message: {role: 'assistant', content: ''}}],
		}),
		clearContext: async () => {},
		getTimeout: () => undefined,
	} as unknown as LLMClient;
}

test.beforeEach(() => {
	resetTitleClientCache();
	writeSessionConfig({});
});

test('returns the session client when no override is configured', async t => {
	const session = fakeClient('session-model');
	const resolved = await resolveTitleClient(session);
	t.is(resolved, session);
});

test('returns the session client when sessions block exists but names no model', async t => {
	writeSessionConfig({autoSave: true});
	const session = fakeClient('session-model');
	t.is(await resolveTitleClient(session), session);
});

test('falls back to the session client when the override cannot be built', async t => {
	// The realistic failure: a user names a provider or model they do not have.
	// The feature must degrade to the session model, not go silently dead.
	writeSessionConfig({
		titleProvider: 'no-such-provider-exists',
		titleModel: 'nope',
	});
	const session = fakeClient('session-model');
	t.is(await resolveTitleClient(session), session);
});

// The tests below need a provider that actually constructs, so they write a
// real agents.config.json into the pinned config dir (also the cwd).
function writeProviders(providers: unknown[]): void {
	writeFileSync(
		join(testConfigDir, 'agents.config.json'),
		JSON.stringify({nanocoder: {providers}}),
	);
	clearAppConfig();
}

const alpha = {
	name: 'alpha',
	type: 'openai-compatible',
	baseUrl: 'http://127.0.0.1:9/v1',
	apiKey: 'x',
	models: ['alpha-model'],
};

test('the cached client is rebuilt when the configured title model changes', async t => {
	writeProviders([alpha]);
	writeSessionConfig({titleProvider: 'alpha', titleModel: 'alpha-model'});

	const session = fakeClient('session-model');
	const first = await resolveTitleClient(session);
	t.not(first, session, 'a configured, constructible provider should be used');
	t.is(await resolveTitleClient(session), first, 'same config reuses the client');

	writeSessionConfig({titleProvider: 'alpha', titleModel: 'a-different-model'});
	const rebuilt = await resolveTitleClient(session);
	t.not(rebuilt, first, 'a config change must not serve the stale client');
});

test('the cached client is rebuilt when the provider it names is edited', async t => {
	// The case a provider/model cache key cannot see: both names are untouched,
	// so the key built from them is byte-identical, but "alpha" now points at a
	// different endpoint. Without the config generation in the key this serves a
	// client aimed at the old baseURL for the rest of the process.
	writeProviders([alpha]);
	writeSessionConfig({titleProvider: 'alpha', titleModel: 'alpha-model'});

	const session = fakeClient('session-model');
	const first = await resolveTitleClient(session);
	t.not(first, session, 'a configured, constructible provider should be used');

	writeProviders([{...alpha, baseUrl: 'http://127.0.0.1:10/v1'}]);
	const rebuilt = await resolveTitleClient(session);
	t.not(rebuilt, first, 'an edited provider must not serve the stale client');
});
