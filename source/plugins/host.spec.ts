import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {runAcpConversation} from '@/acp/acp-conversation';
import {AcpSession} from '@/acp/acp-session';
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
	withTrustedProjectPlugins,
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

	t.deepEqual(gate, {blocked: false, output: '', failures: []});

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

test.serial('failing shell output survives alongside post-tool-use plugin output', async t => {
	withPlugins({'annotate.mjs': `export default {
		apiVersion: 1, name: 'annotate',
		hooks: {'tool.execute.after': () => ({append: 'plugin note'})},
	};`});
	writeFileSync(
		join(testDir, 'agents.config.json'),
		JSON.stringify({nanocoder: {hooks: {
			'post-tool-use': [{command:
				`node -e "console.error('lint failed');process.exit(2)"`,
			}],
		}}}),
	);
	reloadAppConfig();
	try {
		await loadPlugins(true);
		const content = await appendPostToolUseOutput('write_file', {path: 'a.ts'}, 'written');
		t.is(content, 'written\n\n<hook-output event="post-tool-use">\nplugin note\n</hook-output>\n\n<hook-output event="post-tool-use" exit="2">\nlint failed\n</hook-output>');
	} finally {
		writeFileSync(join(testDir, 'agents.config.json'), JSON.stringify({nanocoder: {hooks: {}}}));
		reloadAppConfig();
	}
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

	t.deepEqual(outcome, {blocked: false, output: 'release branch: main', failures: []});
	t.deepEqual(unrelated, {blocked: false, output: '', failures: []});
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

	t.deepEqual(outcome, {blocked: false, output: '', failures: []});
});

test.serial('an allow vote does not approve the tool', async t => {
	withPlugins({
		'allow.mjs': `export default {
	apiVersion: 1,
	name: 'allow',
	hooks: {
		'permission.asked': () => ({decision: 'allow'}),
	},
};
`,
	});

	await loadPlugins(true);

	t.deepEqual(
		await consultPluginPermission('execute_bash', {command: 'rm -rf /'}),
		{decision: 'defer'},
	);
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
		t.deepEqual(before, {blocked: false, output: '', failures: []});

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

	t.deepEqual(gate, {blocked: false, output: '', failures: []});
});

test.serial('concurrent workspace scopes isolate plugins and exclude untrusted projects', async t => {
	const guardRoot = withPlugins({'guard.mjs': BLOCK_BASH});
	const otherRoot = withPlugins({
		'other.mjs': `export default {
			apiVersion: 1, name: 'other',
			hooks: {'tool.execute.before': () => ({block: 'other workspace'})},
		};`,
	});
	const untrustedRoot = withPlugins({'guard.mjs': BLOCK_BASH});
	const configDir = join(testDir, 'no-global-config');
	mkdirSync(configDir, {recursive: true});
	writeFileSync(
		join(configDir, 'nanocoder-preferences.json'),
		JSON.stringify({trustedDirectories: [guardRoot, otherRoot]}),
	);
	// Even a loaded default plugin must not leak into an ACP workspace.
	setProjectRoot(guardRoot);
	await loadPlugins(true);
	const results = await Promise.all(
		[guardRoot, otherRoot, untrustedRoot].map(root =>
			withTrustedProjectPlugins(root, async () => {
				await new Promise(resolve => setImmediate(resolve));
				return runPreToolUseGate(bashCall(root), {command: 'ls'});
			}),
		),
	);
	t.is(results[0].reason, 'Blocked by plugin "guard": bash is disabled here');
	t.is(results[1].reason, 'Blocked by plugin "other": other workspace');
	t.deepEqual(results[2], {blocked: false, output: '', failures: []});
});

for (const decision of ['deny', 'defer']) {
	test.serial(`ACP loads session workspace plugins and ${decision === 'deny' ? 'skips' : 'preserves'} permission requests`, async t => {
		const root = withPlugins({
			'permission.mjs': `export default {
				apiVersion: 1, name: 'permission',
				hooks: {'permission.asked': () => ({decision: '${decision}', reason: 'workspace policy'})},
			};`,
		});
		const configDir = join(testDir, 'no-global-config');
		mkdirSync(configDir, {recursive: true});
		writeFileSync(
			join(configDir, 'nanocoder-preferences.json'),
			JSON.stringify({trustedDirectories: [root]}),
		);
		// Launch directory differs from the session's workspace.
		setProjectRoot(testDir);
		let permissionRequests = 0;
		const conn = {
			sessionUpdate: async () => {},
			requestPermission: async () => {
				permissionRequests++;
				return {outcome: {outcome: 'selected', optionId: 'reject'}};
			},
		};
		const session = new AcpSession({
			sessionId: `plugin-${decision}`,
			cwd: root,
			conn: conn as never,
			initialMode: 'normal',
		});
		session.systemMessage = {role: 'system', content: 'Test'};
		let calls = 0;
		await runAcpConversation({
			session,
			conn: conn as never,
			nonInteractiveAlwaysAllow: [],
			toolManager: {
				getAvailableToolNames: () => ['read_file'],
				getFilteredTools: () => ({}),
				hasTool: () => true,
				getToolEntry: () => ({approval: true}),
				isReadOnly: () => true,
			} as never,
			client: {
				chat: async () => ({
					choices: [{message: calls++ === 0
						? {role: 'assistant', content: '', tool_calls: [{
							id: 'plugin-call', function: {name: 'read_file', arguments: {path: 'a.ts'}},
						}]}
						: {role: 'assistant', content: 'Done'}}],
					toolsDisabled: false,
				}),
			} as never,
		});
		t.is(permissionRequests, decision === 'deny' ? 0 : 1);
		if (decision === 'deny') {
			t.true(session.messages.some(message =>
				message.role === 'tool' && message.content.includes('workspace policy'),
			));
		}
	});
}

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

	t.deepEqual(gate, {blocked: false, output: '', failures: []});
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
