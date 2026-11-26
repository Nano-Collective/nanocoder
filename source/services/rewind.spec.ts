import * as path from 'path';
import test from 'ava';
import * as fs from 'fs/promises';
import {
	buildRewindPoints,
	messagesAfterRewind,
	promptTitle,
	recordPromptStart,
	restoreConversation,
	restoreFiles,
} from './rewind';
import {TimelineManager} from './timeline-manager';

console.log('\nrewind.spec.ts');

async function createTempDir(): Promise<string> {
	const tempDir = path.join(
		process.cwd(),
		'.test-temp',
		`rewind-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

test('buildRewindPoints keeps prompts only, newest first', t => {
	const points = buildRewindPoints([
		{
			id: 'a',
			seq: 1,
			toolCallId: 'call-1',
			toolName: 'write_file',
			title: 'write_file: src/a.ts',
			timestamp: new Date().toISOString(),
			truncateToMessageIndex: 2,
			filesChanged: ['src/a.ts'],
			createdFiles: [],
		},
		{
			id: 'b',
			seq: 2,
			toolCallId: 'prompt-3',
			toolName: 'prompt',
			title: 'first',
			timestamp: new Date().toISOString(),
			truncateToMessageIndex: 3,
			filesChanged: ['src/a.ts', 'src/b.ts'],
			createdFiles: [],
			promptText: 'first prompt',
		},
		{
			id: 'c',
			seq: 3,
			toolCallId: 'prompt-7',
			toolName: 'prompt',
			title: 'second',
			timestamp: new Date().toISOString(),
			truncateToMessageIndex: 7,
			filesChanged: [],
			createdFiles: [],
			promptText: 'second prompt',
		},
	]);

	t.deepEqual(
		points.map(point => point.promptText),
		['second prompt', 'first prompt'],
	);
	t.deepEqual(points[1]?.files, ['src/a.ts', 'src/b.ts']);
	t.is(points[1]?.messageIndex, 3);
});

test('promptTitle takes one line and stays short', t => {
	t.is(promptTitle('fix the parser\nand the printer'), 'fix the parser');
	const long = 'x'.repeat(200);
	t.true(promptTitle(long).length <= 60);
	t.true(promptTitle(long).endsWith('…'));
});

test('messagesAfterRewind drops the prompt and everything after it', t => {
	const point = {
		entry: {
			id: 'p',
			seq: 1,
			toolCallId: 'prompt-2',
			toolName: 'prompt',
			title: 'p',
			timestamp: new Date().toISOString(),
			truncateToMessageIndex: 2,
			filesChanged: [],
			createdFiles: [],
			promptText: 'p',
		},
		promptText: 'p',
		messageIndex: 2,
		files: [],
	};

	t.deepEqual(messagesAfterRewind(['a', 'b', 'c', 'd'], point), ['a', 'b']);
	// A point recorded past the end (timeline from a longer session) must not
	// throw, it just leaves the conversation alone.
	t.deepEqual(messagesAfterRewind(['a'], point), ['a']);
});

test('recordPromptStart records a point when nothing is dirty', async t => {
	const captured: unknown[] = [];
	const timeline = {
		getModifiedFiles: () => ({
			files: [],
			truncated: false,
			truncatedCount: 0,
			available: true,
		}),
		snapshotPaths: async () => new Map<string, string | null>(),
		capture: async (input: unknown) => {
			captured.push(input);
			return null;
		},
	} as unknown as TimelineManager;

	await recordPromptStart({
		timeline,
		promptText: 'hello',
		messageIndex: 4,
	});

	t.is(captured.length, 1);
	t.deepEqual(captured[0], {
		toolCallId: 'prompt-4',
		toolName: 'prompt',
		title: 'hello',
		truncateToMessageIndex: 4,
		turnId: undefined,
		promptText: 'hello',
		files: new Map(),
	});
});

test('recordPromptStart omits files when the scan is unreliable', async t => {
	const captured: Array<{files: Map<string, string | null>}> = [];
	const timeline = {
		getModifiedFiles: () => ({
			files: ['src/a.ts'],
			truncated: true,
			truncatedCount: 10,
			available: true,
		}),
		snapshotPaths: async () => new Map<string, string | null>(),
		capture: async (input: {files: Map<string, string | null>}) => {
			captured.push(input);
			return null;
		},
	} as unknown as TimelineManager;

	await recordPromptStart({
		timeline,
		promptText: 'hello',
		messageIndex: 0,
	});

	// A partial before-image would restore a partial turn, so the point keeps
	// the conversation and claims nothing about the files.
	t.is(captured.length, 1);
	t.is(captured[0]?.files.size, 0);
});

test.serial('restoreFiles puts back before-images and deletes created files', async t => {
	const tempDir = await createTempDir();
	try {
		await writeFile(tempDir, 'src/a.ts', 'before');
		const manager = new TimelineManager(tempDir, 'rewind-files');

		const files = new Map<string, string | null>([['src/a.ts', 'before']]);
		const entry = await manager.capture({
			toolCallId: 'prompt-0',
			toolName: 'prompt',
			title: 'first',
			truncateToMessageIndex: 0,
			promptText: 'first',
			files,
		});
		t.truthy(entry);

		// What the turn did: edited the file and created another.
		await fs.writeFile(path.join(tempDir, 'src/a.ts'), 'after', 'utf-8');
		await writeFile(tempDir, 'src/new.ts', 'created');

		// The end-of-turn entry carries the created file, which the start
		// capture could not have known about.
		await manager.capture({
			toolCallId: 'prompt-end-0',
			toolName: 'prompt',
			title: 'first',
			truncateToMessageIndex: 0,
			promptText: 'first',
			files: new Map<string, string | null>([['src/new.ts', null]]),
		});

		const [point] = buildRewindPoints(await manager.list());
		const restored = await restoreFiles(manager, point!);

		t.deepEqual(restored.sort(), ['src/a.ts', 'src/new.ts']);
		t.is(await fs.readFile(path.join(tempDir, 'src/a.ts'), 'utf-8'), 'before');
		await t.throwsAsync(fs.access(path.join(tempDir, 'src/new.ts')));
	} finally {
		await cleanupTempDir(tempDir);
	}
});

test.serial('restoreConversation drops the entries from the point onward', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new TimelineManager(tempDir, 'rewind-conversation');

		for (const [index, seq] of [0, 3].entries()) {
			await manager.capture({
				toolCallId: `prompt-${seq}`,
				toolName: 'prompt',
				title: `prompt ${index}`,
				truncateToMessageIndex: seq,
				promptText: `prompt ${index}`,
				files: new Map(),
			});
		}

		const points = buildRewindPoints(await manager.list());
		t.is(points.length, 2);
		const older = points[1]!;

		const index = await restoreConversation(manager, older);
		t.is(index, 0);

		const remaining = buildRewindPoints(await manager.list());
		t.deepEqual(remaining, []);
	} finally {
		await cleanupTempDir(tempDir);
	}
});
