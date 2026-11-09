import * as path from 'path';
import test from 'ava';
import * as fs from 'fs/promises';
import {
	atomicWriteFile,
	atomicWriteFileSync,
	atomicWriteJson,
	atomicWritePrivateJson,
	publishFileNoClobber,
	setLinkSyncForTests,
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

test.serial('atomicWriteFileSync honours the requested file mode', async t => {
	if (process.platform === 'win32') {
		t.pass('skipped: POSIX file modes are not meaningful on Windows');
		return;
	}
	const tempDir = await createTempDir();
	try {
		const filePath = path.join(tempDir, 'restricted-sync.txt');
		atomicWriteFileSync(filePath, 'secret', {mode: 0o600});

		const stats = await fs.stat(filePath);
		t.is(stats.mode & 0o777, 0o600);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('atomicWritePrivateJson creates a new file owner-only', async t => {
	if (process.platform === 'win32') {
		t.pass('skipped: POSIX file modes are not meaningful on Windows');
		return;
	}
	const tempDir = await createTempDir();
	try {
		const filePath = path.join(tempDir, 'nested', 'config.json');
		atomicWritePrivateJson(filePath, {apiKey: 'sk-test'});

		t.deepEqual(JSON.parse(await fs.readFile(filePath, 'utf-8')), {
			apiKey: 'sk-test',
		});
		const stats = await fs.stat(filePath);
		t.is(stats.mode & 0o777, 0o600);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('atomicWritePrivateJson preserves the mode of an existing file', async t => {
	if (process.platform === 'win32') {
		t.pass('skipped: POSIX file modes are not meaningful on Windows');
		return;
	}
	const tempDir = await createTempDir();
	try {
		const filePath = path.join(tempDir, 'existing.json');
		await fs.writeFile(filePath, '{}', 'utf-8');
		await fs.chmod(filePath, 0o640);

		atomicWritePrivateJson(filePath, {updated: true});

		t.deepEqual(JSON.parse(await fs.readFile(filePath, 'utf-8')), {
			updated: true,
		});
		const stats = await fs.stat(filePath);
		t.is(stats.mode & 0o777, 0o640);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('atomicWriteJson follows a symlinked config file', async t => {
	if (process.platform === 'win32') {
		t.pass('skipped: symlink creation is not reliable on Windows CI');
		return;
	}
	const tempDir = await createTempDir();
	try {
		const realPath = path.join(tempDir, 'dotfiles', 'agents.config.json');
		const linkPath = path.join(tempDir, 'agents.config.json');
		await fs.mkdir(path.dirname(realPath), {recursive: true});
		await fs.writeFile(realPath, '{}', 'utf-8');
		await fs.chmod(realPath, 0o640);
		await fs.symlink(realPath, linkPath);

		atomicWritePrivateJson(linkPath, {apiKey: 'sk-test'});

		t.true((await fs.lstat(linkPath)).isSymbolicLink());
		t.deepEqual(JSON.parse(await fs.readFile(realPath, 'utf-8')), {
			apiKey: 'sk-test',
		});
		const stats = await fs.stat(realPath);
		t.is(stats.mode & 0o777, 0o640);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('atomicWritePrivateJson writes through a dangling symlink', async t => {
	if (process.platform === 'win32') {
		t.pass('skipped: symlink creation is not reliable on Windows CI');
		return;
	}
	const tempDir = await createTempDir();
	try {
		const targetPath = path.join(tempDir, 'dotfiles', 'agents.config.json');
		const linkPath = path.join(tempDir, 'agents.config.json');
		await fs.mkdir(path.dirname(targetPath), {recursive: true});
		await fs.symlink(targetPath, linkPath);

		atomicWritePrivateJson(linkPath, {apiKey: 'sk-test'});

		t.true((await fs.lstat(linkPath)).isSymbolicLink());
		t.deepEqual(JSON.parse(await fs.readFile(targetPath, 'utf-8')), {
			apiKey: 'sk-test',
		});
		t.is((await fs.stat(targetPath)).mode & 0o777, 0o600);
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
