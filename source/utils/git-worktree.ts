import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

/**
 * Helper to run git commands synchronously.
 * Throws an error with stderr output if the command fails.
 */
function runGitCmd(args: string[], cwd: string = process.cwd()): string {
	try {
		return execFileSync('git', args, {
			cwd,
			encoding: 'utf-8',
			stdio: ['pipe', 'pipe', 'pipe'],
		});
	} catch (error: unknown) {
		const err = error as {stderr?: string; message?: string};
		const stderr = err.stderr?.trim() || err.message;
		throw new Error(`Git command failed (git ${args.join(' ')}): ${stderr}`);
	}
}

/**
 * Checks if the current directory is tracked by Git.
 */
export function isGitRepo(cwd: string = process.cwd()): boolean {
	try {
		runGitCmd(['rev-parse', '--is-inside-work-tree'], cwd);
		return true;
	} catch {
		return false;
	}
}

/**
 * Ensures the Git working tree is completely clean (no uncommitted changes, staged files, or untracked files).
 * Throws an error if the tree is dirty.
 */
export function ensureCleanTree(cwd: string = process.cwd()): void {
	if (!isGitRepo(cwd)) {
		throw new Error('Not a git repository.');
	}

	const status = runGitCmd(['status', '--porcelain'], cwd).trim();
	if (status.length > 0) {
		throw new Error(
			'Git working tree is not clean. Please commit or stash your changes before running Swarm Mode.',
		);
	}
}

/**
 * Creates a new Git worktree at the specified path with a new temporary branch.
 * Throws an error if the path already exists or if the worktree creation fails.
 */
export function createWorktree(
	branchName: string,
	targetPath: string,
	cwd: string = process.cwd(),
): void {
	if (!isGitRepo(cwd)) {
		throw new Error('Not a git repository.');
	}

	const resolvedPath = resolve(cwd, targetPath);
	if (existsSync(resolvedPath)) {
		throw new Error(`Path already exists: ${resolvedPath}`);
	}

	// Validate branch name pattern as an extra safety measure
	if (!branchName.startsWith('nanocoder-swarm-')) {
		throw new Error(
			'Swarm temporary branch names must start with "nanocoder-swarm-"',
		);
	}

	// Check if branch already exists
	try {
		const branches = runGitCmd(['branch', '--list', branchName], cwd).trim();
		if (branches.includes(branchName)) {
			throw new Error(`Branch ${branchName} already exists.`);
		}
	} catch (error: unknown) {
		const err = error as Error;
		if (err.message.includes('already exists')) {
			throw err;
		}
		// Ignore other errors
	}

	try {
		runGitCmd(['worktree', 'add', '-b', branchName, resolvedPath], cwd);
	} catch (error: unknown) {
		const err = error as Error;
		// Attempt cleanup on partial failure
		try {
			runGitCmd(['worktree', 'prune'], cwd);
			runGitCmd(['branch', '-D', branchName], cwd);
		} catch (_cleanupError) {
			// Ignore cleanup errors
		}
		throw new Error(`Failed to create worktree: ${err.message}`);
	}
}

/**
 * Removes a Git worktree and its associated temporary branch.
 */
export function removeWorktree(
	targetPath: string,
	branchName: string,
	cwd: string = process.cwd(),
): void {
	if (!isGitRepo(cwd)) {
		throw new Error('Not a git repository.');
	}

	if (!branchName.startsWith('nanocoder-swarm-')) {
		throw new Error(
			'Cannot delete branch: Name must start with "nanocoder-swarm-" for safety.',
		);
	}

	const resolvedPath = resolve(cwd, targetPath);

	try {
		runGitCmd(['worktree', 'remove', '--force', resolvedPath], cwd);
	} catch (error: unknown) {
		const err = error as Error;
		throw new Error(`Failed to remove worktree: ${err.message}`);
	}

	try {
		runGitCmd(['branch', '-D', branchName], cwd);
	} catch (error: unknown) {
		const err = error as Error;
		throw new Error(`Failed to delete branch ${branchName}: ${err.message}`);
	}
}
