import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'ava';
import {appendRelevantProjectContextWithCount} from './project-context.js';
import {
	isLockAbandoned,
	SemanticMemoryManager,
} from './semantic-memory-manager.js';

async function createTempDir(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), 'nanocoder-memory-'));
}

/** Runs git with the contributor's global and system config kept out. */
function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		stdio: 'pipe',
		env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'},
	}).trim();
}

function commitAll(repo: string, message: string): void {
	git(repo, 'add', '-A');
	git(
		repo,
		'-c',
		'user.email=test@example.com',
		'-c',
		'user.name=Test',
		'-c',
		'commit.gpgsign=false',
		'commit',
		'-q',
		'-m',
		message,
	);
}

async function writeFiles(
	root: string,
	files: Record<string, string>,
): Promise<void> {
	for (const [file, content] of Object.entries(files)) {
		await fs.mkdir(path.dirname(path.join(root, file)), {recursive: true});
		await fs.writeFile(path.join(root, file), content, 'utf8');
	}
}

/** A committed repo at `<dir>/repo`; memories are stored in `<dir>`. */
async function createGitRepo(
	files: Record<string, string>,
): Promise<{dir: string; repo: string}> {
	const dir = await createTempDir();
	const repo = path.join(dir, 'repo');
	await fs.mkdir(repo);
	git(repo, 'init', '-q', '-b', 'main');
	await writeFiles(repo, files);
	commitAll(repo, 'init');
	return {dir, repo};
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

// --- git snapshots and freshness -------------------------------------------
// A memory about a file is only as current as that file. Each save records
// the commit, branch and the content hash of every tracked file the memory
// mentions, so recall can flag memories whose files have since changed.

test('SemanticMemoryManager records commit, branch and hashes of tracked files a memory mentions', async t => {
	const {dir, repo} = await createGitRepo({
		'src/auth.ts': 'export const refresh = () => token;\n',
		'src/db.ts': 'export const pool = createPool();\n',
		'README.md': '# Project\n',
	});
	await writeFiles(repo, {'notes.md': 'untracked scratch notes\n'});
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd: repo});

	const memory = await manager.addMemory({
		content:
			'src/auth.ts refreshes tokens before retrying, and `db.ts` owns the pool. See notes.md and Node.js docs.',
	});

	t.deepEqual(memory.git, {
		commit: git(repo, 'rev-parse', 'HEAD'),
		branch: 'main',
		files: {
			'src/auth.ts': git(repo, 'hash-object', 'src/auth.ts'),
			'src/db.ts': git(repo, 'hash-object', 'src/db.ts'),
		},
	});
	const reloaded = new SemanticMemoryManager({memoryDir: dir, cwd: repo});
	t.deepEqual(await reloaded.listMemories(), [memory]);
});

test('SemanticMemoryManager resolves file references from a subdirectory to repo-relative paths', async t => {
	const {dir, repo} = await createGitRepo({
		'packages/api/src/auth.ts': 'export const refresh = 1;\n',
	});
	const manager = new SemanticMemoryManager({
		memoryDir: dir,
		cwd: path.join(repo, 'packages', 'api'),
	});

	const memory = await manager.addMemory({
		content: 'auth.ts refreshes tokens.',
	});

	t.deepEqual(Object.keys(memory.git?.files ?? {}), [
		'packages/api/src/auth.ts',
	]);
});

test('SemanticMemoryManager skips a bare file name that matches several tracked files', async t => {
	const {dir, repo} = await createGitRepo({
		'web/index.ts': 'export * from "./app";\n',
		'server/index.ts': 'export * from "./main";\n',
	});
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd: repo});

	const ambiguous = await manager.addMemory({
		content: 'index.ts re-exports everything.',
	});
	const explicit = await manager.addMemory({
		content: 'server/index.ts re-exports the server entry point.',
	});

	t.deepEqual(ambiguous.git?.files, {});
	t.deepEqual(Object.keys(explicit.git?.files ?? {}), ['server/index.ts']);
});

test('SemanticMemoryManager saves without a git snapshot outside a repository', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});

	const memory = await manager.addMemory({content: 'auth.ts uses Clerk.'});

	t.is(memory.git, undefined);
	t.deepEqual(await manager.listMemories(), [memory]);
});

test('SemanticMemoryManager saves without a git snapshot before the first commit', async t => {
	const dir = await createTempDir();
	const repo = path.join(dir, 'repo');
	await fs.mkdir(repo);
	git(repo, 'init', '-q', '-b', 'main');
	await writeFiles(repo, {'auth.ts': 'export {};\n'});
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd: repo});

	const memory = await manager.addMemory({content: 'auth.ts uses Clerk.'});

	t.is(memory.git, undefined);
});

test('SemanticMemoryManager leaves the branch out on a detached HEAD', async t => {
	const {dir, repo} = await createGitRepo({'auth.ts': 'export {};\n'});
	git(repo, 'checkout', '-q', '--detach');
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd: repo});

	const memory = await manager.addMemory({content: 'auth.ts uses Clerk.'});

	t.is(memory.git?.commit, git(repo, 'rev-parse', 'HEAD'));
	t.is(memory.git?.branch, undefined);
});

test('findChangedFiles reports edited and deleted files, uncommitted ones included', async t => {
	const {dir, repo} = await createGitRepo({
		'src/auth.ts': 'export const refresh = 1;\n',
		'src/db.ts': 'export const pool = 1;\n',
		'src/cache.ts': 'export const cache = 1;\n',
		'src/other.ts': 'export const other = 1;\n',
	});
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd: repo});
	const edited = await manager.addMemory({content: 'src/auth.ts refreshes.'});
	const deleted = await manager.addMemory({content: 'src/db.ts owns the pool.'});
	const untouched = await manager.addMemory({
		content: 'src/cache.ts is in-memory only.',
	});

	await writeFiles(repo, {
		'src/auth.ts': 'export const refresh = 2;\n',
		'src/other.ts': 'export const other = 2;\n',
	});
	await fs.unlink(path.join(repo, 'src/db.ts'));

	const changes = await manager.findChangedFiles([edited, deleted, untouched]);

	t.deepEqual(
		[...changes],
		[
			[edited.id, [{path: 'src/auth.ts', status: 'modified'}]],
			[deleted.id, [{path: 'src/db.ts', status: 'deleted'}]],
		],
	);
});

test('findChangedFiles does not flag a memory just because HEAD moved on', async t => {
	const {dir, repo} = await createGitRepo({
		'src/auth.ts': 'export const refresh = 1;\n',
		'src/other.ts': 'export const other = 1;\n',
	});
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd: repo});
	const memory = await manager.addMemory({content: 'src/auth.ts refreshes.'});

	await writeFiles(repo, {'src/other.ts': 'export const other = 2;\n'});
	commitAll(repo, 'unrelated change');

	t.is((await manager.findChangedFiles([memory])).size, 0);
});

test('findChangedFiles ignores memories saved without a snapshot', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});
	const memory = await manager.addMemory({content: 'auth.ts uses Clerk.'});

	t.is((await manager.findChangedFiles([memory])).size, 0);
});

test('listMemories keeps a memory whose git snapshot is malformed and drops the snapshot', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});
	await manager.addMemory({content: 'Seed the store.'});
	const store = (await fs.readdir(dir)).find(name => name.endsWith('.json'));
	t.truthy(store);

	const base = {category: 'project', timestamp: '2026-10-06T00:00:00.000Z'};
	await fs.writeFile(
		path.join(dir, store!),
		JSON.stringify([
			{...base, id: 'a', content: 'Wrong type.', git: {commit: 42, files: {}}},
			{
				...base,
				id: 'b',
				content: 'Escapes the repo.',
				git: {commit: 'abc', files: {'../outside.ts': 'abc'}},
			},
			{
				...base,
				id: 'c',
				content: 'Valid.',
				git: {commit: 'abc', files: {'src/auth.ts': 'def'}},
			},
		]),
		'utf8',
	);

	t.deepEqual(await manager.listMemories(), [
		{...base, id: 'a', content: 'Wrong type.'},
		{...base, id: 'b', content: 'Escapes the repo.'},
		{
			...base,
			id: 'c',
			content: 'Valid.',
			git: {commit: 'abc', files: {'src/auth.ts': 'def'}},
		},
	]);
});

test('recalled project context warns about a memory whose file changed after it was saved', async t => {
	const {dir, repo} = await createGitRepo({
		'src/auth.ts': 'export const refresh = () => token;\n',
	});
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd: repo});
	await manager.addMemory({
		content: 'src/auth.ts refreshes the auth token before retrying.',
	});
	const recall = () =>
		appendRelevantProjectContextWithCount('base prompt', 'auth token', manager);

	t.is(
		(await recall()).systemPrompt,
		'base prompt\n\n## Project Context\n\n```\n- src/auth.ts refreshes the auth token before retrying.\n```',
	);

	await writeFiles(repo, {
		'src/auth.ts': 'export const refresh = () => rotate(token);\n',
	});
	const commit = git(repo, 'rev-parse', '--short=7', 'HEAD');

	t.is(
		(await recall()).systemPrompt,
		`base prompt\n\n## Project Context\n\n\`\`\`\n- [WARNING: recorded at ${commit}, src/auth.ts has changed since. Verify before trusting.] src/auth.ts refreshes the auth token before retrying.\n\`\`\``,
	);
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
