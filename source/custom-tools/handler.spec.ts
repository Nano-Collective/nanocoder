import {mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {buildHandler, expandVars, mergeEnv, resolveCwd, runScript} from './handler';
import type {CustomToolMetadata} from '@/types/custom-tools';

console.log('\ncustom-tools/handler.spec.ts');

let testDir: string;

test.before(() => {
	testDir = join(tmpdir(), `nanocoder-custom-tools-handler-${Date.now()}`);
	mkdirSync(testDir, {recursive: true});
});

test.after.always(() => {
	if (testDir) rmSync(testDir, {recursive: true, force: true});
});

function meta(extra: Partial<CustomToolMetadata> = {}): CustomToolMetadata {
	return {
		name: 't',
		description: 't',
		parameters: {},
		approval: 'never',
		readOnly: true,
		timeoutMs: 5_000,
		...extra,
	};
}

test('expandVars replaces $VAR and ${VAR}', t => {
	const prev = process.env.NCT_FOO;
	process.env.NCT_FOO = 'bar';
	t.is(expandVars('$NCT_FOO/x'), 'bar/x');
	t.is(expandVars('${NCT_FOO}-y'), 'bar-y');
	t.is(expandVars('${NCT_MISSING:-fallback}'), 'fallback');
	t.is(expandVars('${NCT_MISSING}'), '');
	if (prev === undefined) delete process.env.NCT_FOO;
	else process.env.NCT_FOO = prev;
});

test('mergeEnv overlays configured vars onto process.env', t => {
	const env = mergeEnv({CUSTOM_VAR: 'value'});
	t.is(env.CUSTOM_VAR, 'value');
	t.truthy(env.PATH);
});

test('resolveCwd handles missing paths by falling back to projectRoot', t => {
	const projectRoot = '/tmp';
	t.is(resolveCwd('/definitely/not/a/path/abc123', projectRoot), projectRoot);
	t.is(resolveCwd(undefined, projectRoot), projectRoot);
});

test('runScript: captures stdout', async t => {
	const result = await runScript(`echo 'hello world'`, {
		cwd: testDir,
		env: process.env,
		shell: '/bin/sh',
		timeoutMs: 5_000,
	});
	t.is(result, 'EXIT_CODE: 0\nhello world');
});

test('runScript: non-zero exit returns output with EXIT_CODE prefix', async t => {
	const result = await runScript(`echo oops >&2; exit 3`, {
		cwd: testDir,
		env: process.env,
		shell: '/bin/sh',
		timeoutMs: 5_000,
	});
	// Non-zero exits are normal for many CLIs (audit, grep --quiet, git diff
	// --exit-code, test runners) and should not be surfaced as tool failures.
	t.regex(result, /^EXIT_CODE: 3\nSTDERR:\noops\nSTDOUT:\n$/);
});

test('runScript: audit-style non-zero exit with stdout output', async t => {
	// Mirrors `pnpm audit`: vulnerabilities go to stdout, exit code 1.
	const result = await runScript(
		`printf 'vulnerability table here\\n'; exit 1`,
		{
			cwd: testDir,
			env: process.env,
			shell: '/bin/sh',
			timeoutMs: 5_000,
		},
	);
	t.is(result, 'EXIT_CODE: 1\nvulnerability table here');
});

test('runScript: zero exit returns stdout with EXIT_CODE prefix', async t => {
	const result = await runScript(`echo hello`, {
		cwd: testDir,
		env: process.env,
		shell: '/bin/sh',
		timeoutMs: 5_000,
	});
	// Matches execute_bash: EXIT_CODE: 0 is always included so the LLM can
	// reason about success uniformly across tools.
	t.is(result, 'EXIT_CODE: 0\nhello');
});

test('runScript: timeout kills long-running script', async t => {
	await t.throwsAsync(
		runScript(`sleep 5`, {
			cwd: testDir,
			env: process.env,
			shell: '/bin/sh',
			timeoutMs: 100,
		}),
		{message: /timed out/},
	);
});

test('buildHandler renders body and executes', async t => {
	const handler = buildHandler(meta(), `echo {{ name }}`, testDir);
	const result = await handler({name: 'world'});
	t.is(result, 'EXIT_CODE: 0\nworld');
});

test('buildHandler: shell-escape blocks injection', async t => {
	const handler = buildHandler(meta(), `echo {{ payload }}`, testDir);
	// If quoting were broken, the inner `; ls` would run separately and
	// stdout would not contain the literal payload.
	const result = await handler({payload: `; ls / ; echo done`});
	t.is(result, 'EXIT_CODE: 0\n; ls / ; echo done');
});

test('buildHandler honors env merging', async t => {
	const handler = buildHandler(
		meta({env: {NCT_CUSTOM_HANDLER_TEST: 'hello-env'}}),
		`echo "$NCT_CUSTOM_HANDLER_TEST"`,
		testDir,
	);
	const result = await handler({});
	t.is(result, 'EXIT_CODE: 0\nhello-env');
});
