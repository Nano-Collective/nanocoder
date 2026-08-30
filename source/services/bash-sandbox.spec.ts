import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {platform} from 'node:process';
import test from 'ava';
import {
	findBwrap,
	macSandboxProfile,
	planBashSpawn,
} from './bash-sandbox.js';

console.log('\nbash-sandbox.spec.ts');

test('planBashSpawn off on unix is sh -c, detached', t => {
	const plan = planBashSpawn({
		platform: 'darwin',
		sandbox: false,
		command: 'echo hi',
		spawnCommand: 'echo hi\n\nexit 0',
		cwd: '/tmp/proj',
		projectRoot: '/tmp/proj',
	});
	if ('error' in plan) {
		t.fail(plan.error);
		return;
	}
	t.is(plan.bin, 'sh');
	t.deepEqual(plan.args, ['-c', 'echo hi\n\nexit 0']);
	t.true(plan.detached);
});

test('planBashSpawn off on windows is cmd /c', t => {
	const plan = planBashSpawn({
		platform: 'win32',
		sandbox: false,
		command: 'echo hi',
		spawnCommand: 'echo hi',
		cwd: 'C:\\proj',
		projectRoot: 'C:\\proj',
	});
	if ('error' in plan) {
		t.fail(plan.error);
		return;
	}
	t.is(plan.bin, 'cmd');
	t.deepEqual(plan.args, ['/c', 'echo hi']);
	t.false(plan.detached);
});

test('planBashSpawn on windows with sandbox returns an error', t => {
	const plan = planBashSpawn({
		platform: 'win32',
		sandbox: true,
		command: 'echo hi',
		spawnCommand: 'echo hi',
		cwd: 'C:\\proj',
		projectRoot: 'C:\\proj',
	});
	t.true('error' in plan);
	if ('error' in plan) {
		t.regex(plan.error, /not supported on Windows/i);
	}
});

test('planBashSpawn on linux without bwrap returns an error and does not fall through to sh', t => {
	const plan = planBashSpawn({
		platform: 'linux',
		sandbox: true,
		command: 'echo hi',
		spawnCommand: 'echo hi',
		cwd: '/tmp/proj',
		projectRoot: '/tmp/proj',
		tmpDir: '/tmp/jail',
		bwrapPath: null,
	});
	t.true('error' in plan);
	if ('error' in plan) {
		t.regex(plan.error, /bubblewrap/i);
	}
});

test('planBashSpawn on linux with bwrap uses --unshare-net, --tmpfs, --new-session', t => {
	const plan = planBashSpawn({
		platform: 'linux',
		sandbox: true,
		command: 'echo hi',
		spawnCommand: 'echo hi',
		cwd: '/tmp/proj',
		projectRoot: '/tmp/proj',
		tmpDir: '/tmp/jail',
		bwrapPath: '/run/wrappers/bin/bwrap',
	});
	if ('error' in plan) {
		t.fail(plan.error);
		return;
	}
	t.is(plan.bin, 'bwrap');
	if (plan.bin === 'bwrap') {
		t.is(plan.bwrap, '/run/wrappers/bin/bwrap');
	}
	t.true(plan.args.includes('--unshare-net'));
	t.true(plan.args.includes('--new-session'));
	t.true(plan.args.includes('--tmpfs'));
	t.true(plan.args.includes('/tmp/proj'));
	t.true(plan.args.includes('/tmp/jail'));
});

test('macSandboxProfile denies network and allows project plus tmp writes', t => {
	const profile = macSandboxProfile('/Users/me/proj', ['/tmp/jail', '/var/folders/xx/T']);
	t.true(profile.includes('(deny network*)'));
	t.true(profile.includes('(subpath "/Users/me/proj")'));
	t.true(profile.includes('(subpath "/tmp/jail")'));
	t.true(profile.includes('(subpath "/var/folders/xx/T")'));
});

test('planBashSpawn on darwin with sandbox uses sandbox-exec when present', t => {
	const plan = planBashSpawn({
		platform: 'darwin',
		sandbox: true,
		command: 'echo hi',
		spawnCommand: 'echo hi',
		cwd: '/tmp/proj',
		projectRoot: '/tmp/proj',
		tmpDir: '/tmp/jail',
		hostTmp: '/var/folders/xx/T',
	});
	if ('error' in plan) {
		t.regex(plan.error, /sandbox-exec/);
		return;
	}
	t.is(plan.bin, 'sandbox-exec');
	t.is(plan.args[0], '-p');
	t.true(plan.args[1].includes('deny network*'));
	t.true(plan.args[1].includes('/tmp/jail'));
	t.true(plan.args[1].includes('/var/folders/xx/T'));
	t.true(plan.args.includes('sh'));
});

test('findBwrap walks PATH', t => {
	const dir = mkdtempSync(join(tmpdir(), 'nc-bwrap-'));
	try {
		const bin = join(dir, 'bwrap');
		writeFileSync(bin, '');
		if (platform !== 'win32') chmodSync(bin, 0o755);
		t.is(findBwrap(dir), bin);
		t.is(findBwrap(''), undefined);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});
