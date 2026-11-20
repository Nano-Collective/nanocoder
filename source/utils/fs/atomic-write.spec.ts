import * as path from 'path';
import test from 'ava';
import * as fs from 'fs/promises';
import {
	atomicWriteFile,
	atomicWriteUserFile,
	publishFileNoClobber,
	setLinkSyncForTests,
	setRenameForTests,
} from './atomic-write';

async function createTempDir(): Promise<string> {
	const tempDir = path.join(
		process.cwd(),
		'.test-temp',
		`atomic-write-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await fs.mkdir(tempDir, {recursive: true});
	return tempDir;
}

async function cleanupTempDir(dir: string): Promise<void> {
	try {
		await fs.rm(dir, {recursive: true, force: true});
	} catch {
		// Ignore cleanup errors
	}
}

test.serial('atomicWriteFile writes content via rename', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = path.join(tempDir, 'out.txt');
		await atomicWriteFile(filePath, 'hello');

		t.is(await fs.readFile(filePath, 'utf-8'), 'hello');
		const dirListing = await fs.readdir(tempDir);
		t.false(dirListing.some(name => name.endsWith('.tmp')));
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('atomicWriteFile replaces an existing file atomically', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = path.join(tempDir, 'out.txt');
		await fs.writeFile(filePath, 'before', 'utf-8');
		await atomicWriteFile(filePath, 'after');

		t.is(await fs.readFile(filePath, 'utf-8'), 'after');
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('atomicWriteFile honours the requested file mode', async t => {
	if (process.platform === 'win32') {
		t.pass('skipped: POSIX file modes are not meaningful on Windows');
		return;
	}
	const tempDir = await createTempDir();
	try {
		const filePath = path.join(tempDir, 'restricted.txt');
		await atomicWriteFile(filePath, 'secret', {mode: 0o600});

		const stats = await fs.stat(filePath);
		t.is(stats.mode & 0o777, 0o600);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('atomicWriteFile leaves no temp file behind on failure', async t => {
	const tempDir = await createTempDir();
	try {
		// The parent directory does not exist, so the temp write cannot succeed.
		const filePath = path.join(tempDir, 'missing-dir', 'out.txt');
		await t.throwsAsync(atomicWriteFile(filePath, 'hello'));

		const dirListing = await fs.readdir(tempDir);
		t.false(dirListing.some(name => name.endsWith('.tmp')));
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('publishFileNoClobber publishes when the destination is absent', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = path.join(tempDir, 'usage.json');

		t.true(publishFileNoClobber(filePath, '{"totalLifetime": 5}'));
		t.is(await fs.readFile(filePath, 'utf-8'), '{"totalLifetime": 5}');
		// No temp litter left behind.
		const dirListing = await fs.readdir(tempDir);
		t.false(dirListing.some(name => name.includes('.tmp')));
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('publishFileNoClobber keeps the existing file when a peer won the race', async t => {
	// The concurrent-publish window (destination appearing between the
	// exists check and the publish) cannot be staged single-threaded —
	// link(2) atomicity is the arbiter — so this covers the seam where the
	// old and new code differ: it fails against a copy-based implementation
	// (verified by mutation) and passes against the link-based one.
	const tempDir = await createTempDir();
	try {
		const filePath = path.join(tempDir, 'usage.json');
		await fs.writeFile(filePath, 'winner-data', 'utf-8');

		t.false(publishFileNoClobber(filePath, 'stale-data'));
		t.is(await fs.readFile(filePath, 'utf-8'), 'winner-data');
		const dirListing = await fs.readdir(tempDir);
		t.false(dirListing.some(name => name.includes('.tmp')));
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('publishFileNoClobber falls back to exclusive write when hard links are unsupported', async t => {
	// Simulate FAT/exFAT or SMB/FUSE mounts where linkSync throws EPERM.
	const linkError = new Error(
		'operation not permitted, link',
	) as NodeJS.ErrnoException;
	linkError.code = 'EPERM';
	setLinkSyncForTests(() => {
		throw linkError;
	});
	try {
		const tempDir = await createTempDir();
		try {
			const filePath = path.join(tempDir, 'usage.json');

			// Absent destination: the exclusive-create fallback publishes.
			t.true(publishFileNoClobber(filePath, 'fallback-data'));
			t.is(await fs.readFile(filePath, 'utf-8'), 'fallback-data');

			// Present destination: EEXIST from the fallback likewise means a
			// peer won — content stays untouched.
			t.false(publishFileNoClobber(filePath, 'stale-data'));
			t.is(await fs.readFile(filePath, 'utf-8'), 'fallback-data');

			const dirListing = await fs.readdir(tempDir);
			t.false(dirListing.some(name => name.includes('.tmp')));
		} finally {
			await cleanupTempDir(tempDir);
		}
	} finally {
		setLinkSyncForTests();
	}
});

function errnoError(code: string): NodeJS.ErrnoException {
	const error = new Error(`${code}: simulated`) as NodeJS.ErrnoException;
	error.code = code;
	return error;
}

async function listTempFiles(dir: string): Promise<string[]> {
	return (await fs.readdir(dir)).filter(name => name.endsWith('.tmp'));
}

test.serial('atomicWriteUserFile creates a new file and leaves no temp file', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = path.join(tempDir, 'new.ts');
		await atomicWriteUserFile(filePath, 'export const a = 1;\n');

		t.is(await fs.readFile(filePath, 'utf-8'), 'export const a = 1;\n');
		t.deepEqual(await listTempFiles(tempDir), []);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('atomicWriteUserFile replaces an existing file', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = path.join(tempDir, 'app.ts');
		await fs.writeFile(filePath, 'old content that is longer', 'utf-8');
		await atomicWriteUserFile(filePath, 'new');

		t.is(await fs.readFile(filePath, 'utf-8'), 'new');
		t.deepEqual(await listTempFiles(tempDir), []);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('atomicWriteUserFile keeps the original file mode', async t => {
	if (process.platform === 'win32') {
		t.pass('skipped: POSIX file modes are not meaningful on Windows');
		return;
	}
	const tempDir = await createTempDir();
	try {
		const script = path.join(tempDir, 'run.sh');
		await fs.writeFile(script, '#!/bin/sh\necho old\n', 'utf-8');
		await fs.chmod(script, 0o755);
		const secret = path.join(tempDir, 'secret.env');
		await fs.writeFile(secret, 'A=1\n', 'utf-8');
		await fs.chmod(secret, 0o600);

		await atomicWriteUserFile(script, '#!/bin/sh\necho new\n');
		await atomicWriteUserFile(secret, 'A=2\n');

		t.is((await fs.stat(script)).mode & 0o7777, 0o755);
		t.is((await fs.stat(secret)).mode & 0o7777, 0o600);
		t.is(await fs.readFile(script, 'utf-8'), '#!/bin/sh\necho new\n');
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('atomicWriteUserFile updates the target of a symlink and keeps the link', async t => {
	if (process.platform === 'win32') {
		t.pass('skipped: creating symlinks needs extra privileges on Windows');
		return;
	}
	const tempDir = await createTempDir();
	try {
		const realDir = path.join(tempDir, 'real');
		await fs.mkdir(realDir);
		const target = path.join(realDir, 'config.ts');
		await fs.writeFile(target, 'old', 'utf-8');
		const link = path.join(tempDir, 'config.ts');
		await fs.symlink(target, link);

		await atomicWriteUserFile(link, 'new');

		t.true((await fs.lstat(link)).isSymbolicLink());
		t.is(await fs.readFile(target, 'utf-8'), 'new');
		t.deepEqual(await listTempFiles(tempDir), []);
		t.deepEqual(await listTempFiles(realDir), []);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('atomicWriteUserFile creates the target of a dangling symlink', async t => {
	if (process.platform === 'win32') {
		t.pass('skipped: creating symlinks needs extra privileges on Windows');
		return;
	}
	const tempDir = await createTempDir();
	try {
		const target = path.join(tempDir, 'missing.ts');
		const link = path.join(tempDir, 'link.ts');
		await fs.symlink(target, link);

		await atomicWriteUserFile(link, 'created');

		t.true((await fs.lstat(link)).isSymbolicLink());
		t.is(await fs.readFile(target, 'utf-8'), 'created');
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('atomicWriteUserFile writes hard-linked files in place so every link sees the change', async t => {
	const tempDir = await createTempDir();
	try {
		const first = path.join(tempDir, 'a.ts');
		const second = path.join(tempDir, 'b.ts');
		await fs.writeFile(first, 'old', 'utf-8');
		await fs.link(first, second);

		await atomicWriteUserFile(first, 'new');

		t.is(await fs.readFile(second, 'utf-8'), 'new');
		t.is((await fs.stat(first)).nlink, 2);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('atomicWriteUserFile falls back to an in-place write when rename is not possible', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = path.join(tempDir, 'mounted.ts');
		await fs.writeFile(filePath, 'old', 'utf-8');
		for (const code of ['EXDEV', 'EBUSY', 'EPERM']) {
			setRenameForTests(async () => {
				throw errnoError(code);
			});
			try {
				await atomicWriteUserFile(filePath, `new after ${code}`);
			} finally {
				setRenameForTests();
			}
			t.is(await fs.readFile(filePath, 'utf-8'), `new after ${code}`);
			t.deepEqual(await listTempFiles(tempDir), []);
		}
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('atomicWriteUserFile leaves the original untouched when the write fails', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = path.join(tempDir, 'app.ts');
		await fs.writeFile(filePath, 'original', 'utf-8');
		for (const code of ['ENOSPC', 'EIO', 'EDQUOT']) {
			setRenameForTests(async () => {
				throw errnoError(code);
			});
			try {
				const error = await t.throwsAsync(
					atomicWriteUserFile(filePath, 'replacement'),
				);
				t.is((error as NodeJS.ErrnoException).code, code);
			} finally {
				setRenameForTests();
			}
			t.is(await fs.readFile(filePath, 'utf-8'), 'original');
			t.deepEqual(await listTempFiles(tempDir), []);
		}
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('atomicWriteUserFile writes in place when the directory is read-only but the file is writable', async t => {
	if (process.platform === 'win32' || process.getuid?.() === 0) {
		t.pass('skipped: needs POSIX permissions enforced for a non-root user');
		return;
	}
	const tempDir = await createTempDir();
	const lockedDir = path.join(tempDir, 'locked');
	try {
		await fs.mkdir(lockedDir);
		const filePath = path.join(lockedDir, 'app.ts');
		await fs.writeFile(filePath, 'old', 'utf-8');
		await fs.chmod(lockedDir, 0o555);

		await atomicWriteUserFile(filePath, 'new');

		t.is(await fs.readFile(filePath, 'utf-8'), 'new');
	} finally {
		await fs.chmod(lockedDir, 0o755).catch(() => {});
		await cleanupTempDir(tempDir);
	}
});

test.serial('atomicWriteUserFile keeps unicode content and empty content', async t => {
	const tempDir = await createTempDir();
	try {
		const filePath = path.join(tempDir, 'ünïcödé 文件.ts');
		await fs.writeFile(filePath, 'old', 'utf-8');
		await atomicWriteUserFile(filePath, 'const s = "héllo 世界 🙂";\n');
		t.is(
			await fs.readFile(filePath, 'utf-8'),
			'const s = "héllo 世界 🙂";\n',
		);
		await atomicWriteUserFile(filePath, '');
		t.is(await fs.readFile(filePath, 'utf-8'), '');
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('atomicWriteUserFile refuses a read-only file and keeps its content', async t => {
	if (process.platform === 'win32' || process.getuid?.() === 0) {
		t.pass('skipped: needs POSIX permissions enforced for a non-root user');
		return;
	}
	const tempDir = await createTempDir();
	const filePath = path.join(tempDir, 'locked.ts');
	try {
		await fs.writeFile(filePath, 'old', 'utf-8');
		await fs.chmod(filePath, 0o444);

		const error = await t.throwsAsync(atomicWriteUserFile(filePath, 'new'));
		t.is((error as NodeJS.ErrnoException).code, 'EACCES');
		t.is(await fs.readFile(filePath, 'utf-8'), 'old');
		t.deepEqual(await listTempFiles(tempDir), []);
	} finally {
		await fs.chmod(filePath, 0o644).catch(() => {});
		await cleanupTempDir(tempDir);
	}
});

test.serial('atomicWriteUserFile edits files whose names are near the 255-byte limit', async t => {
	const tempDir = await createTempDir();
	try {
		const names = [
			`${'a'.repeat(250)}.ts`,
			// Two-byte and three-byte characters reach the limit sooner.
			`${'é'.repeat(125)}.ts`,
			'文'.repeat(84),
		];
		for (const name of names) {
			const filePath = path.join(tempDir, name);
			await fs.writeFile(filePath, 'old', 'utf-8');
			await atomicWriteUserFile(filePath, 'new');
			t.is(await fs.readFile(filePath, 'utf-8'), 'new', name);
		}
		t.deepEqual(await listTempFiles(tempDir), []);
	} finally {
		await cleanupTempDir(tempDir);
	}
});
