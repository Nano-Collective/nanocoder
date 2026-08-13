import {execSync} from 'node:child_process';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	createWorktree,
	ensureCleanTree,
	isGitRepo,
	removeWorktree,
} from './git-worktree';

// Helper to create a temporary test repo
function createTestRepo(name: string): string {
	const testDir = join(process.cwd(), '.test-temp', name);
	rmSync(testDir, {recursive: true, force: true});
	mkdirSync(testDir, {recursive: true});

	// Initialize git repo
	execSync('git init', {cwd: testDir});
	execSync('git config user.name "Test User"', {cwd: testDir});
	execSync('git config user.email "test@example.com"', {cwd: testDir});
	
	// Create initial commit
	writeFileSync(join(testDir, 'README.md'), '# Test Repo');
	execSync('git add README.md', {cwd: testDir});
	execSync('git commit -m "Initial commit"', {cwd: testDir});

	return testDir;
}

test('isGitRepo returns true for valid repo', t => {
	const dir = createTestRepo('is-git-repo-test');
	t.true(isGitRepo(dir));
});

test('isGitRepo returns false for non-repo', t => {
	const dir = join(tmpdir(), 'nanocoder-non-repo-test');
	rmSync(dir, {recursive: true, force: true});
	mkdirSync(dir, {recursive: true});
	t.false(isGitRepo(dir));
});

test('ensureCleanTree passes on clean repo', t => {
	const dir = createTestRepo('clean-tree-test');
	t.notThrows(() => ensureCleanTree(dir));
});

test('ensureCleanTree throws on untracked files', t => {
	const dir = createTestRepo('untracked-file-test');
	writeFileSync(join(dir, 'new-file.txt'), 'hello');
	t.throws(() => ensureCleanTree(dir), {
		message: /Git working tree is not clean/,
	});
});

test('ensureCleanTree throws on staged files', t => {
	const dir = createTestRepo('staged-file-test');
	writeFileSync(join(dir, 'new-file.txt'), 'hello');
	execSync('git add new-file.txt', {cwd: dir});
	t.throws(() => ensureCleanTree(dir), {
		message: /Git working tree is not clean/,
	});
});

test('ensureCleanTree throws on modified files', t => {
	const dir = createTestRepo('modified-file-test');
	writeFileSync(join(dir, 'README.md'), 'modified');
	t.throws(() => ensureCleanTree(dir), {
		message: /Git working tree is not clean/,
	});
});

test('createWorktree creates a new worktree and branch', t => {
	const dir = createTestRepo('create-worktree-test');
	const branchName = 'nanocoder-swarm-worker-1';
	const wtPath = join(dir, 'worker-1');
	
	t.notThrows(() => createWorktree(branchName, 'worker-1', dir));
	
	// Check if worktree exists
	const worktrees = execSync('git worktree list', {cwd: dir, encoding: 'utf-8'});
	t.true(worktrees.includes(branchName));
	t.true(worktrees.includes(wtPath));
});

test('createWorktree throws on unsafe branch name', t => {
	const dir = createTestRepo('unsafe-branch-test');
	t.throws(() => createWorktree('unsafe-branch', 'worker-1', dir), {
		message: /Swarm temporary branch names must start with "nanocoder-swarm-"/,
	});
});

test('createWorktree throws if branch already exists', t => {
	const dir = createTestRepo('branch-exists-test');
	const branchName = 'nanocoder-swarm-worker-2';
	execSync(`git branch ${branchName}`, {cwd: dir});
	
	t.throws(() => createWorktree(branchName, 'worker-2', dir), {
		message: new RegExp(`Branch ${branchName} already exists`),
	});
});

test('removeWorktree successfully removes worktree and branch', t => {
	const dir = createTestRepo('remove-worktree-test');
	const branchName = 'nanocoder-swarm-worker-3';
	
	createWorktree(branchName, 'worker-3', dir);
	t.notThrows(() => removeWorktree('worker-3', branchName, dir));
	
	// Check if worktree is removed
	const worktrees = execSync('git worktree list', {cwd: dir, encoding: 'utf-8'});
	t.false(worktrees.includes('worker-3'));
	
	// Check if branch is removed
	const branches = execSync('git branch --list', {cwd: dir, encoding: 'utf-8'});
	t.false(branches.includes(branchName));
});

test('removeWorktree throws on unsafe branch name', t => {
	const dir = createTestRepo('remove-unsafe-branch-test');
	t.throws(() => removeWorktree('worker-1', 'unsafe-branch', dir), {
		message: /Name must start with "nanocoder-swarm-" for safety/,
	});
});
