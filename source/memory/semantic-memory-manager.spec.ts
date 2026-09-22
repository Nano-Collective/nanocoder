import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'ava';
import {
	isLockAbandoned,
	SemanticMemoryManager,
} from './semantic-memory-manager.js';

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

test('SemanticMemoryManager ranks by query coverage, not memory length', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});

	await manager.addMemory({
		content: 'Always add tests.',
	});
	const worker = await manager.addMemory({
		content:
			'We decided against introducing a separate background worker process for indexing, because the daemon already owns scheduling and a second long-lived process would complicate the lockfile story.',
	});

	t.deepEqual(
		await manager.findRelevantMemories(
			'should I add a background worker for this',
			5,
		),
		[worker],
	);
});

test('SemanticMemoryManager recalls a memory on a single keyword when it covers half the query', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});

	const auth = await manager.addMemory({
		content:
			'The auth module uses Clerk and avoids middleware in the edge runtime.',
	});

	t.deepEqual(await manager.findRelevantMemories('auth', 3), [auth]);
	t.deepEqual(await manager.findRelevantMemories('fix auth', 3), [auth]);
	t.deepEqual(
		await manager.findRelevantMemories('refactor the auth middleware', 3),
		[auth],
	);
	t.deepEqual(await manager.findRelevantMemories('update clerk auth flow', 3), [
		auth,
	]);
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

test('SemanticMemoryManager rewrites a corrupt store on the next write', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});

	await manager.addMemory({content: 'Auth uses Clerk.'});
	const files = await fs.readdir(dir);
	const store = files.find(name => name.endsWith('.json'));
	t.truthy(store);
	await fs.writeFile(path.join(dir, store!), '{not json', 'utf8');

	const repaired = await manager.addMemory({content: 'Use adapters.'});
	t.deepEqual(await manager.listMemories(), [repaired]);
});

// --- lock reclaim ----------------------------------------------------------
// The lock used to be judged on elapsed time alone: its mtime was stamped at
// acquisition and never refreshed, so "held longer than the stale window" and
// "abandoned" were the same test. Any operation that legitimately ran longer
// had its lock deleted by a waiter in another process, both then ran the
// critical section at once, and the loser's writes were dropped by the final
// atomicWriteFile. Ownership is now decided by the holder's liveness, with the
// heartbeat as the tiebreak.

/** A pid that is definitely not running: spawn a process and wait for it. */
async function deadPid(): Promise<number> {
	const {spawn} = await import('node:child_process');
	const child = spawn(process.execPath, ['-e', '']);
	const pid = child.pid;
	if (pid === undefined) throw new Error('could not spawn a probe process');
	await new Promise(resolve => child.on('exit', resolve));
	return pid;
}

test('isLockAbandoned reclaims a lock whose owner is gone, however fresh it looks', async t => {
	const dir = await createTempDir();
	const lockPath = path.join(dir, 'probe.lock');
	await fs.writeFile(lockPath, String(await deadPid()), 'utf8');

	// Written this instant, so the old elapsed-time test would have said
	// "still held" and waited out the full stale window for nobody.
	t.true(await isLockAbandoned(lockPath));
});

test('isLockAbandoned leaves a live owner alone while its heartbeat is fresh', async t => {
	const dir = await createTempDir();
	const lockPath = path.join(dir, 'probe.lock');
	await fs.writeFile(lockPath, String(process.pid), 'utf8');

	t.false(await isLockAbandoned(lockPath));
});

test('isLockAbandoned reclaims a live owner that stopped heartbeating', async t => {
	const dir = await createTempDir();
	const lockPath = path.join(dir, 'probe.lock');
	// Our own pid, so the liveness probe passes - but the mtime is far older
	// than the stale window, which a heartbeating holder could never produce.
	// This is the escape hatch for a wedged holder, and for a recorded pid
	// that has been recycled by an unrelated process.
	await fs.writeFile(lockPath, String(process.pid), 'utf8');
	const old = new Date(Date.now() - 60_000);
	await fs.utimes(lockPath, old, old);

	t.true(await isLockAbandoned(lockPath));
});

test('a lock left behind by a crashed process does not stall the next write', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});

	// One write to create the store, so its lock path is known.
	await manager.addMemory({content: 'First memory.'});
	const store = (await fs.readdir(dir)).find(name => name.endsWith('.json'));
	t.truthy(store);

	// Simulate the crash: a lock file with a fresh mtime naming a pid that is
	// no longer running.
	const lockPath = path.join(dir, `${store}.lock`);
	await fs.writeFile(lockPath, String(await deadPid()), 'utf8');

	const started = Date.now();
	await manager.addMemory({content: 'Second memory.'});
	const elapsed = Date.now() - started;

	t.is((await manager.listMemories()).length, 2);
	// The old code waited out the full 10s stale window before reclaiming.
	t.true(elapsed < 3_000, `reclaim took ${elapsed}ms`);
});
