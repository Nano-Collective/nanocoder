import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {runConfigCli} from './config-cli';
import {
	type EffectiveConfig,
	findEntries,
	redactValue,
	resolveEffectiveConfig,
	selectOverrides,
} from './effective-config';
import {clearAppConfig} from './index';
import {resetPreferencesCache} from './preferences';

console.log(`\neffective-config.spec.ts`);

interface Fixture {
	/** JSON written to `<project>/agents.config.json`. */
	projectAgents?: unknown;
	/** JSON written to `<configDir>/agents.config.json`. */
	globalAgents?: unknown;
	projectPreferences?: unknown;
	globalPreferences?: unknown;
	/** Environment variables set for the duration of the callback. */
	env?: Record<string, string | undefined>;
}

let fixtureCounter = 0;

/**
 * Run `body` against a throwaway project directory and config directory, with
 * the module-level caches in `config/index.ts` and `config/preferences.ts`
 * cleared on the way in and out. Tests are serial, so mutating `process.cwd()`
 * and `process.env` here is safe.
 */
function withFixture<T>(
	fixture: Fixture,
	body: (paths: {project: string; configDir: string}) => T,
): T {
	const root = join(tmpdir(), `nanocoder-effective-${Date.now()}-${fixtureCounter++}`);
	const project = join(root, 'project');
	const configDir = join(root, 'config');
	mkdirSync(project, {recursive: true});
	mkdirSync(configDir, {recursive: true});

	const write = (path: string, value: unknown) => {
		if (value !== undefined) writeFileSync(path, JSON.stringify(value), 'utf-8');
	};
	write(join(project, 'agents.config.json'), fixture.projectAgents);
	write(join(configDir, 'agents.config.json'), fixture.globalAgents);
	write(join(project, 'nanocoder-preferences.json'), fixture.projectPreferences);
	write(join(configDir, 'nanocoder-preferences.json'), fixture.globalPreferences);

	const originalCwd = process.cwd();
	const originalEnv = {...process.env};
	process.chdir(project);
	process.env.NANOCODER_CONFIG_DIR = configDir;
	for (const [key, value] of Object.entries(fixture.env ?? {})) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	clearAppConfig();
	resetPreferencesCache();

	try {
		return body({project, configDir});
	} finally {
		process.chdir(originalCwd);
		for (const key of Object.keys(process.env)) {
			if (!(key in originalEnv)) delete process.env[key];
		}
		Object.assign(process.env, originalEnv);
		clearAppConfig();
		resetPreferencesCache();
		rmSync(root, {recursive: true, force: true});
	}
}

function entry(config: EffectiveConfig, key: string) {
	return config.entries.find(candidate => candidate.key === key);
}

test('unset keys resolve to the built-in default layer', t => {
	withFixture({}, () => {
		const config = resolveEffectiveConfig();
		const threshold = entry(config, 'nanocoder.autoCompact.threshold');

		t.is(threshold?.value, 60);
		t.is(threshold?.layer, 'default');
		t.is(threshold?.origin, 'built-in');
		t.true(threshold?.hasDefault);
		t.deepEqual(threshold?.shadowed, []);
	});
});

test('a project value wins and records the global value it shadows', t => {
	withFixture(
		{
			projectAgents: {nanocoder: {autoCompact: {threshold: 80}}},
			globalAgents: {nanocoder: {autoCompact: {threshold: 70}}},
		},
		paths => {
			const config = resolveEffectiveConfig();
			const threshold = entry(config, 'nanocoder.autoCompact.threshold');

			t.is(threshold?.value, 80);
			t.is(threshold?.layer, 'project');
			t.is(threshold?.origin, join(paths.project, 'agents.config.json'));
			t.deepEqual(threshold?.shadowed, [
				{
					layer: 'global',
					origin: join(paths.configDir, 'agents.config.json'),
					value: 70,
					redacted: false,
				},
			]);
		},
	);
});

test('block precedence discards the whole losing block, not just the shared field', t => {
	// The project file sets one field of `autoCompact`. The loader takes the
	// entire block from that file, so the global file's `notifyUser: false` is
	// ignored and the built-in default runs instead. Surfacing exactly this is
	// the point of the command.
	withFixture(
		{
			projectAgents: {nanocoder: {autoCompact: {threshold: 80}}},
			globalAgents: {nanocoder: {autoCompact: {notifyUser: false}}},
		},
		paths => {
			const config = resolveEffectiveConfig();
			const notify = entry(config, 'nanocoder.autoCompact.notifyUser');

			t.is(notify?.value, true, 'built-in default, not the global file value');
			t.is(notify?.layer, 'default');
			t.is(notify?.block, 'nanocoder.autoCompact');
			t.deepEqual(notify?.shadowed, [
				{
					layer: 'global',
					origin: join(paths.configDir, 'agents.config.json'),
					value: false,
					redacted: false,
				},
			]);
		},
	);
});

test('a field that exists only in a losing layer is still reported', t => {
	// `modeProviders` has no built-in defaults, so nothing backfills a field
	// the winning file omits. The global file's `normal` entry vanishes
	// entirely when the project file claims the block — the discarded value
	// has to appear as shadowed or the command hides the very thing it exists
	// to surface.
	withFixture(
		{
			projectAgents: {
				nanocoder: {
					providers: [{name: 'p', models: ['m']}],
					modeProviders: {plan: {provider: 'p', model: 'm'}},
				},
			},
			globalAgents: {
				nanocoder: {modeProviders: {normal: {provider: 'p', model: 'm'}}},
			},
		},
		paths => {
			const config = resolveEffectiveConfig();
			const normal = entry(config, 'nanocoder.modeProviders.normal.provider');

			t.truthy(normal, 'the discarded field still gets a row');
			t.is(normal?.value, undefined, 'it is not in effect');
			t.deepEqual(normal?.shadowed, [
				{
					layer: 'global',
					origin: join(paths.configDir, 'agents.config.json'),
					value: 'p',
					redacted: false,
				},
			]);

			t.is(
				entry(config, 'nanocoder.modeProviders.plan.provider')?.layer,
				'project',
			);
		},
	);
});

test('the effective value is the clamped one the app will actually use', t => {
	withFixture(
		{projectAgents: {nanocoder: {autoCompact: {threshold: 200}}}},
		() => {
			const config = resolveEffectiveConfig();
			const threshold = entry(config, 'nanocoder.autoCompact.threshold');

			t.is(threshold?.value, 95, 'clamped to the 50-95 range');
			t.is(threshold?.layer, 'project');
		},
	);
});

test('an environment variable outranks the config file', t => {
	withFixture(
		{
			projectAgents: {nanocoder: {headless: {maxTurns: 42}}},
			env: {NANOCODER_MAX_TURNS: '7'},
		},
		paths => {
			const config = resolveEffectiveConfig();
			const maxTurns = entry(config, 'nanocoder.headless.maxTurns');

			t.is(maxTurns?.value, 7);
			t.is(maxTurns?.layer, 'env');
			t.is(maxTurns?.origin, 'NANOCODER_MAX_TURNS');
			t.deepEqual(maxTurns?.shadowed, [
				{
					layer: 'project',
					origin: join(paths.project, 'agents.config.json'),
					value: 42,
					redacted: false,
				},
			]);
		},
	);
});

test('NANOCODER_CONFIG_DIR marks the project preferences file as skipped', t => {
	withFixture(
		{
			globalPreferences: {selectedTheme: 'dark'},
			projectPreferences: {selectedTheme: 'light'},
		},
		paths => {
			const config = resolveEffectiveConfig();
			const theme = entry(config, 'preferences.selectedTheme');

			t.is(theme?.value, 'dark', 'the config directory wins when it is explicit');
			t.is(theme?.layer, 'global');
			t.deepEqual(theme?.shadowed, [
				{
					layer: 'project',
					origin: join(paths.project, 'nanocoder-preferences.json'),
					value: 'light',
					redacted: false,
				},
			]);

			const skipped = config.layers.find(layer => layer.skipped !== undefined);
			t.is(skipped?.origin, join(paths.project, 'nanocoder-preferences.json'));
		},
	);
});

test('provider credentials are redacted in both effective and shadowed values', t => {
	withFixture(
		{
			projectAgents: {
				nanocoder: {
					providers: [
						{name: 'shared', models: ['m'], apiKey: 'sk-project-secret'},
						{name: 'unresolved', models: ['m'], apiKey: '${NANOCODER_NOT_SET}'},
					],
				},
			},
			globalAgents: {
				nanocoder: {
					providers: [{name: 'shared', models: ['m'], apiKey: '${SOME_KEY}'}],
				},
			},
			env: {NANOCODER_NOT_SET: undefined},
		},
		() => {
			const config = resolveEffectiveConfig();
			const shared = entry(config, 'nanocoder.providers.shared');

			t.true(shared?.redacted);
			t.is((shared?.value as {apiKey: string}).apiKey, '<redacted>');
			t.is(
				(shared?.shadowed[0]?.value as {apiKey: string}).apiKey,
				'${SOME_KEY}',
				'a raw env reference names the variable to check, so it is safe to show',
			);

			// An unset reference substitutes to an empty string. Showing that
			// verbatim is the whole diagnosis: the variable is not exported.
			const unresolved = entry(config, 'nanocoder.providers.unresolved');
			t.is((unresolved?.value as {apiKey: string}).apiKey, '');
			t.false(unresolved?.redacted);
		},
	);
});

test('redactValue leaves non-secret values untouched', t => {
	t.deepEqual(redactValue({baseUrl: 'http://x', models: ['a']}), {
		value: {baseUrl: 'http://x', models: ['a']},
		redacted: false,
	});
	t.deepEqual(redactValue('hunter2', 'password'), {
		value: '<redacted>',
		redacted: true,
	});
});

test('selectOverrides returns only what the config files change', t => {
	withFixture(
		{
			projectAgents: {nanocoder: {retries: {maxEmptyTurns: 9}}},
			globalAgents: {nanocoder: {retries: {maxEmptyTurns: 4}}},
		},
		() => {
			const config = resolveEffectiveConfig();
			const overrides = selectOverrides(config);
			const keys = overrides.map(override => override.key);

			t.true(keys.includes('nanocoder.retries.maxEmptyTurns'));
			t.false(
				keys.includes('nanocoder.autoCompact.threshold'),
				'untouched defaults stay out of the diff',
			);
		},
	);
});

test('findEntries accepts exact keys, blocks, and the bare suffix', t => {
	withFixture({projectAgents: {nanocoder: {autoCompact: {threshold: 80}}}}, () => {
		const config = resolveEffectiveConfig();

		t.is(findEntries(config, 'nanocoder.autoCompact.threshold').length, 1);
		t.is(findEntries(config, 'autoCompact.threshold').length, 1);
		t.is(findEntries(config, 'nanocoder.autoCompact').length, 5);
		t.is(findEntries(config, 'autoCompact').length, 5);
		t.is(findEntries(config, 'no-such-key').length, 0);
	});
});

test('config keys named after Object.prototype members are not resolved', t => {
	// Every key here comes from user-written JSON, so reads must stay on own
	// properties. The sharpest case is a provider named `constructor`: reading
	// it off a plain accumulator object returns Object's own constructor for
	// *any* layer, which used to invent a shadowing layer that does not exist.
	withFixture(
		{
			projectAgents: {
				nanocoder: {
					autoCompact: {threshold: 80, toString: 'hijacked'},
					providers: [
						{name: 'constructor', models: ['m']},
						{name: '__proto__', models: ['m']},
					],
				},
			},
			globalAgents: {nanocoder: {providers: [{name: 'real', models: ['m']}]}},
		},
		() => {
			const config = resolveEffectiveConfig();

			for (const name of ['constructor', '__proto__']) {
				const provider = entry(config, `nanocoder.providers.${name}`);
				t.is(provider?.layer, 'project', `${name} resolves from the file`);
				t.deepEqual(
					provider?.shadowed,
					[],
					`${name} must not report a layer that never declared it`,
				);
			}

			// An inherited member is never mistaken for a real setting or for a
			// built-in default.
			t.is(findEntries(config, 'nanocoder.autoCompact.toString').length, 0);
			t.is(findEntries(config, 'nanocoder.autoCompact.valueOf').length, 0);

			// Real fields alongside the hostile ones still resolve normally.
			t.is(entry(config, 'nanocoder.autoCompact.threshold')?.value, 80);
			t.is(entry(config, 'nanocoder.autoCompact.enabled')?.value, true);
		},
	);
});

test('runConfigCli renders list, show, and diff', t => {
	withFixture({projectAgents: {nanocoder: {autoCompact: {threshold: 80}}}}, () => {
		const list = runConfigCli('list');
		t.is(list.exitCode, 0);
		t.regex(list.output, /nanocoder\.autoCompact\.threshold\s+80\s+project/);

		const show = runConfigCli('show', ['nanocoder.autoCompact.threshold']);
		t.is(show.exitCode, 0);
		t.regex(show.output, /value\s+80/);
		t.regex(show.output, /default\s+60/);

		const diff = runConfigCli('diff');
		t.is(diff.exitCode, 0);
		t.regex(diff.output, /Overrides in effect/);
	});
});

test('runConfigCli reports an unknown key and a bad subcommand', t => {
	withFixture({}, () => {
		const unknownKey = runConfigCli('show', ['nope.nope']);
		t.is(unknownKey.exitCode, 1);
		t.regex(unknownKey.output, /No configuration key matching "nope\.nope"/);

		const badCommand = runConfigCli('explode');
		t.is(badCommand.exitCode, 1);
		t.regex(badCommand.output, /Unknown config command "explode"/);

		const help = runConfigCli('--help');
		t.is(help.exitCode, 0);
		t.regex(help.output, /Usage: nanocoder config/);
	});
});

test('runConfigCli --json emits parseable output', t => {
	withFixture({projectAgents: {nanocoder: {autoCompact: {threshold: 80}}}}, () => {
		const result = runConfigCli('diff', ['--json']);
		t.is(result.exitCode, 0);

		const parsed = JSON.parse(result.output) as EffectiveConfig;
		const threshold = parsed.entries.find(
			candidate => candidate.key === 'nanocoder.autoCompact.threshold',
		);
		t.is(threshold?.value, 80);
		t.is(threshold?.layer, 'project');
	});
});
