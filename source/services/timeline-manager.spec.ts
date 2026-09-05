import {existsSync} from 'fs';
import * as path from 'path';
import test from 'ava';
import * as fs from 'fs/promises';
import {MAX_TIMELINE_ENTRIES} from '@/constants';
import {TimelineManager} from './timeline-manager';

async function createTempDir(): Promise<string> {
	const tempDir = path.join(
		process.cwd(),
		'.test-temp',
		`timeline-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

async function writeFile(
	dir: string,
	relativePath: string,
	content: string,
): Promise<void> {
	const fullPath = path.join(dir, relativePath);
	await fs.mkdir(path.dirname(fullPath), {recursive: true});
	await fs.writeFile(fullPath, content, 'utf-8');
}

function filesMap(
	entries: Array<[string, string | null]>,
): Map<string, string | null> {
	return new Map(entries);
}

test.serial('TimelineManager captures existing file before-images', async t => {
	const tempDir = await createTempDir();
	try {
		await writeFile(tempDir, 'src/a.ts', 'version-1');
		const manager = new TimelineManager(tempDir, 'session-one');

		const entry = await manager.capture({
			toolCallId: 'call-1',
			toolName: 'write_file',
			title: 'write_file: src/a.ts',
			truncateToMessageIndex: 2,
			files: await manager.snapshotPaths(['src/a.ts']),
		});

		t.truthy(entry);
		t.is(entry?.seq, 1);
		t.deepEqual(entry?.filesChanged, ['src/a.ts']);
		t.is(entry?.truncateToMessageIndex, 2);

		const listed = await manager.list();
		t.is(listed.length, 1);
		t.is(listed[0].id, entry?.id);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('TimelineManager records nonexistent files as created', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new TimelineManager(tempDir, 'session-created');
		const snapshots = await manager.snapshotPaths(['brand-new.ts']);
		t.is(snapshots.get('brand-new.ts'), null);

		const entry = await manager.capture({
			toolCallId: 'call-new',
			toolName: 'write_file',
			title: 'write_file: brand-new.ts',
			truncateToMessageIndex: 1,
			files: snapshots,
		});

		t.truthy(entry);
		t.deepEqual(entry?.filesChanged, ['brand-new.ts']);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('TimelineManager skips capture when no files are provided', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new TimelineManager(tempDir, 'session-empty');
		const entry = await manager.capture({
			toolCallId: 'call-empty',
			toolName: 'execute_bash',
			title: 'execute_bash',
			truncateToMessageIndex: 0,
			files: new Map(),
		});
		t.is(entry, null);
		t.deepEqual(await manager.list(), []);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('TimelineManager revert restores earlier content in reverse order', async t => {
	const tempDir = await createTempDir();
	try {
		await writeFile(tempDir, 'a.ts', 'v1');
		const manager = new TimelineManager(tempDir, 'session-revert');

		const first = await manager.capture({
			toolCallId: 'c1',
			toolName: 'write_file',
			title: 'step 1',
			truncateToMessageIndex: 1,
			files: filesMap([['a.ts', 'v1']]),
		});
		await writeFile(tempDir, 'a.ts', 'v2');

		const second = await manager.capture({
			toolCallId: 'c2',
			toolName: 'write_file',
			title: 'step 2',
			truncateToMessageIndex: 3,
			files: filesMap([['a.ts', 'v2']]),
		});
		await writeFile(tempDir, 'a.ts', 'v3');

		t.truthy(first);
		t.truthy(second);

		const result = await manager.revertTo(first!.id);
		t.is(result.revertedTo.id, first!.id);
		t.true(result.filesRestored.includes('a.ts'));

		const restored = await fs.readFile(path.join(tempDir, 'a.ts'), 'utf-8');
		t.is(restored, 'v1');
		t.deepEqual(await manager.list(), []);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('TimelineManager revert of a later entry keeps earlier checkpoints', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new TimelineManager(tempDir, 'session-partial');
		const first = await manager.capture({
			toolCallId: 'c1',
			toolName: 'write_file',
			title: 'step 1',
			truncateToMessageIndex: 1,
			files: filesMap([['a.ts', 'v1']]),
		});
		const second = await manager.capture({
			toolCallId: 'c2',
			toolName: 'write_file',
			title: 'step 2',
			truncateToMessageIndex: 3,
			files: filesMap([['b.ts', null]]),
		});
		await writeFile(tempDir, 'b.ts', 'b2');

		await manager.revertTo(second!.id);
		t.is((await manager.list()).length, 1);
		t.is((await manager.list())[0].id, first!.id);
		t.false(existsSync(path.join(tempDir, 'b.ts')));
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('TimelineManager revert deletes files created after the checkpoint', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new TimelineManager(tempDir, 'session-delete');
		const entry = await manager.capture({
			toolCallId: 'c1',
			toolName: 'write_file',
			title: 'create',
			truncateToMessageIndex: 1,
			files: filesMap([['created.ts', null]]),
		});
		await writeFile(tempDir, 'created.ts', 'new file');

		await manager.revertTo(entry!.id);
		t.false(existsSync(path.join(tempDir, 'created.ts')));
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('TimelineManager prunes oldest entries past the retention cap', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new TimelineManager(tempDir, 'session-prune');
		for (let i = 0; i < MAX_TIMELINE_ENTRIES + 3; i++) {
			await manager.capture({
				toolCallId: `c${i}`,
				toolName: 'write_file',
				title: `step ${i + 1}`,
				truncateToMessageIndex: i,
				files: filesMap([[`f${i}.ts`, `content-${i}`]]),
			});
		}

		const listed = await manager.list();
		t.is(listed.length, MAX_TIMELINE_ENTRIES);
		t.is(listed[0].seq, 4);
		t.is(listed[listed.length - 1].seq, MAX_TIMELINE_ENTRIES + 3);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('TimelineManager clear removes the session directory', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new TimelineManager(tempDir, 'session-clear');
		await manager.capture({
			toolCallId: 'c1',
			toolName: 'write_file',
			title: 'step',
			truncateToMessageIndex: 0,
			files: filesMap([['a.ts', 'x']]),
		});
		const timelineDir = path.join(
			tempDir,
			'.nanocoder',
			'timeline',
			'session-clear',
		);
		t.true(existsSync(timelineDir));
		await manager.clear();
		t.false(existsSync(timelineDir));
		t.deepEqual(await manager.list(), []);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('TimelineManager rejects unsafe session ids', t => {
	t.throws(() => new TimelineManager('/tmp', '../escape'), {
		message: /Invalid timeline session id/,
	});
	t.throws(() => new TimelineManager('/tmp', 'foo/bar'), {
		message: /Invalid timeline session id/,
	});
});

test.serial('TimelineManager revertTo throws for unknown checkpoint', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new TimelineManager(tempDir, 'session-missing');
		await t.throwsAsync(manager.revertTo('does-not-exist'), {
			message: /does not exist/,
		});
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('TimelineManager toRelativePath rejects paths outside the workspace', t => {
	const manager = new TimelineManager('/tmp/workspace', 'session-paths');
	t.is(manager.toRelativePath('/tmp/workspace/src/a.ts'), 'src/a.ts');
	t.is(manager.toRelativePath('/etc/passwd'), null);
});

test.serial('TimelineManager excludes its own data from capture', t => {
	const manager = new TimelineManager('/tmp/workspace', 'session-self');
	// Otherwise each opaque capture would snapshot the previous one: user
	// projects have no reason to gitignore .nanocoder/timeline.
	t.is(manager.toRelativePath('.nanocoder/timeline/other/timeline.json'), null);
	t.is(manager.toRelativePath('.nanocoder/checkpoints/foo/files/a.ts'), null);
	// Everything else under .nanocoder stays capturable - skills and commands
	// are ordinary project files the agent is expected to edit.
	t.is(
		manager.toRelativePath('.nanocoder/commands/review.md'),
		'.nanocoder/commands/review.md',
	);
});

test.serial('TimelineManager skips binary files when snapshotting', async t => {
	const tempDir = await createTempDir();
	try {
		await writeFile(tempDir, 'text.ts', 'hello');
		await fs.writeFile(
			path.join(tempDir, 'image.bin'),
			Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]),
		);

		const manager = new TimelineManager(tempDir, 'session-binary');
		const snapshots = await manager.snapshotPaths(['text.ts', 'image.bin']);

		// A UTF-8 round-trip would corrupt the binary, so no undo point is
		// better than one that writes back mojibake.
		t.true(snapshots.has('text.ts'));
		t.false(snapshots.has('image.bin'));
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('TimelineManager revert covers every checkpoint in the same turn', async t => {
	const tempDir = await createTempDir();
	try {
		await writeFile(tempDir, 'a.ts', 'a-before');
		await writeFile(tempDir, 'b.ts', 'b-before');
		const manager = new TimelineManager(tempDir, 'session-turn');

		// One assistant turn, two tool calls, so both share a truncation point.
		await manager.capture({
			toolCallId: 'call-1',
			toolName: 'write_file',
			title: 'write a.ts',
			truncateToMessageIndex: 4,
			files: filesMap([['a.ts', 'a-before']]),
		});
		const second = await manager.capture({
			toolCallId: 'call-2',
			toolName: 'write_file',
			title: 'write b.ts',
			truncateToMessageIndex: 4,
			files: filesMap([['b.ts', 'b-before']]),
		});
		await writeFile(tempDir, 'a.ts', 'a-after');
		await writeFile(tempDir, 'b.ts', 'b-after');

		const result = await manager.revertTo(second!.id);

		// Reverting only the second call would erase the first from the
		// conversation while leaving its edit on disk.
		t.is(await fs.readFile(path.join(tempDir, 'a.ts'), 'utf-8'), 'a-before');
		t.is(await fs.readFile(path.join(tempDir, 'b.ts'), 'utf-8'), 'b-before');
		t.is(result.revertedTo.toolCallId, 'call-1');
		t.deepEqual(await manager.list(), []);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('TimelineManager revert keeps checkpoints from earlier turns', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new TimelineManager(tempDir, 'session-turns');
		await manager.capture({
			toolCallId: 'call-1',
			toolName: 'write_file',
			title: 'turn one',
			truncateToMessageIndex: 1,
			files: filesMap([['a.ts', 'v1']]),
		});
		const second = await manager.capture({
			toolCallId: 'call-2',
			toolName: 'write_file',
			title: 'turn two',
			truncateToMessageIndex: 4,
			files: filesMap([['b.ts', 'v1']]),
		});

		await manager.revertTo(second!.id);
		const remaining = await manager.list();
		t.is(remaining.length, 1);
		t.is(remaining[0].toolCallId, 'call-1');
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('TimelineManager refuses index paths that escape the workspace', async t => {
	const tempDir = await createTempDir();
	try {
		await writeFile(tempDir, 'a.ts', 'safe');
		const manager = new TimelineManager(tempDir, 'session-tamper');
		const entry = await manager.capture({
			toolCallId: 'c1',
			toolName: 'write_file',
			title: 'step',
			truncateToMessageIndex: 0,
			files: filesMap([['a.ts', 'safe']]),
		});

		// Rewrite the on-disk index the way a corrupted or tampered file would.
		const indexPath = path.join(
			tempDir,
			'.nanocoder',
			'timeline',
			'session-tamper',
			'timeline.json',
		);
		const index = JSON.parse(await fs.readFile(indexPath, 'utf-8'));
		index.entries[0].filesChanged = ['../escaped.ts'];
		index.entries[0].createdFiles = ['../escaped.ts'];
		await fs.writeFile(indexPath, JSON.stringify(index), 'utf-8');

		const fresh = new TimelineManager(tempDir, 'session-tamper');
		const result = await fresh.revertTo(entry!.id);

		t.deepEqual(result.filesRestored, []);
		t.false(existsSync(path.join(path.dirname(tempDir), 'escaped.ts')));
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('TimelineManager saves the index atomically over a read-only live file', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new TimelineManager(tempDir, 'session-atomic');
		const indexPath = path.join(
			tempDir,
			'.nanocoder',
			'timeline',
			'session-atomic',
			'timeline.json',
		);
		await manager.capture({
			toolCallId: 'c1',
			toolName: 'write_file',
			title: 'step 1',
			truncateToMessageIndex: 0,
			files: filesMap([['a.ts', 'v1']]),
		});

		// rename(2) only needs write permission on the directory, so an atomic
		// save replaces the file; an in-place write would fail with EACCES.
		await fs.chmod(indexPath, 0o444);

		const second = await manager.capture({
			toolCallId: 'c2',
			toolName: 'write_file',
			title: 'step 2',
			truncateToMessageIndex: 2,
			files: filesMap([['b.ts', 'v2']]),
		});

		t.truthy(second);
		t.is((await manager.list()).length, 2);
		const saved = JSON.parse(await fs.readFile(indexPath, 'utf-8'));
		t.is(saved.entries.length, 2);
		const dirListing = await fs.readdir(path.dirname(indexPath));
		t.false(dirListing.some(name => name.endsWith('.tmp')));
	} finally {
		const indexPath = path.join(
			tempDir,
			'.nanocoder',
			'timeline',
			'session-atomic',
			'timeline.json',
		);
		await fs.chmod(indexPath, 0o644).catch(() => {});
		await cleanupTempDir(tempDir);
	}
});

test.serial('TimelineManager keeps the previous index intact when a save fails', async t => {
	const tempDir = await createTempDir();
	try {
		const sessionDir = path.join(
			tempDir,
			'.nanocoder',
			'timeline',
			'session-fail',
		);
		const manager = new TimelineManager(tempDir, 'session-fail');
		await manager.capture({
			toolCallId: 'c1',
			toolName: 'write_file',
			title: 'step 1',
			truncateToMessageIndex: 0,
			files: filesMap([['a.ts', 'v1']]),
		});
		const previousIndex = await fs.readFile(
			path.join(sessionDir, 'timeline.json'),
			'utf-8',
		);

		// A crash or full disk mid-save must not leave a truncated index: the
		// previous checkpoint list stays readable until a save succeeds. A
		// read-only session directory blocks any new write, including the save.
		await fs.chmod(path.join(sessionDir, 'timeline.json'), 0o444);
		await fs.chmod(sessionDir, 0o555);
		await t.throwsAsync(
			manager.capture({
				toolCallId: 'c2',
				toolName: 'write_file',
				title: 'step 2',
				truncateToMessageIndex: 2,
				files: filesMap([['b.ts', 'v2']]),
			}),
		);

		const saved = await fs.readFile(
			path.join(sessionDir, 'timeline.json'),
			'utf-8',
		);
		t.is(saved, previousIndex);
		t.is(JSON.parse(saved).entries.length, 1);
		const dirListing = await fs.readdir(sessionDir);
		t.false(dirListing.some(name => name.endsWith('.tmp')));
	} finally {
		const sessionDir = path.join(
			tempDir,
			'.nanocoder',
			'timeline',
			'session-fail',
		);
		await fs.chmod(path.join(sessionDir, 'timeline.json'), 0o644).catch(() => {});
		await fs.chmod(sessionDir, 0o755).catch(() => {});
		await cleanupTempDir(tempDir);
	}
});

test.serial('TimelineManager starts empty when the index file is corrupted', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new TimelineManager(tempDir, 'session-corrupt');
		await manager.capture({
			toolCallId: 'c1',
			toolName: 'write_file',
			title: 'step',
			truncateToMessageIndex: 0,
			files: filesMap([['a.ts', 'v1']]),
		});
		const indexPath = path.join(
			tempDir,
			'.nanocoder',
			'timeline',
			'session-corrupt',
			'timeline.json',
		);
		// A torn write leaves truncated JSON behind.
		await fs.writeFile(indexPath, '{"entries": [', 'utf-8');

		const fresh = new TimelineManager(tempDir, 'session-corrupt');
		t.deepEqual(await fresh.list(), []);

		const entry = await fresh.capture({
			toolCallId: 'c2',
			toolName: 'write_file',
			title: 'recover',
			truncateToMessageIndex: 1,
			files: filesMap([['b.ts', 'v2']]),
		});
		t.truthy(entry);
		t.is(JSON.parse(await fs.readFile(indexPath, 'utf-8')).entries.length, 1);
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('TimelineManager prunes timelines from abandoned sessions', async t => {
	const tempDir = await createTempDir();
	try {
		const timelineRoot = path.join(tempDir, '.nanocoder', 'timeline');
		const stale = path.join(timelineRoot, 'old-session');
		await fs.mkdir(stale, {recursive: true});
		await fs.writeFile(path.join(stale, 'timeline.json'), '{}', 'utf-8');
		const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
		await fs.utimes(stale, longAgo, longAgo);

		const manager = new TimelineManager(tempDir, 'session-fresh');
		await manager.capture({
			toolCallId: 'c1',
			toolName: 'write_file',
			title: 'step',
			truncateToMessageIndex: 0,
			files: filesMap([['a.ts', 'x']]),
		});

		t.false(existsSync(stale), 'the abandoned session directory is removed');
		t.true(existsSync(path.join(timelineRoot, 'session-fresh')));
	} finally {
		await cleanupTempDir(tempDir);
	}
});
