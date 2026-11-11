import {chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {platform} from 'node:process';
import test from 'ava';
import {
	acquireProtectedMounts,
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
	// --new-session moves the command out of the group nanocoder signals;
	// --info-fd reports its pid so the executor can stop it anyway.
	t.deepEqual(plan.args.slice(0, 2), ['--info-fd', '3']);
	t.true(plan.args.includes('--tmpfs'));
	t.true(plan.args.includes('/tmp/proj'));
	t.true(plan.args.includes('/tmp/jail'));
});

test('planBashSpawn on linux with unusable bwrap returns an error', t => {
	const plan = planBashSpawn({
		platform: 'linux',
		sandbox: true,
		command: 'echo hi',
		spawnCommand: 'echo hi',
		cwd: '/tmp/proj',
		projectRoot: '/tmp/proj',
		tmpDir: '/tmp/jail',
		bwrapPath: '/run/wrappers/bin/bwrap',
		bwrapUsable: false,
	});
	t.true('error' in plan);
	if ('error' in plan) {
		t.regex(plan.error, /user namespace/i);
	}
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
	t.true(plan.args[1].includes('/private/tmp'));
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
		const decoy = mkdtempSync(join(tmpdir(), 'nc-bwrap-dir-'));
		try {
			mkdirSync(join(decoy, 'bwrap'));
			t.is(findBwrap(decoy), undefined);
		} finally {
			rmSync(decoy, {recursive: true, force: true});
		}
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

// Writes to these run code outside the jail: git config and hooks the next
// time nanocoder's git tools run, nanocoder's own config on its next start.
test('macSandboxProfile keeps git and nanocoder config read-only inside the project', t => {
	const profile = macSandboxProfile('/Users/me/proj', ['/tmp/jail']);
	const readOnly = profile.slice(profile.lastIndexOf('(deny file-write*'));
	for (const entry of ['.git', '.nanocoder', 'agents.config.json', '.mcp.json']) {
		t.true(readOnly.includes(`(subpath "/Users/me/proj/${entry}")`), entry);
	}
	t.true(profile.includes('(deny appleevent-send)'));
	t.true(profile.includes('com.apple.coreservices.launchservicesd'));
});

function bwrapPlanArgs(
	protectedMounts: Parameters<typeof planBashSpawn>[0]['protectedMounts'],
): string[] {
	const plan = planBashSpawn({
		platform: 'linux',
		sandbox: true,
		command: 'echo hi',
		spawnCommand: 'echo hi',
		cwd: '/tmp/proj',
		projectRoot: '/tmp/proj',
		tmpDir: '/tmp/jail',
		bwrapPath: '/usr/bin/bwrap',
		protectedMounts,
		hostMasks: {
			runtimeDir: '/run/user/1000',
			sockets: ['/run/docker.sock', '/run/dbus/system_bus_socket'],
		},
	});
	if ('error' in plan) throw new Error(plan.error);
	return plan.args;
}

test('planBashSpawn on linux mounts protected entries read-only over the project bind', t => {
	const args = bwrapPlanArgs([
		{path: '/tmp/proj/.git'},
		{path: '/tmp/proj/.nanocoder', placeholder: 'dir'},
		{path: '/tmp/proj/.mcp.json', placeholder: 'file'},
	]);
	const roBind = args.indexOf('/tmp/proj/.git') - 1;
	t.is(args[roBind], '--ro-bind');
	t.true(roBind > args.indexOf('/tmp/jail'), 'must come after the writable binds');
	const joined = args.join(' ');
	t.true(
		joined.includes(
			'--tmpfs /tmp/proj/.nanocoder --remount-ro /tmp/proj/.nanocoder',
		),
	);
	t.true(joined.includes('--ro-bind /dev/null /tmp/proj/.mcp.json'));
});

test('planBashSpawn on linux hides the user runtime dir and host daemon sockets', t => {
	const args = bwrapPlanArgs([]).join(' ');
	t.true(args.includes('--tmpfs /run/user/1000'));
	t.true(args.includes('--ro-bind /dev/null /run/docker.sock'));
	t.true(args.includes('--ro-bind /dev/null /run/dbus/system_bus_socket'));
});

test('acquireProtectedMounts places missing entries and removes them after the last holder', t => {
	const root = mkdtempSync(join(tmpdir(), 'nc-protect-'));
	try {
		mkdirSync(join(root, '.git'));
		const first = acquireProtectedMounts(root);
		t.deepEqual(first.mounts, [
			{path: join(root, '.git')},
			{path: join(root, '.nanocoder'), placeholder: 'dir'},
			{path: join(root, 'agents.config.json'), placeholder: 'file'},
			{path: join(root, '.mcp.json'), placeholder: 'file'},
		]);
		// bwrap creates the mount points on the host.
		mkdirSync(join(root, '.nanocoder'));
		writeFileSync(join(root, '.mcp.json'), '');
		writeFileSync(join(root, 'agents.config.json'), '');

		// A second jail must mount them again, not treat them as real entries.
		const second = acquireProtectedMounts(root);
		t.is(second.mounts[1]?.placeholder, 'dir');
		t.is(second.mounts[3]?.placeholder, 'file');

		first.release();
		first.release();
		t.true(existsSync(join(root, '.mcp.json')), 'still held by the second jail');

		// Something on the host wrote real config meanwhile: keep it.
		writeFileSync(join(root, 'agents.config.json'), '{}');
		second.release();
		t.false(existsSync(join(root, '.nanocoder')));
		t.false(existsSync(join(root, '.mcp.json')));
		t.true(existsSync(join(root, 'agents.config.json')));
		t.true(existsSync(join(root, '.git')));
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});
