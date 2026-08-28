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
