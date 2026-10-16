import * as path from 'path';
import test from 'ava';
import * as fs from 'fs/promises';
import {atomicWriteFile} from './atomic-write';

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
