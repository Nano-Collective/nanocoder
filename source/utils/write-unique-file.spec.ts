import test from 'ava';
import type {ExecutionContext} from 'ava';
import {promises as fs} from 'fs';
import os from 'os';
import path from 'path';
import {writeUniqueFile} from './write-unique-file';

// Registers cleanup up front so a mid-test failure still removes the directory
// instead of leaving it behind.
async function tmpDir(t: ExecutionContext): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'write-unique-test-'));
	t.teardown(() => fs.rm(dir, {recursive: true, force: true}));
	return dir;
}

test('writes to the given path when it is free', async t => {
	const dir = await tmpDir(t);
	const filepath = path.join(dir, 'test.md');
	const result = await writeUniqueFile(filepath, 'content');
	t.is(result, filepath);
	t.is(await fs.readFile(filepath, 'utf-8'), 'content');
});

test('appends a counter when the path is taken', async t => {
	const dir = await tmpDir(t);
	const filepath = path.join(dir, 'test.md');
	await fs.writeFile(filepath, 'existing');
	const result = await writeUniqueFile(filepath, 'content');
	t.is(result, path.join(dir, 'test-2.md'));
	t.is(await fs.readFile(path.join(dir, 'test-2.md'), 'utf-8'), 'content');
});

test('never overwrites an existing file', async t => {
	const dir = await tmpDir(t);
	const filepath = path.join(dir, 'test.md');
	const originals = [
		'test.md',
		'test-2.md',
		'test-3.md',
		'test-4.md',
		'test-5.md',
		'test-6.md',
	];
	for (const name of originals) {
		await fs.writeFile(path.join(dir, name), 'existing');
	}

	const result = await writeUniqueFile(filepath, 'content');

	// Every pre-existing file keeps its content — none may be clobbered.
	for (const name of originals) {
		t.is(await fs.readFile(path.join(dir, name), 'utf-8'), 'existing');
	}
	// The writer must have landed in a fresh, distinct file (timestamp suffix).
	t.not(result, filepath);
	t.true(result.startsWith(path.join(dir, 'test-new-')));
	t.true(result.endsWith('.md'));
	t.is(await fs.readFile(result, 'utf-8'), 'content');
});

test('is atomic: the original is never clobbered by a race', async t => {
	const dir = await tmpDir(t);
	const filepath = path.join(dir, 'test.md');
	await fs.writeFile(filepath, 'original');

	// Simulate TWO concurrent exclusive-flag writers for the same target. Only
	// one may win the base name; the other must fall to a suffix, and the
	// original file's contents must be preserved.
	const [a, b] = await Promise.all([
		writeUniqueFile(filepath, 'first'),
		writeUniqueFile(filepath, 'second'),
	]);

	t.not(a, filepath);
	t.not(b, filepath);
	t.not(a, b);
	t.is(await fs.readFile(filepath, 'utf-8'), 'original');
});

test('reports a missing parent directory clearly', async t => {
	const dir = await tmpDir(t);
	const filepath = path.join(dir, 'does-not-exist', 'chat.md');

	await t.throwsAsync(() => writeUniqueFile(filepath, 'content'), {
		message: /Parent directory does not exist/,
	});
});

test('keeps every candidate in the target directory', async t => {
	const dir = await tmpDir(t);
	const filepath = path.join(dir, 'test.md');
	await fs.writeFile(filepath, 'existing');

	const result = await writeUniqueFile(filepath, 'content');

	// Suffixes go on the basename only — a collision must never walk the write
	// out of the directory the caller validated.
	t.is(path.dirname(result), dir);
});
