import {mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {clearAppConfig} from '@/config';
import type {LLMClient} from '@/types/core';
import {resetTitleClientCache, resolveTitleClient} from './title-client.js';

console.log('\ntitle-client.spec.ts');

// getAppConfig() lazily loads from disk, so without this the test would read
// the developer's real config and fail for anyone who has titleModel set.
const testConfigDir = join(tmpdir(), `nanocoder-title-client-${Date.now()}`);
mkdirSync(testConfigDir, {recursive: true});
process.env.NANOCODER_CONFIG_DIR = testConfigDir;
process.chdir(testConfigDir);

const configPath = join(testConfigDir, 'agents.config.json');

function writeConfig(config: Record<string, unknown>): void {
	writeFileSync(configPath, JSON.stringify(config));
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
	writeConfig({});
});

test('returns the session client when no override is configured', async t => {
	const session = fakeClient('session-model');
	const resolved = await resolveTitleClient(session);
	t.is(resolved, session);
});

test('returns the session client when sessions block exists but names no model', async t => {
	writeConfig({sessions: {autoSave: true}});
	const session = fakeClient('session-model');
	t.is(await resolveTitleClient(session), session);
});

test('falls back to the session client when the override cannot be built', async t => {
	// The realistic failure: a user names a provider or model they do not have.
	// The feature must degrade to the session model, not go silently dead.
	writeConfig({
		sessions: {titleProvider: 'no-such-provider-exists', titleModel: 'nope'},
	});
	const session = fakeClient('session-model');
	t.is(await resolveTitleClient(session), session);
});
