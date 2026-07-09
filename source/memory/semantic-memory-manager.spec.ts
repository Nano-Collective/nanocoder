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

test('SemanticMemoryManager rejects empty memory content', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});

	await t.throwsAsync(manager.addMemory({content: '   '}), {
		message: 'Memory content cannot be empty',
	});
});
