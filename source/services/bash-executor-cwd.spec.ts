import {mkdirSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {platform} from 'node:process';
import test from 'ava';
import {bashExecutor} from './bash-executor.js';
import {getSessionCwd, resetSessionCwd, setSessionCwd} from './session-cwd.js';

console.log('\nservices/bash-executor-cwd.spec.ts');

const run = (cmd: string) => bashExecutor.execute(cmd).promise;

test.serial('cd persists to the session cwd and the next command runs there', async t => {
	if (platform === 'win32') {
		t.pass('cd-persistence is unix-only for now');
		return;
	}
	// realpath: `pwd -P` reports the symlink-resolved path (e.g. /private on macOS).
	const base = realpathSync(mkdtempSync(join(tmpdir(), 'nc-bash-')));
	const sub = join(base, 'nested');
	mkdirSync(sub);
	try {
		setSessionCwd(base);
		await run('cd nested');
		t.is(getSessionCwd(), sub, 'cd updated the shared session cwd');
		const r = await run('pwd');
		t.is(r.fullOutput.trim(), sub, 'the following command spawned in the new dir');
	} finally {
		resetSessionCwd();
		rmSync(base, {recursive: true, force: true});
	}
});

test.serial('a failed cd leaves the session cwd untouched', async t => {
	if (platform === 'win32') {
		t.pass('cd-persistence is unix-only for now');
		return;
	}
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
