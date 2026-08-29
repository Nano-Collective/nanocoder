import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {clearAppConfig, reloadAppConfig} from '@/config/index';
import {processToolUse, setToolRegistryGetter} from '@/message-handler';
import type {HooksConfig} from '@/types/config';
import type {ToolCall} from '@/types/core';
import {
	addPendingHookContext,
	clearPendingHookContext,
	getConfiguredHooks,
	runLifecycleHooks,
	takePendingHookContext,
} from './lifecycle-hooks';

console.log(`\nlifecycle-hooks.spec.ts`);

const testDir = join(tmpdir(), `nanocoder-hooks-${Date.now()}`);
const originalCwd = process.cwd();
const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;

/**
 * Point the config loader at an isolated project dir containing only the hooks
 * under test, and at a non-existent global config dir so the developer's own
 * `~/.config/nanocoder` can never leak into a run.
 */
function withHooks(hooks: HooksConfig): void {
	writeFileSync(
		join(testDir, 'agents.config.json'),
		JSON.stringify({nanocoder: {hooks}}),
		'utf-8',
	);
	reloadAppConfig();
}

// Portable hook bodies: `sh -c` on POSIX, `cmd /c` on Windows, so anything
// shell-specific ($VAR vs %VAR%, sleep vs timeout) is routed through node.
const node = (script: string) => `node -e "${script}"`;

test.before(() => {
	mkdirSync(testDir, {recursive: true});
	process.env.NANOCODER_CONFIG_DIR = join(testDir, 'no-global-config');
	process.chdir(testDir);
});

test.after.always(() => {
	process.chdir(originalCwd);
	if (originalConfigDir === undefined) {
		delete process.env.NANOCODER_CONFIG_DIR;
	} else {
		process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
	}
	clearAppConfig();
	try {
		if (existsSync(testDir)) rmSync(testDir, {recursive: true, force: true});
	} catch {
		// Best effort: on Windows a hook child killed by the timeout test can
		// still hold the temp dir as its cwd when the suite finishes.
	}
});

test.beforeEach(() => {
	clearPendingHookContext();
});

test.serial('no configured hooks is a no-op', async t => {
	withHooks({});

	const outcome = await runLifecycleHooks('pre-tool-use', {
		toolName: 'write_file',
	});

	t.false(outcome.blocked);
	t.is(outcome.output, '');
	t.deepEqual(getConfiguredHooks('pre-tool-use'), []);
});

test.serial('post-tool-use stdout is returned as hook output', async t => {
	withHooks({'post-tool-use': [{command: node("console.log('formatted')")}]});

	const outcome = await runLifecycleHooks('post-tool-use', {
		toolName: 'write_file',
	});

	t.false(outcome.blocked);
	t.is(outcome.output, 'formatted');
});

test.serial(
	'pre-tool-use non-zero exit blocks and reports stdout as the reason',
	async t => {
		withHooks({
			'pre-tool-use': [
				{
					name: 'no-env',
					command: node("console.log('.env is off limits');process.exit(2)"),
				},
			],
		});

		const outcome = await runLifecycleHooks('pre-tool-use', {
			toolName: 'write_file',
			toolArgs: {path: '.env'},
		});

		t.true(outcome.blocked);
		t.is(outcome.reason, 'Blocked by hook "no-env": .env is off limits');
	},
);

test.serial('a hook that exits non-zero silently still blocks', async t => {
	withHooks({'pre-tool-use': [{command: node('process.exit(1)')}]});

	const outcome = await runLifecycleHooks('pre-tool-use', {
		toolName: 'execute_bash',
	});

	t.true(outcome.blocked);
	t.regex(String(outcome.reason), /exit 1/);
});

test.serial('matchTools scopes a hook to the named tools', async t => {
	withHooks({
		'post-tool-use': [
			{
				matchTools: ['write_file', 'string_replace'],
				command: node("console.log('ran')"),
			},
		],
	});

	const matched = await runLifecycleHooks('post-tool-use', {
		toolName: 'string_replace',
	});
	const skipped = await runLifecycleHooks('post-tool-use', {
		toolName: 'read_file',
	});

	t.is(matched.output, 'ran');
	t.is(skipped.output, '');
});

test.serial('a non-zero exit on an observe-only event never blocks', async t => {
	withHooks({
		'post-tool-use': [
			{command: node("console.log('warned');process.exit(1)")},
			{command: node("console.log('still ran')")},
		],
	});

	const outcome = await runLifecycleHooks('post-tool-use', {
		toolName: 'write_file',
	});

	t.false(outcome.blocked);
	// The failing hook contributes nothing; the next one still runs.
	t.is(outcome.output, 'still ran');
});

test.serial('a hook that times out does not block the action', async t => {
	withHooks({
		'pre-tool-use': [
			{name: 'slow', command: node('setTimeout(()=>{},400)'), timeout: 50},
		],
	});

	const outcome = await runLifecycleHooks('pre-tool-use', {
		toolName: 'execute_bash',
	});

	t.false(outcome.blocked, 'a hanging script must not wedge the agent');
	t.is(outcome.output, '');
});

test.serial('a hook naming a missing binary blocks like any non-zero exit', async t => {
	withHooks({
		'pre-tool-use': [{command: 'nanocoder-definitely-not-a-real-binary'}],
	});

	const outcome = await runLifecycleHooks('pre-tool-use', {
		toolName: 'execute_bash',
	});

	// The shell itself starts fine and exits non-zero ("command not found"),
	// which is indistinguishable from a deliberate veto. Pinned so a change to
	// it has to be a deliberate one.
	t.true(outcome.blocked);
});

test.serial('hook context reaches the command as NANOCODER_* env vars', async t => {
	withHooks({
		'post-tool-use': [
			{
				command: node(
					"console.log([process.env.NANOCODER_HOOK_EVENT,process.env.NANOCODER_TOOL_NAME,process.env.NANOCODER_FILE,process.env.NANOCODER_TOOL_ARGS].join('|'))",
				),
			},
		],
	});

	const outcome = await runLifecycleHooks('post-tool-use', {
		toolName: 'write_file',
		toolArgs: {path: 'src/app.ts', content: 'x'},
	});

	t.is(
		outcome.output,
		'post-tool-use|write_file|src/app.ts|{"path":"src/app.ts","content":"x"}',
	);
});

test.serial('every hook gets the session id and working directory', async t => {
	withHooks({
		'session-end': [
			{
				command: node(
					"console.log(process.env.NANOCODER_SESSION_ID === undefined ? 'missing' : 'present', process.env.NANOCODER_CWD === undefined ? 'missing' : 'present')",
				),
			},
		],
	});

	const outcome = await runLifecycleHooks('session-end');

	t.is(outcome.output, 'present present');
});

test.serial('execute_bash exposes its command as NANOCODER_COMMAND', async t => {
	withHooks({
		'pre-tool-use': [
			{
				matchTools: ['execute_bash'],
				command: node('console.log(process.env.NANOCODER_COMMAND)'),
			},
		],
	});

	const outcome = await runLifecycleHooks('pre-tool-use', {
		toolName: 'execute_bash',
		toolArgs: {command: 'git push origin main'},
	});

	t.is(outcome.output, 'git push origin main');
});

test.serial('user-prompt-submit can veto a prompt', async t => {
	withHooks({
		'user-prompt-submit': [
			{name: 'guard', command: node("console.log('nope');process.exit(1)")},
		],
	});

	const outcome = await runLifecycleHooks('user-prompt-submit', {
		prompt: 'ship it',
	});

	t.true(outcome.blocked);
	t.is(outcome.reason, 'Blocked by hook "guard": nope');
});

test.serial('hooks run in config order and their output is joined', async t => {
	withHooks({
		'session-start': [
			{command: node("console.log('first')")},
			{command: node("console.log('second')")},
		],
	});

	const outcome = await runLifecycleHooks('session-start');

	t.is(outcome.output, 'first\nsecond');
});

test.serial('pending hook context buffers and drains once', t => {
	addPendingHookContext('  branch: main  ');
	addPendingHookContext('');
	addPendingHookContext('docker: 2 containers');

	t.is(takePendingHookContext(), 'branch: main\n\ndocker: 2 containers');
	t.is(takePendingHookContext(), '', 'draining is destructive');

	addPendingHookContext('dropped');
	clearPendingHookContext();
	t.is(takePendingHookContext(), '');
});

test.serial('invalid hook entries are dropped, valid ones survive', t => {
	withHooks({
		// biome-ignore lint/suspicious/noExplicitAny: deliberately malformed config
		'pre-tool-use': [
			{command: ''},
			{notACommand: true},
			'a bare string',
			{command: 'echo ok', timeout: 2.6, name: '  named  '},
			// biome-ignore lint/suspicious/noExplicitAny: deliberately malformed config
		] as any,
		// biome-ignore lint/suspicious/noExplicitAny: unknown event must be ignored
		'not-a-real-event': [{command: 'echo nope'}] as any,
	});

	const hooks = getConfiguredHooks('pre-tool-use');
	t.is(hooks.length, 1);
	t.is(hooks[0].command, 'echo ok');
	t.is(hooks[0].timeout, 3, 'timeouts are rounded to whole milliseconds');
	t.is(hooks[0].name, 'named');
});

test.serial('a hook command keeps its $VAR references unexpanded', t => {
	withHooks({
		'post-tool-use': [{command: 'biome check --write $NANOCODER_FILE'}],
	});

	// Config-time env substitution would blank this out before the shell ever
	// sees it, breaking the headline auto-format example.
	t.is(
		getConfiguredHooks('post-tool-use')[0].command,
		'biome check --write $NANOCODER_FILE',
	);
});

// --- Integration: the gate inside processToolUse -----------------------------
// The engine above is only useful if the tool path actually consults it, so
// pin both directions through the real `processToolUse`.

const writeFileCall: ToolCall = {
	id: 'call-1',
	function: {name: 'write_file', arguments: {path: '.env', content: 'x'}},
};

test.serial('a pre-tool-use veto stops the handler from running', async t => {
	let handlerRan = false;
	setToolRegistryGetter(() => ({
		write_file: async () => {
			handlerRan = true;
			return 'wrote .env';
		},
	}));
	withHooks({
		'pre-tool-use': [
			{
				name: 'no-env',
				matchTools: ['write_file'],
				command: node("console.log('.env is off limits');process.exit(1)"),
			},
		],
	});

	const result = await processToolUse(writeFileCall);

	t.false(handlerRan, 'the tool must not execute after a veto');
	t.true(result.isError);
	t.is(result.content, 'Error: Blocked by hook "no-env": .env is off limits');
});

test.serial('post-tool-use stdout is folded into the tool result', async t => {
	setToolRegistryGetter(() => ({
		write_file: async () => 'wrote 1 file',
	}));
	withHooks({
		'post-tool-use': [
			{matchTools: ['write_file'], command: node("console.log('formatted')")},
		],
	});

	const result = await processToolUse(writeFileCall);

	t.is(
		result.content,
		'wrote 1 file\n\n<hook-output event="post-tool-use">\nformatted\n</hook-output>',
	);
});

test.serial('a tool with no matching hooks is untouched', async t => {
	setToolRegistryGetter(() => ({
		write_file: async () => 'wrote 1 file',
	}));
	withHooks({
		'post-tool-use': [
			{matchTools: ['execute_bash'], command: node("console.log('nope')")},
		],
	});

	const result = await processToolUse(writeFileCall);

	t.is(result.content, 'wrote 1 file');
	t.falsy(result.isError);
});
