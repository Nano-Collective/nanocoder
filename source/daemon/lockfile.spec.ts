import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	getLockfilePath,
	getSocketPath,
	isProcessAlive,
	readLiveLockfile,
	readLockfile,
	removeLockfile,
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

test('getSocketPath on macOS uses project dir for short paths and temp dir for long paths', t => {
	if (process.platform !== 'darwin') {
		t.pass('skipped: macOS-only assertion');
		return;
	}
	// Short path should use project-local socket
	const shortRoot = '/tmp/short';
	const shortSock = getSocketPath(shortRoot);
	t.is(shortSock, join(shortRoot, '.nanocoder', 'daemon.sock'));

	// The final socket path includes /.nanocoder/daemon.sock, so a root
	// that is safe by itself can still exceed macOS' 104-byte limit.
	const borderlineRoot = '/tmp/' + 'a'.repeat(85);
	const borderlineProjectSock = join(
		borderlineRoot,
		'.nanocoder',
		'daemon.sock',
	);
	const borderlineSock = getSocketPath(borderlineRoot);
	t.is(Buffer.byteLength(borderlineRoot), 90);
	t.true(Buffer.byteLength(borderlineProjectSock) >= 104);
	t.true(borderlineSock.startsWith(tmpdir()));
	t.regex(borderlineSock, /nanocoder-daemon-[a-f0-9]{10}\.sock$/);
	t.not(borderlineSock, borderlineProjectSock);

	// Long path (>104 bytes) should use temp directory with hash
	const longRoot = '/tmp/' + 'a'.repeat(200);
	const longSock = getSocketPath(longRoot);
	t.true(longSock.startsWith(tmpdir()));
	t.regex(longSock, /nanocoder-daemon-[a-f0-9]{10}\.sock$/);
	t.not(longSock, join(longRoot, '.nanocoder', 'daemon.sock'));
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
