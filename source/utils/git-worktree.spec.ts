import {execFileSync} from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type ExecutionContext} from 'ava';
import {
	createWorktree,
	ensureCleanTree,
	ensureSwarmExcludes,
	removeWorktree,
} from './git-worktree';

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, {cwd, encoding: 'utf-8', stdio: 'pipe'});
}

function createTestRepo(t: ExecutionContext): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), 'nanocoder-worktree-')));
	t.teardown(() => rmSync(dir, {recursive: true, force: true}));
	git(dir, 'init', '-q');
	git(dir, 'config', 'user.name', 'Test User');
	git(dir, 'config', 'user.email', 'test@example.com');
	writeFileSync(join(dir, 'README.md'), '# Test Repo');
	git(dir, 'add', 'README.md');
	git(dir, 'commit', '-qm', 'initial');
	return dir;
}

test('ensureCleanTree accepts a clean tree', async t => {
	await t.notThrowsAsync(ensureCleanTree(createTestRepo(t)));
});

test('ensureCleanTree rejects untracked, staged and modified files', async t => {
	for (const [file, stage] of [
		['new.txt', false],
		['new.txt', true],
		['README.md', false],
	] as const) {
		const dir = createTestRepo(t);
		writeFileSync(join(dir, file), 'changed');
		if (stage) git(dir, 'add', file);
		await t.throwsAsync(ensureCleanTree(dir), {
			message: /Git working tree is not clean/,
		});
	}
});

test('createWorktree and removeWorktree manage a branch and a directory', async t => {
	const dir = createTestRepo(t);
	const branch = 'nanocoder-swarm-1';

	await createWorktree(branch, 'worker-1', 'HEAD', dir);
	t.true(existsSync(join(dir, 'worker-1', 'README.md')));

	await removeWorktree('worker-1', branch, dir);
	t.false(existsSync(join(dir, 'worker-1')));
	t.is(git(dir, 'branch', '--list', branch), '');
});

test('createWorktree never replaces an existing path or branch', async t => {
	const dir = createTestRepo(t);
	mkdirSync(join(dir, 'taken'));
	writeFileSync(join(dir, 'taken', 'keep.txt'), 'keep');
	await t.throwsAsync(
		createWorktree('nanocoder-swarm-2', 'taken', 'HEAD', dir),
		{message: /Path already exists/},
	);
	t.true(existsSync(join(dir, 'taken', 'keep.txt')));

	git(dir, 'branch', 'nanocoder-swarm-3');
	await t.throwsAsync(
		createWorktree('nanocoder-swarm-3', 'worker-3', 'HEAD', dir),
		{message: /already exists/},
	);
});

test('worktree helpers refuse branches outside the swarm prefix', async t => {
	const dir = createTestRepo(t);
	const message = /must start with "nanocoder-swarm-"/;
	await t.throwsAsync(createWorktree('main', 'worker', 'HEAD', dir), {message});
	await t.throwsAsync(removeWorktree('worker', 'main', dir), {message});
});

test('ensureSwarmExcludes hides run files once, without touching tracked files', async t => {
	const dir = createTestRepo(t);
	await ensureSwarmExcludes(dir);
	await ensureSwarmExcludes(dir);

	mkdirSync(join(dir, '.nanocoder', 'swarm', 'run'), {recursive: true});
	writeFileSync(join(dir, '.nanocoder', 'swarm', 'run', 'a.patch'), 'x');
	await t.notThrowsAsync(ensureCleanTree(dir));
	const content = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf-8');
	t.is(content.split('.nanocoder/swarm/').length - 1, 1);
});
