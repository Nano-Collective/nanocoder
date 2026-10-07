import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import React from 'react';

// CRITICAL: point config reads at a temp dir BEFORE the panel's @/config/index
// import chain loads, so this spec never reads the developer's real config.
// The providers must live in a *project* config: loadAllProviderConfigs skips
// global providers entirely when NODE_ENV is 'test' (which AVA sets), so a
// global-only config would load as zero providers.
const configDir = mkdtempSync(join(tmpdir(), 'nanocoder-spec-'));
process.env.NANOCODER_CONFIG_DIR = configDir;
// AVA runs each spec file in its own process (workerThreads: false), so this
// chdir cannot leak into another spec and needs no restore hook — and a hook
// declared between top-level awaits would not be picked up anyway.
process.chdir(configDir);
writeFileSync(
	join(configDir, 'agents.config.json'),
	JSON.stringify({
		nanocoder: {
			providers: [
				{
					name: 'ollama',
					baseUrl: 'http://localhost:11434/v1',
					models: ['llama2'],
				},
				{
					name: 'openrouter',
					baseUrl: 'https://openrouter.ai/api/v1',
					models: ['gpt-4', 'claude'],
				},
			],
		},
	}),
);

const {reloadAppConfig} = await import('@/config/index');
reloadAppConfig();

const {renderWithTheme: render} = await import(
	'../../test-utils/render-with-theme'
);
const {SettingsProvidersListPanel} = await import('./settings-providers-list');

console.log(`\nsettings-providers-list.spec.tsx – ${React.version}`);

test('lists every configured provider as its own row', t => {
	const {lastFrame} = render(
		<SettingsProvidersListPanel onBack={() => {}} onCancel={() => {}} />,
	);

	const output = lastFrame()!;
	t.regex(output, /ollama/);
	t.regex(output, /openrouter/);
});

test('offers an explicit add row separate from the provider rows', t => {
	const {lastFrame} = render(
		<SettingsProvidersListPanel onBack={() => {}} onCancel={() => {}} />,
	);

	const output = lastFrame()!;
	// The old panel had a single "+ Add or edit providers…" row and every
	// provider row opened that same generic flow.
	t.regex(output, /\+ Add a provider/);
	t.notRegex(output, /Add or edit providers/);
});

test('tells the user that Enter acts on the selected provider', t => {
	const {lastFrame} = render(
		<SettingsProvidersListPanel onBack={() => {}} onCancel={() => {}} />,
	);

	t.regex(lastFrame()!, /edits or deletes the selected provider/);
});
