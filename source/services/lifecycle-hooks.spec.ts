import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {clearAppConfig, reloadAppConfig} from '@/config/index';
import {processToolUse, setToolRegistryGetter} from '@/message-handler';
import {setProjectRoot, setSessionCwd} from '@/services/session-cwd';
import type {HooksConfig} from '@/types/config';
import type {ToolCall} from '@/types/core';
import {truncateToolResult} from '@/utils/truncate-tool-result';
import {
	addPendingHookContext,
	beginSessionStartHooks,
	clearPendingHookContext,
	drainPendingHookContext,
	getConfiguredHooks,
	resetSessionStartHooks,
	runLifecycleHooks,
	runPreToolUseGate,
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
	resetSessionStartHooks();
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

test.serial('pending hook context buffers and drains once', async t => {
	addPendingHookContext('  branch: main  ');
	addPendingHookContext('');
	addPendingHookContext('docker: 2 containers');

	t.is(
		await takePendingHookContext(),
		'branch: main\n\ndocker: 2 containers',
	);
	t.is(await takePendingHookContext(), '', 'draining is destructive');

	addPendingHookContext('dropped');
	clearPendingHookContext();
	t.is(await takePendingHookContext(), '');
	t.is(drainPendingHookContext(), '', 'the sync drain agrees');
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

// A fresh object per test on purpose: runPreToolUseGate suppresses repeat runs
// per tool-call object, so a shared fixture would carry "already gated" from
// one test into the next.
const writeFileCall = (path = '.env'): ToolCall => ({
	id: 'call-1',
	function: {name: 'write_file', arguments: {path, content: 'x'}},
});

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

	const result = await processToolUse(writeFileCall());

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

	const result = await processToolUse(writeFileCall());

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

	const result = await processToolUse(writeFileCall());

	t.is(result.content, 'wrote 1 file');
	t.falsy(result.isError);
});

// ---------------------------------------------------------------------------
// Review follow-ups: the gate's once-per-call contract, post-tool-use on
// failure, the session-end budget, hook cwd, and the truncation cap.
// ---------------------------------------------------------------------------

test.serial(
	'post-tool-use fires when the tool throws, not just when it returns',
	async t => {
		setToolRegistryGetter(() => ({
			write_file: async () => {
				throw new Error('disk full');
			},
		}));
		withHooks({
			'post-tool-use': [{command: node("console.log('audited')")}],
		});

		const result = await processToolUse(writeFileCall());

		t.true(result.isError, 'the failure is still reported as an error');
		t.true(
			String(result.content).includes('disk full'),
			'the original error survives',
		);
		t.true(
			String(result.content).includes('<hook-output event="post-tool-use">'),
			'an audit-log hook must see the failed call too',
		);
		t.true(String(result.content).includes('audited'));
	},
);

test.serial('post-tool-use sees a malformed-arguments failure', async t => {
	setToolRegistryGetter(() => ({
		write_file: async () => 'never runs',
	}));
	withHooks({
		'post-tool-use': [
			{
				command: node(
					"console.log(process.env.NANOCODER_TOOL_NAME + ':failed')",
				),
			},
		],
	});

	// Strict parsing rejects this before the handler is ever reached.
	const result = await processToolUse({
		id: 'call-bad',
		function: {name: 'write_file', arguments: '{not json'},
	});

	t.true(result.isError);
	t.true(String(result.content).includes('write_file:failed'));
});

test.serial('a pre-tool-use veto suppresses post-tool-use', async t => {
	setToolRegistryGetter(() => ({
		write_file: async () => 'wrote .env',
	}));
	withHooks({
		'pre-tool-use': [
			{name: 'no-env', command: node("console.log('denied');process.exit(1)")},
		],
		'post-tool-use': [{command: node("console.log('should-not-run')")}],
	});

	const result = await processToolUse(writeFileCall());

	t.true(result.isError);
	t.false(
		String(result.content).includes('should-not-run'),
		'the tool never ran, so there is nothing to observe afterwards',
	);
});

test.serial('the pre-tool-use gate runs once per tool call', async t => {
	const counterFile = join(testDir, 'gate-count.txt');
	if (existsSync(counterFile)) rmSync(counterFile);
	setToolRegistryGetter(() => ({
		write_file: async () => 'wrote 1 file',
	}));
	withHooks({
		'pre-tool-use': [
			{
				command: node(
					`require('fs').appendFileSync(${JSON.stringify(
						JSON.stringify(counterFile),
					)},'x')`,
				),
			},
		],
	});

	// The same object every layer sees: the conversation loop gates it before
	// the approval prompt, then processToolUse gates it again at the execution
	// boundary. The hook itself must fire exactly once.
	const toolCall = writeFileCall('src/app.ts');
	const first = await runPreToolUseGate(toolCall, {path: 'src/app.ts'});
	const second = await runPreToolUseGate(toolCall, {path: 'src/app.ts'});
	await processToolUse(toolCall);

	t.false(first.blocked);
	t.false(second.blocked);
	t.is(
		readFileSync(counterFile, 'utf-8'),
		'x',
		'a hook with side effects must not run once per layer',
	);
});

test.serial('a distinct tool call is gated on its own', async t => {
	withHooks({
		'pre-tool-use': [
			{name: 'deny', command: node("console.log('no');process.exit(1)")},
		],
	});

	const first = await runPreToolUseGate(
		{id: 'a', function: {name: 'read_file', arguments: {}}},
		{},
	);
	const other = await runPreToolUseGate(
		{id: 'b', function: {name: 'read_file', arguments: {}}},
		{},
	);

	t.true(first.blocked, 'the first call is refused');
	t.true(other.blocked, 'and so is a different call — no leaked pass');
});

test.serial(
	'session-end defaults to a timeout inside the shutdown budget',
	async t => {
		// The shutdown manager races every handler against one 5s budget and
		// then exits, so a session-end hook leaning on the general 30s default
		// would never finish. 2s leaves the rest of the shutdown room to run.
		withHooks({
			'session-end': [{command: node('setTimeout(()=>{},10000)')}],
		});

		const started = Date.now();
		const outcome = await runLifecycleHooks('session-end');
		const elapsed = Date.now() - started;

		t.false(outcome.blocked, 'a timeout is never a veto');
		t.true(
			elapsed < 5000,
			`session-end must give up inside the shutdown budget (took ${elapsed}ms)`,
		);
	},
);

test.serial(
	'an explicit timeout still overrides the session-end default',
	async t => {
		withHooks({
			'session-end': [
				{command: node('setTimeout(()=>{},10000)'), timeout: 300},
			],
		});

		const started = Date.now();
		await runLifecycleHooks('session-end');

		t.true(Date.now() - started < 2000);
	},
);

test.serial('hooks run from the project root, not the session cwd', async t => {
	const deeper = join(testDir, 'nested');
	mkdirSync(deeper, {recursive: true});
	setProjectRoot(testDir);
	// What a bash `cd` into a subdirectory does. A hook defined in project
	// config must keep resolving its relative paths regardless.
	setSessionCwd(deeper);

	withHooks({
		'session-start': [{command: node('console.log(process.cwd())')}],
	});

	const outcome = await runLifecycleHooks('session-start');

	t.is(
		realpathSync(outcome.output),
		realpathSync(testDir),
		'a relative hook command must not follow the model around',
	);
	setSessionCwd(testDir);
});

test.serial('NANOCODER_SESSION_CWD still reports where the shell is', async t => {
	const deeper = join(testDir, 'nested');
	mkdirSync(deeper, {recursive: true});
	setProjectRoot(testDir);
	setSessionCwd(deeper);

	withHooks({
		'session-start': [
			{command: node('console.log(process.env.NANOCODER_SESSION_CWD)')},
		],
	});

	const outcome = await runLifecycleHooks('session-start');

	t.is(realpathSync(outcome.output), realpathSync(deeper));
	setSessionCwd(testDir);
});

test.serial(
	'a chatty post-tool-use hook cannot breach the result cap',
	async t => {
		setToolRegistryGetter(() => ({
			write_file: async () => 'wrote 1 file',
		}));
		withHooks({
			'post-tool-use': [
				// Well past MAX_HOOK_OUTPUT_CHARS so both the capture cap and the
				// result cap are exercised.
				{command: node("console.log('z'.repeat(40000))")},
			],
		});

		const result = await processToolUse(writeFileCall());
		const cap = truncateToolResult('y'.repeat(500_000)).length;

		t.true(
			String(result.content).length <= cap,
			'the joined result is re-truncated, not appended past the limit',
		);
	},
);

test.serial('session-start context waits for a slow hook', async t => {
	withHooks({
		'session-start': [
			{command: node("setTimeout(()=>console.log('late context'),150)")},
		],
	});

	// Exactly the race a fast typist creates: init kicks the hook off without
	// awaiting it, and the first prompt drains the buffer immediately.
	void beginSessionStartHooks();
	const context = await takePendingHookContext();

	t.is(
		context,
		'late context',
		'the context lands on prompt one, not prompt two',
	);
});

test.serial(
	'/clear drops context from a session-start still in flight',
	async t => {
		withHooks({
			'session-start': [
				{command: node("setTimeout(()=>console.log('stale'),150)")},
			],
		});

		const run = beginSessionStartHooks();
		clearPendingHookContext();
		await run;

		t.is(
			drainPendingHookContext(),
			'',
			'output belonging to the cleared conversation must not carry over',
		);
	},
);
