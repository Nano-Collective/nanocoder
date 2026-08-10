import test from 'ava';
import {
	applyGeneralSettings,
	DEFAULT_GENERAL_SETTINGS,
	parseConfig,
	readSettings,
	serialiseConfig,
	THRESHOLD_MAX,
	THRESHOLD_MIN
} from './settings-config';

test('settings-config - falls back to defaults on an empty config', (t) => {
	const snapshot = readSettings({});

	t.deepEqual(snapshot.general, DEFAULT_GENERAL_SETTINGS, 'Should use defaults');
	t.deepEqual(snapshot.providers, [], 'Should report no providers');
	t.deepEqual(snapshot.mcpServers, [], 'Should report no MCP servers');
});

test('settings-config - reads settings nested under the nanocoder key', (t) => {
	const snapshot = readSettings({
		nanocoder: {
			defaultMode: 'yolo',
			autoCompact: { enabled: false, threshold: 75 }
		}
	});

	t.is(snapshot.general.defaultMode, 'yolo', 'Should read defaultMode');
	t.false(snapshot.general.autoCompactEnabled, 'Should read autoCompact.enabled');
	t.is(snapshot.general.autoCompactThreshold, 75, 'Should read autoCompact.threshold');
});

test('settings-config - rejects an unknown development mode', (t) => {
	const snapshot = readSettings({nanocoder: {defaultMode: 'headless'}});

	t.is(snapshot.general.defaultMode, 'normal', 'Should fall back to normal');
});

test('settings-config - clamps the auto-compact threshold', (t) => {
	const low = readSettings({nanocoder: {autoCompact: {threshold: 5}}});
	const high = readSettings({nanocoder: {autoCompact: {threshold: 500}}});

	t.is(low.general.autoCompactThreshold, THRESHOLD_MIN, 'Should clamp upwards');
	t.is(high.general.autoCompactThreshold, THRESHOLD_MAX, 'Should clamp downwards');
});

test('settings-config - summarises providers and MCP servers', (t) => {
	const snapshot = readSettings({
		providers: [
			{name: 'Ollama', models: ['qwen3', 'llama3.1']},
			{models: ['gpt-4o']}
		],
		mcpServers: [{name: 'filesystem'}]
	});

	t.deepEqual(
		snapshot.providers,
		[
			{name: 'Ollama', models: 2},
			{name: 'Unnamed', models: 1}
		],
		'Should count models per provider'
	);
	t.deepEqual(snapshot.mcpServers, [{name: 'filesystem'}], 'Should list MCP servers');
});

test('settings-config - preserves unrelated config when saving', (t) => {
	const existing = {
		providers: [{name: 'Ollama', models: ['qwen3']}],
		mcpServers: [{name: 'filesystem'}],
		nanocoder: {
			sessions: {autoSave: true},
			autoCompact: {strategy: 'llm', mode: 'conservative', notifyUser: true}
		}
	};

	const updated = applyGeneralSettings(existing, {
		defaultMode: 'plan',
		autoCompactEnabled: false,
		autoCompactThreshold: 80
	}) as any;

	t.deepEqual(updated.providers, existing.providers, 'Should not touch providers');
	t.deepEqual(updated.mcpServers, existing.mcpServers, 'Should not touch MCP servers');
	t.deepEqual(
		updated.nanocoder.sessions,
		{autoSave: true},
		'Should not touch sibling nanocoder keys'
	);
	t.is(updated.nanocoder.autoCompact.strategy, 'llm', 'Should keep autoCompact.strategy');
	t.is(updated.nanocoder.autoCompact.mode, 'conservative', 'Should keep autoCompact.mode');
	t.true(updated.nanocoder.autoCompact.notifyUser, 'Should keep autoCompact.notifyUser');
	t.is(updated.nanocoder.defaultMode, 'plan', 'Should write the new mode');
	t.false(updated.nanocoder.autoCompact.enabled, 'Should write the new enabled flag');
	t.is(updated.nanocoder.autoCompact.threshold, 80, 'Should write the new threshold');
});

test('settings-config - does not mutate the config it was given', (t) => {
	const existing = {nanocoder: {defaultMode: 'normal'}};

	applyGeneralSettings(existing, {defaultMode: 'yolo'});

	t.is(existing.nanocoder.defaultMode, 'normal', 'Original config should be untouched');
});

test('settings-config - sanitises values coming from the webview', (t) => {
	const updated = applyGeneralSettings(
		{},
		{defaultMode: 'rm -rf', autoCompactEnabled: 'yes', autoCompactThreshold: '999'}
	) as any;

	t.is(updated.nanocoder.defaultMode, 'normal', 'Should reject an invalid mode');
	t.true(updated.nanocoder.autoCompact.enabled, 'Should coerce the enabled flag');
	t.is(updated.nanocoder.autoCompact.threshold, THRESHOLD_MAX, 'Should clamp the threshold');
});

test('settings-config - parses config text', (t) => {
	t.deepEqual(parseConfig(''), {}, 'Empty file should be an empty config');
	t.deepEqual(parseConfig('{"a":1}'), {a: 1}, 'Should parse an object');
	t.throws(() => parseConfig('[]'), undefined, 'Should reject a non-object root');
	t.throws(() => parseConfig('{'), undefined, 'Should reject malformed JSON');
});

test('settings-config - serialises with tabs and a trailing newline', (t) => {
	const text = serialiseConfig({nanocoder: {defaultMode: 'plan'}});

	t.true(text.includes('\n\t"nanocoder"'), 'Should indent with tabs');
	t.true(text.endsWith('\n'), 'Should end with a newline');
	t.deepEqual(parseConfig(text), {nanocoder: {defaultMode: 'plan'}}, 'Should round-trip');
});
