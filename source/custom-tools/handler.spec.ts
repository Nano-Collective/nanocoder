import {chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test, {type ExecutionContext} from 'ava';
import {
	buildHandler,
	expandVars,
	mergeEnv,
	resolveCwd,
	runScript,
	shellArgs,
} from './handler';
import type {CustomToolMetadata} from '@/types/custom-tools';

console.log('\ncustom-tools/handler.spec.ts');

let testDir: string;
let prevLcAll: string | undefined;
let prevLang: string | undefined;

test.before(() => {
	testDir = join(tmpdir(), `nanocoder-custom-tools-handler-${Date.now()}`);
	mkdirSync(testDir, {recursive: true});
	// CI images often advertise a locale (e.g. en-US.UTF-8) that isn't actually
	// installed, so bash prints a setlocale warning to stderr on every invocation
	// and pollutes assertions on exact output. Force a known-present locale.
	prevLcAll = process.env.LC_ALL;
	prevLang = process.env.LANG;
	process.env.LC_ALL = 'C';
	process.env.LANG = 'C';
});

test.after.always(() => {
	if (testDir) rmSync(testDir, {recursive: true, force: true});
	if (prevLcAll === undefined) delete process.env.LC_ALL;
	else process.env.LC_ALL = prevLcAll;
	if (prevLang === undefined) delete process.env.LANG;
	else process.env.LANG = prevLang;
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

test('shellArgs uses /d /s /c for cmd.exe and -c for posix shells', t => {
	t.deepEqual(shellArgs('cmd.exe', 'echo hi'), ['/d', '/s', '/c', 'echo hi']);
	t.deepEqual(shellArgs('cmd', 'echo hi'), ['/d', '/s', '/c', 'echo hi']);
	t.deepEqual(shellArgs('C:\\Windows\\System32\\cmd.exe', 'echo hi'), [
		'/d',
		'/s',
		'/c',
		'echo hi',
	]);
	t.deepEqual(shellArgs('/bin/sh', 'echo hi'), ['-c', 'echo hi']);
	t.deepEqual(shellArgs('/bin/bash', 'echo hi'), ['-c', 'echo hi']);
});

// Prove runScript forwards shellArgs, not a hardcoded -c. A POSIX script
// named cmd.exe is enough: isWindowsCmd keys off the basename.
const spawnArgTest = process.platform === 'win32' ? test.skip : test;
spawnArgTest('runScript passes shellArgs argv into spawn', async t => {
	const bin = join(testDir, 'cmd.exe');
	writeFileSync(bin, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
	chmodSync(bin, 0o755);
	const result = await runScript('echo hi', {
		cwd: testDir,
		env: process.env,
		shell: bin,
		timeoutMs: 5_000,
	});
	t.is(result, 'EXIT_CODE: 0\n/d\n/s\n/c\necho hi');
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

// Creating a directory symlink on Windows needs elevated privileges or
// developer mode, so the symlink cases can't run there. CI is Linux-only; this
// keeps the suite green for Windows contributors running it locally.
const symlinkTest = process.platform === 'win32' ? test.skip : test;

let tempCounter = 0;

// Each case needs its own throwaway tree. Returns a unique dir under tmpdir
// registered for teardown; `label` only exists to make a stray leftover
// directory traceable to the test that made it.
function tempDir(t: ExecutionContext, label: string): string {
	const dir = join(
		tmpdir(),
		`nanocoder-custom-tools-${label}-${Date.now()}-${tempCounter++}`,
	);
	mkdirSync(dir, {recursive: true});
	t.teardown(() => rmSync(dir, {recursive: true, force: true}));
	return dir;
}

const ESCAPES = /escapes the project directory/;

test('resolveCwd keeps an in-project relative directory', t => {
	const root = tempDir(t, 'cwd-in');
	mkdirSync(join(root, 'scripts'), {recursive: true});
	t.is(resolveCwd('./scripts', root), resolve(root, 'scripts'));
});

test('resolveCwd keeps the project root itself', t => {
	const root = tempDir(t, 'cwd-dot');
	t.is(resolveCwd('.', root), root);
});

symlinkTest('resolveCwd throws when cwd is a symlink out of the project', t => {
	const root = tempDir(t, 'cwd-link');
	const outside = tempDir(t, 'cwd-out');
	symlinkSync(outside, join(root, 'scripts'));
	t.throws(() => resolveCwd('./scripts', root), {message: ESCAPES});
});

symlinkTest(
	'resolveCwd throws when a parent segment of cwd is a symlink out of the project',
	t => {
		const root = tempDir(t, 'cwd-deep-link');
		const outside = tempDir(t, 'cwd-deep-out');
		mkdirSync(join(outside, 'scripts'), {recursive: true});
		mkdirSync(join(root, 'nested'), {recursive: true});
		symlinkSync(outside, join(root, 'nested', 'link'));
		t.throws(() => resolveCwd('./nested/link/scripts', root), {
			message: ESCAPES,
		});
	},
);

test('resolveCwd throws for an absolute path outside the project', t => {
	const root = tempDir(t, 'cwd-root');
	const outside = tempDir(t, 'cwd-abs');
	t.throws(() => resolveCwd(outside, root), {message: ESCAPES});
});

test('resolveCwd throws for a ../ traversal out of the project', t => {
	const root = tempDir(t, 'cwd-traversal');
	mkdirSync(join(root, 'scripts'), {recursive: true});
	t.throws(() => resolveCwd('../', root), {message: ESCAPES});
});

test('resolveCwd throws for a sibling directory sharing the root prefix', t => {
	// `/proj-evil` must not pass containment for project `/proj`: the guard is
	// the trailing separator in the prefix comparison.
	const root = tempDir(t, 'cwd-sibling');
	const sibling = `${root}-evil`;
	mkdirSync(sibling, {recursive: true});
	t.teardown(() => rmSync(sibling, {recursive: true, force: true}));
	t.throws(() => resolveCwd(sibling, root), {message: ESCAPES});
});

test('resolveCwd throws for ${HOME} outside the project', t => {
	const root = tempDir(t, 'cwd-home-root');
	const fakeHome = tempDir(t, 'home');
	const prev = process.env.HOME;
	t.teardown(() => {
		if (prev === undefined) delete process.env.HOME;
		else process.env.HOME = prev;
	});
	process.env.HOME = fakeHome;
	t.throws(() => resolveCwd('${HOME}', root), {message: ESCAPES});
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

// A script that traps SIGTERM must still be force-killed. Guarding the
// escalation on `child.killed` never fired (Node sets that flag the moment
// SIGTERM is delivered), so the shell survived and 'close' - and with it the
// rejection - waited on the full `sleep`. `sleep`'s stdio is redirected so it
// does not hold our pipes open past the shell's death.
test('runScript: escalates to SIGKILL when the script ignores SIGTERM', async t => {
	const started = Date.now();
	await t.throwsAsync(
		runScript(`trap '' TERM; sleep 5 >/dev/null 2>&1`, {
			cwd: testDir,
			env: process.env,
			shell: '/bin/sh',
			timeoutMs: 100,
		}),
		{message: /timed out/},
	);
	// SIGTERM at 100ms + a 1s grace window. Without escalation this only
	// settles once `sleep 5` finishes.
	t.true(Date.now() - started < 3_000);
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
