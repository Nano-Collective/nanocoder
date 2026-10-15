import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, posix} from 'node:path';
import test from 'ava';
import {
	getLockfilePath,
	getSocketPath,
	isProcessAlive,
	readLiveLockfile,
	readLockfile,
	removeLockfile,
	resolveSocketPath,
	writeLockfile,
} from './lockfile';

console.log(`\nlockfile.spec.ts`);

async function tempProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'daemon-lock-'));
	await mkdir(join(root, '.nanocoder'), {recursive: true});
	return root;
}

test.serial('writeLockfile + readLockfile round-trip', async t => {
	const root = await tempProject();
	try {
		await writeLockfile({
			pid: 1234,
			socketPath: '/tmp/daemon.sock',
			startedAt: 5_555,
			projectRoot: root,
		});
		const back = await readLockfile(root);
		t.is(back?.pid, 1234);
		t.is(back?.socketPath, '/tmp/daemon.sock');
		t.is(back?.startedAt, 5_555);
		t.is(back?.projectRoot, root);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('readLockfile returns null when file is absent', async t => {
	const root = await tempProject();
	try {
		t.is(await readLockfile(root), null);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('readLockfile returns null on malformed JSON', async t => {
	const root = await tempProject();
	try {
		await writeFile(getLockfilePath(root), '{ not: json', 'utf-8');
		t.is(await readLockfile(root), null);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('removeLockfile deletes the file (no-op when missing)', async t => {
	const root = await tempProject();
	try {
		await writeLockfile({
			pid: 1,
			socketPath: 's',
			startedAt: 0,
			projectRoot: root,
		});
		await removeLockfile(root);
		await removeLockfile(root); // idempotent
		t.is(await readLockfile(root), null);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('isProcessAlive returns true for current process', t => {
	t.true(isProcessAlive(process.pid));
});

test('isProcessAlive returns false for a clearly-dead PID', t => {
	// PID 0 is the kernel scheduler; passing 0 to process.kill on most
	// platforms returns false (Linux: EINVAL/EPERM behavior varies).
	// Use a very large PID that almost certainly isn't a real process.
	t.false(isProcessAlive(99_999_999));
});

test.serial('readLiveLockfile reaps stale lockfiles', async t => {
	const root = await tempProject();
	try {
		await writeLockfile({
			pid: 99_999_999, // not a real process
			socketPath: 's',
			startedAt: 0,
			projectRoot: root,
		});
		const live = await readLiveLockfile(root);
		t.is(live, null);
		// stale file should have been removed
		await t.notThrowsAsync(async () => {
			const back = await readFile(getLockfilePath(root), 'utf-8').catch(
				() => null,
			);
			t.is(back, null);
		});
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test.serial('readLiveLockfile returns the lock when process is alive', async t => {
	const root = await tempProject();
	try {
		await writeLockfile({
			pid: process.pid,
			socketPath: 's',
			startedAt: 1,
			projectRoot: root,
		});
		const live = await readLiveLockfile(root);
		t.is(live?.pid, process.pid);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('getSocketPath returns a project-local .sock file on non-Windows', t => {
	if (process.platform === 'win32') {
		t.pass('skipped: non-Windows-only assertion');
		return;
	}
	const root = '/tmp/example-proj';
	const sock = getSocketPath(root);
	t.is(sock, join(root, '.nanocoder', 'daemon.sock'));
});

/**
 * `<root>/.nanocoder/daemon.sock` adds 23 bytes, so a root that is itself
 * well within the limit can still produce an overlong socket path. Builds a
 * root whose *final socket path* is exactly `bytes` long.
 */
function rootForSocketBytes(bytes: number): string {
	return `/tmp/${'a'.repeat(bytes - 23 - 5)}`;
}

const TMP = '/var/folders/ab/cdefghijklmnopqrstuvwxyz012345/T';

test('resolveSocketPath keeps the project-local socket at exactly sun_path capacity', t => {
	const darwinRoot = rootForSocketBytes(104);
	const darwinSock = resolveSocketPath(darwinRoot, 'darwin', TMP);
	t.is(Buffer.byteLength(darwinSock), 104);
	t.is(darwinSock, posix.join(darwinRoot, '.nanocoder', 'daemon.sock'));

	const linuxRoot = rootForSocketBytes(108);
	const linuxSock = resolveSocketPath(linuxRoot, 'linux', TMP);
	t.is(Buffer.byteLength(linuxSock), 108);
	t.is(linuxSock, posix.join(linuxRoot, '.nanocoder', 'daemon.sock'));
});

test('resolveSocketPath falls back to the temp dir one byte over capacity', t => {
	const root = rootForSocketBytes(105);
	const sock = resolveSocketPath(root, 'darwin', TMP);
	t.true(sock.startsWith(`${TMP}/`));
	t.regex(sock, /nanocoder-daemon-[a-f0-9]{10}\.sock$/);
	t.true(Buffer.byteLength(sock) <= 104);
});

test('resolveSocketPath applies the platform-specific capacity', t => {
	// 108 bytes: over macOS' limit, exactly at Linux'. The same project root
	// must therefore resolve differently on the two platforms.
	const root = rootForSocketBytes(108);
	const projectSock = posix.join(root, '.nanocoder', 'daemon.sock');
	t.not(resolveSocketPath(root, 'darwin', TMP), projectSock);
	t.is(resolveSocketPath(root, 'linux', TMP), projectSock);

	// Past 108 both platforms fall back.
	const longer = rootForSocketBytes(109);
	t.not(
		resolveSocketPath(longer, 'linux', TMP),
		posix.join(longer, '.nanocoder', 'daemon.sock'),
	);
});

test('resolveSocketPath falls back to /tmp when the temp dir is itself too long', t => {
	const longTmp = `/${'x'.repeat(100)}`;
	const sock = resolveSocketPath(rootForSocketBytes(200), 'darwin', longTmp);
	t.regex(sock, /^\/tmp\/nanocoder-daemon-[a-f0-9]{10}\.sock$/);
	t.true(Buffer.byteLength(sock) <= 104);
});

test('resolveSocketPath fallbacks are stable and per-project', t => {
	const a = rootForSocketBytes(200);
	const b = `${a}-other`;
	t.is(resolveSocketPath(a, 'darwin', TMP), resolveSocketPath(a, 'darwin', TMP));
	t.not(resolveSocketPath(a, 'darwin', TMP), resolveSocketPath(b, 'darwin', TMP));
});

test('resolveSocketPath returns a named pipe on Windows regardless of length', t => {
	const a = resolveSocketPath(`C:\\projects\\${'x'.repeat(300)}`, 'win32', TMP);
	const b = resolveSocketPath('C:\\projects\\beta', 'win32', TMP);
	t.regex(a, /^\\\\\.\\pipe\\nanocoder-daemon-[a-f0-9]{10}$/);
	t.not(a, b, 'distinct project roots produce distinct pipes');
});

test('getSocketPath falls back off the project dir for overlong paths', t => {
	if (process.platform === 'win32') {
		t.pass('skipped: non-Windows-only assertion');
		return;
	}
	const root = rootForSocketBytes(200);
	const sock = getSocketPath(root);
	t.not(sock, join(root, '.nanocoder', 'daemon.sock'));
	t.true(sock.startsWith(tmpdir()) || sock.startsWith('/tmp/'));
	t.regex(sock, /nanocoder-daemon-[a-f0-9]{10}\.sock$/);
});

test('getSocketPath returns a named pipe path on Windows', t => {
	if (process.platform !== 'win32') {
		t.pass('skipped: Windows-only assertion');
		return;
	}
	const a = getSocketPath('C:\\projects\\alpha');
	const b = getSocketPath('C:\\projects\\beta');
	// Named pipe shape: \\.\pipe\nanocoder-daemon-<hash>
	t.regex(a, /^\\\\\.\\pipe\\nanocoder-daemon-[a-f0-9]{10}$/);
	t.regex(b, /^\\\\\.\\pipe\\nanocoder-daemon-[a-f0-9]{10}$/);
	t.not(a, b, 'distinct project roots produce distinct pipes');
});
