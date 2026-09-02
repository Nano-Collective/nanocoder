import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {executeSwarmMerge, executeSwarmRollback} from './merge-manager';
import type {TaskDefinition} from './coordinator-utils';

function createTestRepo(name: string): string {
	const testDir = join(tmpdir(), 'nanocoder-merge-test', name);
	rmSync(testDir, {recursive: true, force: true});
	mkdirSync(testDir, {recursive: true});

	// Initialize git repo
	execSync('git init', {cwd: testDir});
	execSync('git config user.name "Test User"', {cwd: testDir});
	execSync('git config user.email "test@example.com"', {cwd: testDir});
	
	// Create some files
	mkdirSync(join(testDir, 'src/auth'), {recursive: true});
	mkdirSync(join(testDir, 'src/api'), {recursive: true});
	writeFileSync(join(testDir, 'src/auth/login.ts'), 'export const login = () => {};\n');
	writeFileSync(join(testDir, 'src/api/routes.ts'), 'export const routes = [];\n');
	writeFileSync(join(testDir, '.gitignore'), '.nanocoder\n');
	
	execSync('git add .', {cwd: testDir});
	execSync('git commit -m "Initial commit"', {cwd: testDir});

	return testDir;
}

test.serial('executeSwarmMerge: applies 3-way merge from multiple workers', async t => {
	const dir = createTestRepo('merge-success');
	const commit = execSync('git rev-parse HEAD', {cwd: dir}).toString().trim();

	const tasks: TaskDefinition[] = [
		{id: 'w1', description: '', fileScope: ['src/auth']},
		{id: 'w2', description: '', fileScope: ['src/api']},
	];

	// Create worktrees and make changes
	execSync(`git worktree add .nanocoder/worktrees/w1 -b nanocoder-swarm-w1 ${commit}`, {cwd: dir});
	execSync(`git worktree add .nanocoder/worktrees/w2 -b nanocoder-swarm-w2 ${commit}`, {cwd: dir});

	writeFileSync(join(dir, '.nanocoder/worktrees/w1/src/auth/login.ts'), 'export const login = () => { return true; };\n');
	writeFileSync(join(dir, '.nanocoder/worktrees/w2/src/api/routes.ts'), 'export const routes = ["/api/v1"];\n');

	// Commit changes in worktrees
	execSync('git commit -am "w1 change"', {cwd: join(dir, '.nanocoder/worktrees/w1')});
	execSync('git commit -am "w2 change"', {cwd: join(dir, '.nanocoder/worktrees/w2')});

	// Run merge
	await t.notThrowsAsync(() => executeSwarmMerge(tasks, commit, dir, 'apply'));

	// Verify working tree has the merged changes
	const authContent = readFileSync(join(dir, 'src/auth/login.ts'), 'utf-8');
	const apiContent = readFileSync(join(dir, 'src/api/routes.ts'), 'utf-8');
	
	t.true(authContent.includes('return true;'));
	t.true(apiContent.includes('"/api/v1"'));

	// Verify patches were saved
	t.true(existsSync(join(dir, '.nanocoder', 'w1.patch')));
	t.true(existsSync(join(dir, '.nanocoder', 'w2.patch')));

	// Verify worktrees were cleaned up
	t.false(existsSync(join(dir, '.nanocoder/worktrees/w1')));
	t.false(existsSync(join(dir, '.nanocoder/worktrees/w2')));
});

test.serial('executeSwarmMerge: rejects out-of-scope bash edit via git diff --name-only', async t => {
	const dir = createTestRepo('merge-out-of-scope');
	const commit = execSync('git rev-parse HEAD', {cwd: dir}).toString().trim();

	const tasks: TaskDefinition[] = [
		{id: 'w1', description: '', fileScope: ['src/auth']},
	];

	execSync(`git worktree add .nanocoder/worktrees/w1 -b nanocoder-swarm-w1 ${commit}`, {cwd: dir});

	// Worker makes an out-of-scope edit (e.g. via bash)
	writeFileSync(join(dir, '.nanocoder/worktrees/w1/src/api/routes.ts'), 'export const routes = ["hacked"];\n');
	execSync('git commit -am "w1 hacked change"', {cwd: join(dir, '.nanocoder/worktrees/w1')});

	// Run merge - should throw
	await t.throwsAsync(() => executeSwarmMerge(tasks, commit, dir, 'apply'), {
		message: /Scope violation: Worker w1 modified src\/api\/routes.ts which is outside its scope/
	});

	// Worktree should still be cleaned up due to finally block
	t.false(existsSync(join(dir, '.nanocoder/worktrees/w1')));
});

test.serial('executeSwarmMerge: patch recovery explicitly preserves successful workers', async t => {
	const dir = createTestRepo('patch-recovery');
	const commit = execSync('git rev-parse HEAD', {cwd: dir}).toString().trim();

	const tasks: TaskDefinition[] = [
		{id: 'w1', description: '', fileScope: ['src/auth']},
		{id: 'w2', description: '', fileScope: ['src/api']},
	];

	execSync(`git worktree add .nanocoder/worktrees/w1 -b nanocoder-swarm-w1 ${commit}`, {cwd: dir});
	execSync(`git worktree add .nanocoder/worktrees/w2 -b nanocoder-swarm-w2 ${commit}`, {cwd: dir});

	// W1 makes a valid edit
	writeFileSync(join(dir, '.nanocoder/worktrees/w1/src/auth/login.ts'), 'export const login = () => { return true; };\n');
	execSync('git commit -am "w1 change"', {cwd: join(dir, '.nanocoder/worktrees/w1')});

	// W2 makes an invalid out-of-scope edit
	writeFileSync(join(dir, '.nanocoder/worktrees/w2/src/auth/login.ts'), 'export const login = () => { return false; };\n');
	execSync('git commit -am "w2 invalid change"', {cwd: join(dir, '.nanocoder/worktrees/w2')});

	// Run merge - should throw on w2
	await t.throwsAsync(() => executeSwarmMerge(tasks, commit, dir, 'apply'), {
		message: /Scope violation/
	});

	// W1 patch should still exist because W1 succeeded before W2 threw
	t.true(existsSync(join(dir, '.nanocoder', 'w1.patch')));
});

test.serial('executeSwarmRollback: restores byte-for-byte cleanly', async t => {
	const dir = createTestRepo('merge-rollback');
	const commit = execSync('git rev-parse HEAD', {cwd: dir}).toString().trim();

	const tasks: TaskDefinition[] = [
		{id: 'w1', description: '', fileScope: ['src/auth']},
	];

	execSync(`git worktree add .nanocoder/worktrees/w1 -b nanocoder-swarm-w1 ${commit}`, {cwd: dir});

	// Simulate a partial failure: we modify the main repo manually to mimic a partially applied patch
	writeFileSync(join(dir, 'src/auth/login.ts'), 'PARTIAL_APPLY_GARBAGE');
	
	// Also add an untracked file to simulate a stray artifact
	writeFileSync(join(dir, 'src/auth/untracked.ts'), 'untracked');

	// Create a patch in .nanocoder to ensure it is preserved
	mkdirSync(join(dir, '.nanocoder'), {recursive: true});
	writeFileSync(join(dir, '.nanocoder', 'w1.patch'), 'patch data');

	await t.notThrowsAsync(() => executeSwarmRollback(tasks, commit, dir));

	// Verify working tree is clean
	const status = execSync('git status --porcelain', {cwd: dir}).toString();
	// Exclude .nanocoder from clean check since it's ignored/untracked
	const relevantStatus = status.split('\n').filter(s => s.trim() && !s.includes('.nanocoder'));
	t.is(relevantStatus.length, 0);

	// Verify byte-for-byte restoration of the original file
	const authContent = readFileSync(join(dir, 'src/auth/login.ts'), 'utf-8');
	t.is(authContent, 'export const login = () => {};\n');

	// Verify the untracked file is gone
	t.false(existsSync(join(dir, 'src/auth/untracked.ts')));

	// Verify the worktree is gone
	t.false(existsSync(join(dir, '.nanocoder/worktrees/w1')));

	// Verify the patch is preserved
	t.true(existsSync(join(dir, '.nanocoder', 'w1.patch')));
});
