import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {platform} from 'node:process';
import test, {type ExecutionContext} from 'ava';
import {getAppConfig} from '@/config/index';
import {BashExecutor} from './bash-executor.js';
import {findBwrap} from './bash-sandbox.js';
import {getSessionCwd, resetSessionCwd, setProjectRoot, setSessionCwd} from './session-cwd.js';

console.log('\nbash-executor-sandbox.spec.ts');

const executors: BashExecutor[] = [];

function createExecutor(): BashExecutor {
	const executor = new BashExecutor();
	executors.push(executor);
	return executor;
}

test.afterEach(() => {
	for (const executor of executors) {
		for (const id of executor.getActiveExecutionIds()) {
			executor.cancel(id);
		}
		executor.removeAllListeners();
	}
	executors.length = 0;
	resetSessionCwd();
});

test.serial('sandbox off keeps the unix spawn on sh', async t => {
	if (platform === 'win32') {
		t.pass();
		return;
	}
	const previous = getAppConfig().sandbox;
	getAppConfig().sandbox = false;
	try {
		const executor = createExecutor();
		const result = await executor.execute('echo unsandboxed').promise;
		t.is(result.exitCode, 0);
		t.true(result.fullOutput.includes('unsandboxed'));
		t.is(result.error, null);
	} finally {
		getAppConfig().sandbox = previous;
	}
});

test.serial('unsandboxed commands keep empty positional args', async t => {
	if (platform === 'win32') {
		t.pass();
		return;
	}
	const previous = getAppConfig().sandbox;
	getAppConfig().sandbox = false;
	try {
		const executor = createExecutor();
		const result = await executor.execute('echo count=$# one="${1-}"').promise;
		t.is(result.exitCode, 0);
		t.is(result.fullOutput.trim(), 'count=0 one=');
	} finally {
		getAppConfig().sandbox = previous;
	}
});

test.serial('sandbox on windows returns an error', async t => {
	if (platform !== 'win32') {
		t.pass();
		return;
	}
	const previous = getAppConfig().sandbox;
	getAppConfig().sandbox = true;
	try {
		const result = await createExecutor().execute('echo hi').promise;
		t.truthy(result.error);
		t.regex(result.error ?? '', /not supported on Windows/i);
	} finally {
		getAppConfig().sandbox = previous;
	}
});

test.serial('sandbox on linux without bwrap on PATH does not fall through', async t => {
	if (platform !== 'linux') {
		t.pass();
		return;
	}
	const previous = getAppConfig().sandbox;
	const prevPath = process.env.PATH;
	getAppConfig().sandbox = true;
	process.env.PATH = '';
	try {
		const result = await createExecutor().execute('echo hi').promise;
		t.truthy(result.error);
		t.regex(result.error ?? '', /bubblewrap/i);
		t.is(result.fullOutput, '');
	} finally {
		getAppConfig().sandbox = previous;
		if (prevPath === undefined) delete process.env.PATH;
		else process.env.PATH = prevPath;
	}
});

async function assertJail(t: ExecutionContext, label: string) {
	const previous = getAppConfig().sandbox;
	const base = realpathSync(mkdtempSync(join(tmpdir(), 'nc-jail-')));
	const probe = join(homedir(), `.nanocoder-sandbox-probe-${Date.now()}`);
	getAppConfig().sandbox = true;
	setProjectRoot(base);
	setSessionCwd(base);
	try {
		const executor = createExecutor();
		const inside = await executor.execute('echo ok > inside.txt').promise;
		t.is(inside.exitCode, 0, `${label} inside: ${inside.stderr || inside.error || ''}`);
		t.is(readFileSync(join(base, 'inside.txt'), 'utf8').trim(), 'ok');

		const tmpWrite = await executor.execute(
			'echo tmpok > "$TMPDIR/probe" && cat "$TMPDIR/probe"',
		).promise;
		t.is(tmpWrite.exitCode, 0, `${label} tmp: ${tmpWrite.stderr || tmpWrite.error || ''}`);
		t.true(tmpWrite.fullOutput.includes('tmpok'));

		const mk = await executor.execute('mktemp').promise;
		t.is(mk.exitCode, 0, `${label} mktemp: ${mk.stderr || mk.error || ''}`);

		const outside = await executor.execute(`echo no > '${probe}'`).promise;
		t.false(existsSync(probe), 'sandbox must not write into $HOME');
		t.true(
			outside.exitCode !== 0 || Boolean(outside.stderr) || Boolean(outside.error),
		);

		const nested = join(base, 'nested');
		mkdirSync(nested);
		await executor.execute('cd nested').promise;
		t.is(getSessionCwd(), nested);
	} finally {
		getAppConfig().sandbox = previous;
		try {
			if (existsSync(probe)) rmSync(probe);
		} catch {
			// best-effort cleanup
		}
		rmSync(base, {recursive: true, force: true});
	}
}

test.serial('sandbox on macOS writes inside the project and TMPDIR, blocks home', async t => {
	if (platform !== 'darwin') {
		t.pass();
		return;
	}
	await assertJail(t, 'darwin');
});

test.serial('sandbox on linux with bwrap writes inside the project and TMPDIR, blocks home', async t => {
	if (platform !== 'linux' || !findBwrap()) {
		t.pass();
		return;
	}
	await assertJail(t, 'linux');
});
