import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {clearAppConfig, reloadAppConfig} from '@/config/index';
import {
	appendPostToolUseOutput,
	runLifecycleHooks,
	runPreToolUseGate,
} from '@/services/lifecycle-hooks';
import {resetSessionCwd, setProjectRoot} from '@/services/session-cwd';
import type {ToolCall} from '@/types/core';
import {
	consultPluginPermission,
	loadPlugins,
	loadTrustedProjectPlugins,
	resetPluginsForTests,
} from './host';

console.log(`\nhost.spec.ts`);

const testDir = join(tmpdir(), `nanocoder-plugins-${Date.now()}`);
const originalCwd = process.cwd();
const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;

let projectCount = 0;

/**
 * A fresh project root per test. Node caches ES modules by URL, so reusing a
 * path across tests would hand back the previous test's plugin.
 */
function withPlugins(files: Record<string, string>): string {
	const root = join(testDir, `project-${projectCount++}`);
	const pluginDir = join(root, '.nanocoder', 'plugins');
	mkdirSync(pluginDir, {recursive: true});
	for (const [name, source] of Object.entries(files)) {
		writeFileSync(join(pluginDir, name), source, 'utf-8');
	}
	setProjectRoot(root);
	return root;
}

function bashCall(command: string): ToolCall {
	return {
		id: `call-${command}`,
		function: {name: 'execute_bash', arguments: {command}},
	};
}

const BLOCK_BASH = `export default {
	apiVersion: 1,
	name: 'guard',
	hooks: {
		'tool.execute.before': ({toolName}) =>
			toolName === 'execute_bash' ? {block: 'bash is disabled here'} : undefined,
	},
};
`;

test.before(() => {
	mkdirSync(testDir, {recursive: true});
	process.env.NANOCODER_CONFIG_DIR = join(testDir, 'no-global-config');
	process.chdir(testDir);
	writeFileSync(
		join(testDir, 'agents.config.json'),
		JSON.stringify({nanocoder: {hooks: {}}}),
		'utf-8',
	);
	reloadAppConfig();
});

test.after.always(() => {
	process.chdir(originalCwd);
	if (originalConfigDir === undefined) {
		delete process.env.NANOCODER_CONFIG_DIR;
	} else {
		process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
	}
	clearAppConfig();
	resetSessionCwd();
	resetPluginsForTests();
	if (existsSync(testDir)) rmSync(testDir, {recursive: true, force: true});
});

test.beforeEach(() => {
	resetPluginsForTests();
});

test.serial('an untrusted load leaves the plugin inert', async t => {
	withPlugins({'guard.mjs': BLOCK_BASH});

	await loadPlugins(false);
	const gate = await runPreToolUseGate(bashCall('ls'), {command: 'ls'});

	t.deepEqual(gate, {blocked: false, output: ''});

	await loadPlugins(true);
	const trusted = await runPreToolUseGate(bashCall('pwd'), {command: 'pwd'});
	t.true(trusted.blocked);
});

test.serial('a trusted plugin blocks a tool before it runs', async t => {
	withPlugins({'guard.mjs': BLOCK_BASH});

	await loadPlugins(true);
	const gate = await runPreToolUseGate(bashCall('ls'), {command: 'ls'});

	t.true(gate.blocked);
	t.is(gate.reason, 'Blocked by plugin "guard": bash is disabled here');
});

test.serial('tool.execute.after appends to the tool result', async t => {
	withPlugins({
		'annotate.mjs': `export default {
	apiVersion: 1,
	name: 'annotate',
	hooks: {
		'tool.execute.after': ({toolResult}) =>
			({append: 'Remember to run the tests. Saw ' + toolResult.length + ' chars.'}),
	},
};
`,
	});

	await loadPlugins(true);
	const result = await appendPostToolUseOutput(
		'read_file',
		{path: 'a.ts'},
		'const a = 1;',
	);

	t.is(
		result,
		'const a = 1;\n\n<hook-output event="post-tool-use">\nRemember to run the tests. Saw 12 chars.\n</hook-output>',
	);
});

test.serial('tui.prompt.append becomes the prompt hook output', async t => {
	withPlugins({
		'branch.mjs': `export default {
	apiVersion: 1,
	name: 'branch',
	hooks: {
		'tui.prompt.append': async ({prompt}) =>
			prompt.includes('release') ? 'release branch: main' : undefined,
	},
};
`,
	});

	await loadPlugins(true);
	const outcome = await runLifecycleHooks('user-prompt-submit', {
		prompt: 'ship the release',
	});
	const unrelated = await runLifecycleHooks('user-prompt-submit', {
		prompt: 'fix the typo',
	});

	t.deepEqual(outcome, {blocked: false, output: 'release branch: main'});
	t.deepEqual(unrelated, {blocked: false, output: ''});
});

test.serial('a throwing session.compacting plugin does not block', async t => {
	withPlugins({
		'boom.mjs': `export default {
	apiVersion: 1,
	name: 'boom',
	hooks: {
		'session.compacting': () => {
			throw new Error('compaction observer broke');
		},
	},
};
`,
	});

	await loadPlugins(true);
	const outcome = await runLifecycleHooks('pre-compact', {messageCount: 3});

	t.deepEqual(outcome, {blocked: false, output: ''});
});

test.serial('permission.asked can deny or defer', async t => {
	withPlugins({
		'push.mjs': `export default {
	apiVersion: 1,
	name: 'push',
	hooks: {
		'permission.asked': ({toolName, toolArgs}) =>
			toolName === 'execute_bash' && String(toolArgs.command).includes('--force')
				? {decision: 'deny', reason: 'no force push'}
				: {decision: 'defer'},
	},
};
`,
	});

	await loadPlugins(true);

	t.deepEqual(
		await consultPluginPermission('execute_bash', {
			command: 'git push --force',
		}),
		{decision: 'deny', reason: 'no force push'},
	);
	t.deepEqual(
		await consultPluginPermission('execute_bash', {command: 'git status'}),
		{decision: 'defer'},
	);
});

test.serial(
	'a file using a shell hook name is skipped without dropping others',
	async t => {
		withPlugins({
			'a-wrong-name.mjs': `export default {
	apiVersion: 1,
	name: 'wrong',
	hooks: {'pre-tool-use': () => ({block: 'from the rejected file'})},
};
`,
			'b-guard.mjs': BLOCK_BASH,
		});

		await loadPlugins(true);
		const gate = await runPreToolUseGate(bashCall('ls'), {command: 'ls'});

		t.is(gate.reason, 'Blocked by plugin "guard": bash is disabled here');
	},
);

test.serial(
	'an editor session loads plugins only when the directory is already trusted',
	async t => {
		const root = withPlugins({'guard.mjs': BLOCK_BASH});
		const configDir = join(testDir, 'no-global-config');
		mkdirSync(configDir, {recursive: true});

		await loadTrustedProjectPlugins();
		const before = await runPreToolUseGate(bashCall('ls'), {command: 'ls'});
		t.deepEqual(before, {blocked: false, output: ''});

		writeFileSync(
			join(configDir, 'nanocoder-preferences.json'),
			JSON.stringify({trustedDirectories: [root]}),
			'utf-8',
		);
		resetPluginsForTests();

		await loadTrustedProjectPlugins();
		const after = await runPreToolUseGate(bashCall('pwd'), {command: 'pwd'});
		t.is(after.reason, 'Blocked by plugin "guard": bash is disabled here');
	},
);

test.serial('a .js file is left unloaded', async t => {
	withPlugins({'guard.js': BLOCK_BASH});

	await loadPlugins(true);
	const gate = await runPreToolUseGate(bashCall('ls'), {command: 'ls'});

	t.deepEqual(gate, {blocked: false, output: ''});
});

test.serial('a before hook that returns the wrong shape does not block', async t => {
	withPlugins({
		'bad.mjs': `export default {
	apiVersion: 1,
	name: 'bad',
	hooks: {
		'tool.execute.before': () => ({blocked: 'no'}),
	},
};
`,
	});

	await loadPlugins(true);
	const gate = await runPreToolUseGate(bashCall('ls'), {command: 'ls'});

	t.deepEqual(gate, {blocked: false, output: ''});
});

test.serial('a duplicate plugin name is skipped', async t => {
	const blockWith = (message: string) => `export default {
	apiVersion: 1,
	name: 'same',
	hooks: {'tool.execute.before': () => ({block: '${message}'})},
};
`;
	withPlugins({
		'1-first.mjs': blockWith('first plugin'),
		'2-second.mjs': blockWith('second plugin'),
	});

	await loadPlugins(true);
	const gate = await runPreToolUseGate(bashCall('ls'), {command: 'ls'});

	t.is(gate.reason, 'Blocked by plugin "same": first plugin');
});
