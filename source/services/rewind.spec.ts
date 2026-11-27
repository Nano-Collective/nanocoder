import {execFileSync} from 'child_process';
import * as path from 'path';
import test from 'ava';
import * as fs from 'fs/promises';
import type {Message} from '@/types/core';
import {
	buildRewindPoints,
	listRewindPoints,
	messagesAfterRewind,
	planRewind,
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

function git(dir: string, args: string[]): void {
	execFileSync('git', args, {
		cwd: dir,
		stdio: ['pipe', 'pipe', 'pipe'],
	});
}

/** A repo with one commit, so the timeline scan and HEAD reads both work. */
async function createRepo(): Promise<string> {
	const dir = await createTempDir();
	git(dir, ['init']);
	git(dir, ['config', 'user.email', 'test@example.com']);
	git(dir, ['config', 'user.name', 'Test']);
	await writeFile(dir, 'src/a.ts', 'a0');
	await writeFile(dir, 'notes.txt', 'n0');
	git(dir, ['add', '.']);
	git(dir, ['commit', '-m', 'init']);
	return dir;
}

test('buildRewindPoints keeps one point per prompt, newest first', t => {
	const base = {
		timestamp: new Date().toISOString(),
		createdFiles: [],
	};
	const points = buildRewindPoints([
		{
			...base,
			id: 'a',
			seq: 1,
			toolCallId: 'call-1',
			toolName: 'write_file',
			title: 'write_file: src/a.ts',
			truncateToMessageIndex: 2,
			filesChanged: ['src/a.ts'],
		},
		{
			...base,
			id: 'b',
			seq: 2,
			toolCallId: 'prompt-m1',
			toolName: 'prompt',
			title: 'first',
			truncateToMessageIndex: 0,
			filesChanged: [],
			promptText: 'first prompt',
			messageId: 'm1',
		},
		{
			...base,
			id: 'd',
			seq: 3,
			toolCallId: 'tool-1',
			toolName: 'write_file',
			title: 'write_file: src/a.ts',
			truncateToMessageIndex: 2,
			filesChanged: ['src/a.ts'],
		},
		{
			...base,
			id: 'c',
			seq: 4,
			toolCallId: 'prompt-m2',
			toolName: 'prompt',
			title: 'second',
			truncateToMessageIndex: 2,
			filesChanged: [],
			promptText: 'second prompt',
			messageId: 'm2',
		},
	]);

	// Two prompts, not four: tool checkpoints are not rewind points, and a
	// prompt is recorded once instead of at both ends of its turn.
	t.deepEqual(
		points.map(point => point.promptText),
		['second prompt', 'first prompt'],
	);
	// The first prompt's restore set is every change from that point onward,
	// matching what reverting it actually does.
	t.deepEqual(points[1]?.files, ['src/a.ts']);
	t.is(points[1]?.messageIndex, 0);
});

test('buildRewindPoints resolves the message index by stable id after compaction', t => {
	const entries = [
		{
			id: 'p1',
			seq: 1,
			toolCallId: 'prompt-m1',
			toolName: 'prompt',
			title: 'first',
			timestamp: new Date().toISOString(),
			truncateToMessageIndex: 0,
			filesChanged: [],
			createdFiles: [],
			promptText: 'first',
			messageId: 'm1',
		},
		{
			id: 'p2',
			seq: 2,
			toolCallId: 'prompt-m2',
			toolName: 'prompt',
			title: 'second',
			timestamp: new Date().toISOString(),
			truncateToMessageIndex: 2,
			filesChanged: [],
			createdFiles: [],
			promptText: 'second',
			messageId: 'm2',
		},
	];

	// Compaction dropped m1 and renumbered m2 from 2 to 1. The stored index
	// alone would point at the wrong message; the id does not.
	const messages: Message[] = [
		{role: 'user', content: 'summary'},
		{role: 'user', content: 'second', id: 'm2'},
	];
	const points = buildRewindPoints(entries, messages);

	t.is(points.length, 1);
	t.is(points[0]?.promptText, 'second');
	t.is(points[0]?.messageIndex, 1);
});

test('buildRewindPoints drops points whose message compaction removed', t => {
	const point = {
		id: 'p1',
		seq: 1,
		toolCallId: 'prompt-m1',
		toolName: 'prompt',
		title: 'first',
		timestamp: new Date().toISOString(),
		truncateToMessageIndex: 0,
		filesChanged: [],
		createdFiles: [],
		promptText: 'first',
		messageId: 'm1',
	};

	t.deepEqual(buildRewindPoints([point], []), []);
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
			toolCallId: 'prompt-m',
			toolName: 'prompt',
			title: 'p',
			timestamp: new Date().toISOString(),
			truncateToMessageIndex: 2,
			filesChanged: [],
			createdFiles: [],
			promptText: 'p',
			messageId: 'm',
		},
		promptText: 'p',
		messageIndex: 2,
		files: [],
		createdFiles: [],
	};

	t.deepEqual(messagesAfterRewind(['a', 'b', 'c', 'd'], point), ['a', 'b']);
	// A point recorded past the end (timeline from a longer session) must not
	// throw, it just leaves the conversation alone.
	t.deepEqual(messagesAfterRewind(['a'], point), ['a']);
});

test('recordPromptStart records a marker with no files of its own', async t => {
	const captured: unknown[] = [];
	const timeline = {
		capture: async (input: unknown) => {
			captured.push(input);
			return null;
		},
	} as unknown as TimelineManager;

	await recordPromptStart({
		timeline,
		promptText: 'hello',
		messageIndex: 4,
		turnId: 'turn-1',
		messageId: 'm1',
	});

	t.is(captured.length, 1);
	t.deepEqual(captured[0], {
		toolCallId: 'prompt-m1',
		toolName: 'prompt',
		title: 'hello',
		truncateToMessageIndex: 4,
		turnId: 'turn-1',
		promptText: 'hello',
		messageId: 'm1',
		files: new Map(),
	});
});

test.serial(
	'restoreFiles restores only the files the agent touched, even after the user edits them again',
	async t => {
		const repo = await createRepo();
		try {
			const manager = new TimelineManager(repo, 'rewind-start-end');
			const messages: Message[] = [{role: 'user', content: 'first', id: 'm1'}];

			await recordPromptStart({
				timeline: manager,
				promptText: 'first',
				messageIndex: 0,
				turnId: 'turn-1',
				messageId: 'm1',
			});

			// N1: the user edits a file before the prompt runs. It is not part
			// of the agent's turn, so the old prompt-start snapshot would have
			// captured it.
			await writeFile(repo, 'notes.txt', 'N1');

			// The agent edits src/a.ts. This is the per-tool before-image.
			await manager.capture({
				toolCallId: 'call-1',
				toolName: 'write_file',
				title: 'write_file: src/a.ts',
				truncateToMessageIndex: 1,
				turnId: 'turn-1',
				files: new Map([['src/a.ts', 'a0']]),
			});
			await writeFile(repo, 'src/a.ts', 'a1');

			// N2: the user edits notes.txt again while the turn is running.
			await writeFile(repo, 'notes.txt', 'N2');

			const [point] = await listRewindPoints(manager, messages);
			t.truthy(point);

			const result = await restoreFiles(manager, point!);
			t.deepEqual(result.filesRestored, ['src/a.ts']);
			t.deepEqual(result.filesFailed, []);
			t.is(await fs.readFile(path.join(repo, 'src/a.ts'), 'utf-8'), 'a0');
			// The user's own work is left exactly as they left it.
			t.is(await fs.readFile(path.join(repo, 'notes.txt'), 'utf-8'), 'N2');
		} finally {
			await cleanupTempDir(repo);
		}
	},
);

test.serial('rewind deletes files a tool created and lists them in the plan', async t => {
	const repo = await createRepo();
	try {
		const manager = new TimelineManager(repo, 'rewind-created');
		await recordPromptStart({
			timeline: manager,
			promptText: 'make a file',
			messageIndex: 0,
			turnId: 'turn-1',
			messageId: 'm1',
		});
		await manager.capture({
			toolCallId: 'call-1',
			toolName: 'write_file',
			title: 'write_file: src/new.ts',
			truncateToMessageIndex: 1,
			turnId: 'turn-1',
			files: new Map([['src/new.ts', null]]),
		});
		await writeFile(repo, 'src/new.ts', 'created');

		const [point] = await listRewindPoints(manager);
		const plan = await planRewind(manager, point!);
		t.deepEqual(plan.remove, ['src/new.ts']);
		t.deepEqual(plan.restore, []);

		const result = await restoreFiles(manager, point!);
		t.deepEqual(result.filesRestored, ['src/new.ts']);
		await t.throwsAsync(fs.access(path.join(repo, 'src/new.ts')));
	} finally {
		await cleanupTempDir(repo);
	}
});

test.serial('a restore refuses to write through a symlink leaving the workspace', async t => {
	const repo = await createRepo();
	const outside = await createTempDir();
	try {
		const target = path.join(outside, 'outside.txt');
		await fs.writeFile(target, 'outside', 'utf-8');
		try {
			await fs.rm(path.join(repo, 'src/a.ts'));
			await fs.symlink(target, path.join(repo, 'src/a.ts'));
		} catch {
			t.pass('symlinks unavailable on this platform');
			return;
		}

		const manager = new TimelineManager(repo, 'rewind-symlink');
		await recordPromptStart({
			timeline: manager,
			promptText: 'edit',
			messageIndex: 0,
			turnId: 'turn-1',
			messageId: 'm1',
		});
		await manager.capture({
			toolCallId: 'call-1',
			toolName: 'write_file',
			title: 'write_file: src/a.ts',
			truncateToMessageIndex: 1,
			turnId: 'turn-1',
			files: new Map([['src/a.ts', 'a0']]),
		});

		const [point] = await listRewindPoints(manager);
		const result = await restoreFiles(manager, point!);

		t.deepEqual(result.filesRestored, []);
		t.deepEqual(result.filesFailed, ['src/a.ts']);
		t.is(await fs.readFile(target, 'utf-8'), 'outside');
	} finally {
		await cleanupTempDir(repo);
		await cleanupTempDir(outside);
	}
});

test.serial('a partial restore reports the files it could not write', async t => {
	const repo = await createRepo();
	try {
		const manager = new TimelineManager(repo, 'rewind-partial');
		await recordPromptStart({
			timeline: manager,
			promptText: 'edit',
			messageIndex: 0,
			turnId: 'turn-1',
			messageId: 'm1',
		});
		// `blocked` is a file, so writing blocked/x.ts fails after src/a.ts
		// has already been restored.
		await writeFile(repo, 'blocked', 'not a directory');
		await manager.capture({
			toolCallId: 'call-1',
			toolName: 'write_file',
			title: 'write_file',
			truncateToMessageIndex: 1,
			turnId: 'turn-1',
			files: new Map([
				['src/a.ts', 'a0'],
				['blocked/x.ts', 'before'],
			]),
		});
		await writeFile(repo, 'src/a.ts', 'a1');

		const [point] = await listRewindPoints(manager);
		const result = await restoreFiles(manager, point!);

		t.deepEqual(result.filesRestored, ['src/a.ts']);
		t.deepEqual(result.filesFailed, ['blocked/x.ts']);
		t.is(await fs.readFile(path.join(repo, 'src/a.ts'), 'utf-8'), 'a0');
	} finally {
		await cleanupTempDir(repo);
	}
});

test.serial('restoreConversation drops the entries from the point onward', async t => {
	const tempDir = await createTempDir();
	try {
		const manager = new TimelineManager(tempDir, 'rewind-conversation');
		const messages: Message[] = [
			{role: 'user', content: 'prompt 0', id: 'm0'},
			{role: 'user', content: 'prompt 1', id: 'm3'},
		];

		for (const [index, messageIndex] of [0, 1].entries()) {
			await manager.capture({
				toolCallId: `prompt-${messageIndex}`,
				toolName: 'prompt',
				title: `prompt ${index}`,
				truncateToMessageIndex: messageIndex,
				promptText: `prompt ${index}`,
				messageId: messages[index]!.id,
				files: new Map(),
			});
		}

		const points = await listRewindPoints(manager, messages);
		t.is(points.length, 2);
		const older = points[1]!;

		const index = await restoreConversation(manager, older);
		t.is(index, 0);

		t.deepEqual(await manager.list(), []);
	} finally {
		await cleanupTempDir(tempDir);
	}
});
