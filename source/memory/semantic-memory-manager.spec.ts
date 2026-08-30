import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'ava';
import {SemanticMemoryManager} from './semantic-memory-manager.js';

async function createTempDir(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), 'nanocoder-memory-'));
}

test('SemanticMemoryManager stores and reloads repo-scoped memories', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);

	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});
	const memory = await manager.addMemory({
		content: '  Use the existing auth adapter pattern for Clerk changes.  ',
		sourceSessionId: 'session-1',
	});

	t.is(memory.content, 'Use the existing auth adapter pattern for Clerk changes.');
	t.is(memory.category, 'project');
	t.regex(memory.timestamp, /^\d{4}-\d{2}-\d{2}T/);
	t.is(memory.sourceSessionId, 'session-1');

	const reloaded = new SemanticMemoryManager({memoryDir: dir, cwd});
	t.deepEqual(await reloaded.listMemories(), [memory]);
});

test('SemanticMemoryManager keeps different repositories isolated', async t => {
	const dir = await createTempDir();
	const repoA = path.join(dir, 'repo-a');
	const repoB = path.join(dir, 'repo-b');
	await fs.mkdir(repoA);
	await fs.mkdir(repoB);

	await new SemanticMemoryManager({memoryDir: dir, cwd: repoA}).addMemory({
		content: 'Repo A uses route handlers.',
	});

	const repoBManager = new SemanticMemoryManager({memoryDir: dir, cwd: repoB});
	t.deepEqual(await repoBManager.listMemories(), []);
});

test('SemanticMemoryManager stores memory category', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);

	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});
	const memory = await manager.addMemory({
		content: 'Follow the existing provider abstraction.',
		category: 'architecture',
	});

	t.is(memory.category, 'architecture');
	t.deepEqual(await manager.listMemories(), [memory]);
});

test('SemanticMemoryManager deletes and clears memories', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});

	const first = await manager.addMemory({content: 'Keep components small.'});
	const second = await manager.addMemory({content: 'Prefer existing hooks.'});

	t.true(await manager.deleteMemory(first.id));
	t.false(await manager.deleteMemory(first.id));
	t.deepEqual(await manager.listMemories(), [second]);

	await manager.clearMemories();
	t.deepEqual(await manager.listMemories(), []);
});

test('SemanticMemoryManager returns relevant memories before unrelated ones', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});

	const auth = await manager.addMemory({
		content: 'Auth flow uses Clerk and avoids middleware.',
	});
	await manager.addMemory({
		content: 'Release notes are generated from contributor history.',
	});

	t.deepEqual(await manager.findRelevantMemories('refactor clerk auth', 3), [
		auth,
	]);
});

test('SemanticMemoryManager includes category matches in relevance ranking', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});

	const architecture = await manager.addMemory({
		content: 'Use the service layer for persistence changes.',
		category: 'architecture',
	});
	await manager.addMemory({
		content: 'Release notes are generated from contributor history.',
		category: 'workflow',
	});

	t.deepEqual(await manager.findRelevantMemories('architecture', 3), [
		architecture,
	]);
});

test('SemanticMemoryManager filters out stopword-only matches on an unrelated query', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});

	await manager.addMemory({
		content: 'The auth module uses Clerk and we avoid middleware in the edge runtime.',
	});
	await manager.addMemory({
		content:
			'The flaky test in the payments suite is a known failure and we should fix it later.',
	});
	const style = await manager.addMemory({
		content: 'Use tabs not spaces in the settings form styling.',
	});

	const results = await manager.findRelevantMemories(
		'can you add a new field to the user profile page in the settings form',
		5,
	);

	t.deepEqual(results, [style]);
});

test('SemanticMemoryManager serializes concurrent writes so none are lost', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});

	await Promise.all(
		Array.from({length: 10}, (_, i) =>
			manager.addMemory({content: `Memory number ${i}.`}),
		),
	);

	const memories = await manager.listMemories();
	t.is(memories.length, 10);
});

test('SemanticMemoryManager serializes concurrent writes across manager instances', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const first = new SemanticMemoryManager({memoryDir: dir, cwd});
	const second = new SemanticMemoryManager({memoryDir: dir, cwd});

	await Promise.all([
		...Array.from({length: 10}, (_, i) =>
			first.addMemory({content: `First instance memory ${i}.`}),
		),
		...Array.from({length: 10}, (_, i) =>
			second.addMemory({content: `Second instance memory ${i}.`}),
		),
	]);

	t.is((await first.listMemories()).length, 20);
});

test('SemanticMemoryManager drops oldest memories when the store cap is exceeded', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const manager = new SemanticMemoryManager({
		memoryDir: dir,
		cwd,
		maxStoredMemories: 3,
	});

	for (const index of [1, 2, 3, 4, 5]) {
		await manager.addMemory({
			content: `Auth adapter numbered convention ${index}.`,
		});
		await new Promise(resolve => setTimeout(resolve, 5));
	}

	const memories = await manager.listMemories();
	t.deepEqual(
		memories.map(memory => memory.content),
		[
			'Auth adapter numbered convention 3.',
			'Auth adapter numbered convention 4.',
			'Auth adapter numbered convention 5.',
		],
	);
});

test('SemanticMemoryManager rejects empty memory content', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});

	await t.throwsAsync(manager.addMemory({content: '   '}), {
		message: 'Memory content cannot be empty',
	});
});
