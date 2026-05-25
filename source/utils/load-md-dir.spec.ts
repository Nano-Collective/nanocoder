import {mkdtemp, rm, writeFile, mkdir, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {loadMdDir} from './load-md-dir';

console.log(`\nload-md-dir.spec.ts`);

async function withTempDir(
	fn: (dir: string) => Promise<void>,
): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), 'load-md-dir-'));
	try {
		await fn(dir);
	} finally {
		await rm(dir, {recursive: true, force: true});
	}
}

test('missing directory returns empty result, no error', async t => {
	const result = await loadMdDir(
		join(tmpdir(), `does-not-exist-${Date.now()}`),
		async filePath => filePath,
	);
	t.deepEqual(result.entries, []);
	t.deepEqual(result.errors, []);
});

test('parses every .md file in the directory', async t => {
	await withTempDir(async dir => {
		await writeFile(join(dir, 'a.md'), 'A');
		await writeFile(join(dir, 'b.md'), 'B');

		const result = await loadMdDir(dir, async filePath => filePath);
		t.is(result.entries.length, 2);
		t.deepEqual(result.errors, []);

		const names = result.entries.map(e => e.filePath).sort();
		t.deepEqual(names, [join(dir, 'a.md'), join(dir, 'b.md')]);
	});
});

test('non-.md files and subdirectories are ignored', async t => {
	await withTempDir(async dir => {
		await writeFile(join(dir, 'keep.md'), '');
		await writeFile(join(dir, 'skip.txt'), '');
		await writeFile(join(dir, 'skip.js'), '');
		await mkdir(join(dir, 'subdir.md'));

		const result = await loadMdDir(dir, async filePath => filePath);
		t.is(result.entries.length, 1);
		t.true(result.entries[0]?.filePath.endsWith('keep.md'));
	});
});

test('per-file parse errors are captured, other files still load', async t => {
	await withTempDir(async dir => {
		await writeFile(join(dir, 'ok.md'), '');
		await writeFile(join(dir, 'broken.md'), '');

		const result = await loadMdDir(dir, async filePath => {
			if (filePath.endsWith('broken.md')) throw new Error('boom');
			return 'ok';
		});

		t.is(result.entries.length, 1);
		t.is(result.entries[0]?.parsed, 'ok');
		t.is(result.errors.length, 1);
		t.true(result.errors[0]?.filePath.endsWith('broken.md'));
		t.is(result.errors[0]?.error, 'boom');
	});
});

test('sync parser is awaited transparently', async t => {
	await withTempDir(async dir => {
		await writeFile(join(dir, 'a.md'), '');
		const result = await loadMdDir(dir, filePath => `parsed:${filePath}`);
		t.is(result.entries.length, 1);
		t.true(result.entries[0]?.parsed.startsWith('parsed:'));
	});
});

test('symlinks pointing at directories are skipped', async t => {
	await withTempDir(async dir => {
		const realDir = join(dir, 'real-subdir');
		await mkdir(realDir);
		try {
			await symlink(realDir, join(dir, 'link.md'));
		} catch {
			t.pass('symlinks not supported on this filesystem');
			return;
		}
		await writeFile(join(dir, 'file.md'), '');

		const result = await loadMdDir(dir, async filePath => filePath);
		t.is(result.entries.length, 1);
		t.true(result.entries[0]?.filePath.endsWith('file.md'));
	});
});
