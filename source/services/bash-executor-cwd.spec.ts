import {mkdirSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {platform} from 'node:process';
import test from 'ava';
import {bashExecutor} from './bash-executor.js';
import {getSessionCwd, resetSessionCwd, setSessionCwd} from './session-cwd.js';

console.log('\nservices/bash-executor-cwd.spec.ts');

const run = (cmd: string) => bashExecutor.execute(cmd).promise;
const printCwd = platform === 'win32' ? 'cd' : 'pwd';

test.serial('cd persists to the session cwd and the next command runs there', async t => {
	// realpath: `pwd -P` reports the symlink-resolved path (e.g. /private on macOS).
	const base = realpathSync(mkdtempSync(join(tmpdir(), 'nc-bash-')));
	const sub = join(base, 'nested');
	mkdirSync(sub);
	try {
		setSessionCwd(base);
		await run('cd nested');
		t.is(getSessionCwd(), sub, 'cd updated the shared session cwd');
		const r = await run(printCwd);
		t.is(r.fullOutput.trim(), sub, 'the following command spawned in the new dir');
	} finally {
		resetSessionCwd();
		rmSync(base, {recursive: true, force: true});
	}
});

test.serial('a failed cd leaves the session cwd untouched', async t => {
	const base = realpathSync(mkdtempSync(join(tmpdir(), 'nc-bash-')));
	try {
		setSessionCwd(base);
		const r = await run('cd /definitely/not/a/real/dir');
		t.not(r.exitCode, 0, 'the cd itself failed');
		t.is(getSessionCwd(), base, 'a failed cd must not move the session cwd');
	} finally {
		resetSessionCwd();
		rmSync(base, {recursive: true, force: true});
	}
});

test.serial('cd sub && cd updates the session cwd on Windows', async t => {
	if (platform !== 'win32') {
		t.pass('Windows-only cwd capture test');
		return;
	}
	const base = realpathSync(mkdtempSync(join(tmpdir(), 'nc-bash-win-')));
	const sub = join(base, 'sub');
	mkdirSync(sub);
	try {
		setSessionCwd(base);
		const r = await run('cd sub && cd');
		t.is(r.exitCode, 0, 'the command succeeded');
		t.true(
			r.fullOutput.trim().endsWith('sub'),
			'the shell printed the new directory',
		);
		t.is(getSessionCwd(), sub, 'cd reached the shared session cwd');
	} finally {
		resetSessionCwd();
		rmSync(base, {recursive: true, force: true});
	}
});

test.serial('Windows cwd capture preserves the command exit code', async t => {
	if (platform !== 'win32') {
		t.pass('Windows-only cwd capture test');
		return;
	}
	const base = realpathSync(mkdtempSync(join(tmpdir(), 'nc-bash-win-exit-')));
	try {
		setSessionCwd(base);
		const r = await run('cmd /c exit 7');
		t.is(r.exitCode, 7, 'the epilogue must not replace the command result');
		t.is(getSessionCwd(), base, 'no cd means no cwd change');
	} finally {
		resetSessionCwd();
		rmSync(base, {recursive: true, force: true});
	}
});

test.serial('a command that reads stdin gets EOF instead of hanging', async t => {
	if (platform === 'win32') {
		t.pass('stdin handling is checked on unix only');
		return;
	}
	let timer: NodeJS.Timeout | undefined;
	const result = await Promise.race([
		run('cat; echo done'),
		new Promise<'hung'>(resolve => {
			timer = setTimeout(() => resolve('hung'), 5000);
		}),
	]);
	clearTimeout(timer);
	t.not(result, 'hung', 'cat returned instead of waiting on an open stdin pipe');
	if (result !== 'hung') t.regex(result.fullOutput, /done/);
});
