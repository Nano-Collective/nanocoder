import test from 'ava';
import {
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
	t.is(plan.file, 'sh');
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
	t.is(plan.file, 'cmd');
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
		bwrapPath: null,
	});
	t.true('error' in plan);
	if ('error' in plan) {
		t.regex(plan.error, /bubblewrap/i);
	}
});

test('planBashSpawn on linux with bwrap uses --unshare-net and binds the project', t => {
	const plan = planBashSpawn({
		platform: 'linux',
		sandbox: true,
		command: 'echo hi',
		spawnCommand: 'echo hi',
		cwd: '/tmp/proj',
		projectRoot: '/tmp/proj',
		bwrapPath: '/usr/bin/bwrap',
	});
	if ('error' in plan) {
		t.fail(plan.error);
		return;
	}
	t.is(plan.file, '/usr/bin/bwrap');
	t.true(plan.args.includes('--unshare-net'));
	t.true(plan.args.includes('/tmp/proj'));
});

test('macSandboxProfile denies network and confines writes to the project', t => {
	const profile = macSandboxProfile('/Users/me/proj');
	t.true(profile.includes('(deny network*)'));
	t.true(profile.includes('(subpath "/Users/me/proj")'));
});

test('planBashSpawn on darwin with sandbox uses sandbox-exec when present', t => {
	const plan = planBashSpawn({
		platform: 'darwin',
		sandbox: true,
		command: 'echo hi',
		spawnCommand: 'echo hi',
		cwd: '/tmp/proj',
		projectRoot: '/tmp/proj',
	});
	if ('error' in plan) {
		t.regex(plan.error, /sandbox-exec/);
		return;
	}
	t.is(plan.file, '/usr/bin/sandbox-exec');
	t.is(plan.args[0], '-p');
	t.true(plan.args[1].includes('deny network*'));
	t.true(plan.args.includes('sh'));
});
