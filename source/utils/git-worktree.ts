import {execFile} from 'node:child_process';
import {appendFileSync, existsSync, mkdirSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

const BRANCH_PREFIX = 'nanocoder-swarm-';
const SWARM_EXCLUDE = '.nanocoder/swarm/';

export async function runGit(args: string[], cwd: string): Promise<string> {
	try {
		const {stdout} = await execFileAsync('git', args, {
			cwd,
			maxBuffer: 64 * 1024 * 1024,
		});
		return stdout;
	} catch (error: unknown) {
		const err = error as {stderr?: string; message?: string};
		const detail = err.stderr?.trim() || err.message;
		throw new Error(`Git command failed (git ${args.join(' ')}): ${detail}`);
	}
}

export async function ensureCleanTree(cwd: string): Promise<void> {
	const status = await runGit(['status', '--porcelain'], cwd);
	if (status.trim().length > 0) {
		throw new Error(
			'Git working tree is not clean. Please commit or stash your changes before running swarm.',
		);
	}
}

function assertSwarmBranch(branchName: string): void {
	if (!branchName.startsWith(BRANCH_PREFIX)) {
		throw new Error(
			`Swarm temporary branch names must start with "${BRANCH_PREFIX}"`,
		);
	}
}

/** Fails, without deleting anything, if the path or the branch already exists. */
export async function createWorktree(
	branchName: string,
	targetPath: string,
	baseCommit: string,
	cwd: string,
): Promise<void> {
	assertSwarmBranch(branchName);
	const resolvedPath = resolve(cwd, targetPath);
	if (existsSync(resolvedPath)) {
		throw new Error(`Path already exists: ${resolvedPath}`);
	}
	await runGit(
		['worktree', 'add', '-b', branchName, resolvedPath, baseCommit],
		cwd,
	);
}

export async function removeWorktree(
	targetPath: string,
	branchName: string,
	cwd: string,
): Promise<void> {
	assertSwarmBranch(branchName);
	await runGit(
		['worktree', 'remove', '--force', resolve(cwd, targetPath)],
		cwd,
	);
	await runGit(['branch', '-D', branchName], cwd);
}

/**
 * Keeps swarm worktrees, patches and logs out of `git status` through
 * `.git/info/exclude`, so one run does not leave the tree too dirty to start
 * the next, and no tracked file is touched.
 */
export async function ensureSwarmExcludes(cwd: string): Promise<void> {
	const excludePath = resolve(
		cwd,
		(await runGit(['rev-parse', '--git-path', 'info/exclude'], cwd)).trim(),
	);
	const existing = existsSync(excludePath)
		? readFileSync(excludePath, 'utf-8')
		: '';
	if (existing.split('\n').includes(SWARM_EXCLUDE)) return;
	mkdirSync(dirname(excludePath), {recursive: true});
	const prefix = existing === '' || existing.endsWith('\n') ? '' : '\n';
	appendFileSync(excludePath, `${prefix}${SWARM_EXCLUDE}\n`);
}
