import {lstatSync, mkdirSync, rmSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {execGh, execGit} from '@/tools/git/utils';

type WorktreeDependencies = {
	execGit: (args: string[]) => Promise<string>;
	execGh: (args: string[]) => Promise<string>;
	changeDirectory: (path: string) => void;
};

const defaultDependencies: WorktreeDependencies = {
	execGit,
	execGh,
	changeDirectory: path => process.chdir(path),
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function pathExists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw error;
	}
}

function githubRepoFromRemote(url: string): string | null {
	const match = url
		.trim()
		.match(
			/^(?:https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+)\/([^/]+)\/?$/i,
		);
	if (!match) return null;
	const name = match[2].replace(/\.git$/i, '');
	return /^[\w.-]+$/.test(match[1]) && /^[\w.-]+$/.test(name)
		? `${match[1]}/${name}`
		: null;
}

function registeredBranchAtPath(output: string, path: string): string | null {
	const target =
		process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
	for (const block of output.split(/\r?\n\r?\n/)) {
		const lines = block.split(/\r?\n/);
		const registeredPath = lines
			.find(line => line.startsWith('worktree '))
			?.slice(9);
		if (!registeredPath) continue;
		const normalized =
			process.platform === 'win32'
				? resolve(registeredPath).toLowerCase()
				: resolve(registeredPath);
		if (normalized === target) {
			return (
				lines.find(line => line.startsWith('branch '))?.slice(7) ?? '(detached)'
			);
		}
	}
	return null;
}

/** Accept exactly one positive decimal PR number, before any Git operations. */
export function parseWorktreePrNumber(args: string[]): string {
	if (args.length !== 1 || !/^[1-9]\d*$/.test(args[0])) {
		throw new Error(
			'Usage: nanocoder worktree <PR-number> (a positive GitHub PR number is required).',
		);
	}
	return args[0];
}

/** Create a sibling worktree and enter it before the interactive app loads. */
export async function createPrWorktree(
	prNumber: string,
	launchDirectory: string = process.cwd(),
	dependencies: WorktreeDependencies = defaultDependencies,
): Promise<string> {
	parseWorktreePrNumber([prNumber]);
	const git = dependencies.execGit;
	const gh = dependencies.execGh;

	try {
		await git(['--version']);
	} catch {
		throw new Error(
			'Git is required for `nanocoder worktree`. Install Git and try again.',
		);
	}
	try {
		await gh(['--version']);
	} catch {
		throw new Error(
			'GitHub CLI (gh) is required for `nanocoder worktree`. Install it from https://cli.github.com.',
		);
	}
	try {
		await gh(['auth', 'status', '--hostname', 'github.com']);
	} catch {
		throw new Error(
			'GitHub CLI is not authenticated. Run `gh auth login` and try again.',
		);
	}

	let root: string;
	try {
		root = resolve(
			await git(['-C', launchDirectory, 'rev-parse', '--show-toplevel']),
		);
	} catch (error) {
		throw new Error(
			`Run this command inside a Git repository: ${errorMessage(error)}`,
		);
	}

	const remotes = (await git(['-C', root, 'remote'])).split(/\r?\n/);
	const remote = remotes.includes('upstream') ? 'upstream' : 'origin';
	if (!remotes.includes(remote)) {
		throw new Error(
			'No Git remote found. Add the PR base repository as `upstream` or `origin`.',
		);
	}
	let remoteUrl: string;
	try {
		remoteUrl = await git(['-C', root, 'remote', 'get-url', remote]);
	} catch (error) {
		throw new Error(
			`Could not read the ${remote} remote: ${errorMessage(error)}`,
		);
	}
	const repo = githubRepoFromRemote(remoteUrl);
	if (!repo) {
		throw new Error(
			`The ${remote} remote must point to a GitHub repository containing the PR.`,
		);
	}

	try {
		await gh(['pr', 'view', prNumber, '--repo', repo, '--json', 'number']);
	} catch (error) {
		throw new Error(
			`Could not find PR #${prNumber} in ${repo}: ${errorMessage(error)}`,
		);
	}

	const worktreePath = join(dirname(root), `${basename(root)}-pr-${prNumber}`);
	const branch = `nanocoder/pr-${prNumber}`;
	if (pathExists(worktreePath)) {
		throw new Error(
			`Worktree path already exists: ${worktreePath}. Remove or choose a different location before retrying.`,
		);
	}
	const registeredWorktrees = await git([
		'-C',
		root,
		'worktree',
		'list',
		'--porcelain',
	]);
	if (registeredBranchAtPath(registeredWorktrees, worktreePath)) {
		throw new Error(
			`Git already has a worktree registered at ${worktreePath}. Resolve that worktree before retrying.`,
		);
	}
	const existingBranch = await git([
		'-C',
		root,
		'branch',
		'--list',
		'--format=%(refname)',
		branch,
	]);
	if (existingBranch.trim()) {
		throw new Error(
			`Local branch ${branch} already exists. Remove it after checking its worktree before retrying.`,
		);
	}

	try {
		await git([
			'-C',
			root,
			'fetch',
			'--no-tags',
			remote,
			`refs/pull/${prNumber}/head`,
		]);
	} catch (error) {
		throw new Error(
			`Could not fetch PR #${prNumber} from ${repo}: ${errorMessage(error)}`,
		);
	}

	let directoryCreated = false;
	let branchCreated = false;
	let phase = 'create worktree';
	try {
		// mkdir is an atomic reservation: even a dangling symlink or a directory
		// created between the earlier check and this call is never overwritten.
		mkdirSync(worktreePath);
		directoryCreated = true;
		phase = 'create local PR branch';
		await git(['-C', root, 'branch', branch, 'FETCH_HEAD']);
		branchCreated = true;
		phase = 'add Git worktree';
		await git(['-C', root, 'worktree', 'add', worktreePath, branch]);
		phase = 'enter Git worktree';
		dependencies.changeDirectory(worktreePath);
		return worktreePath;
	} catch (error) {
		if (
			!directoryCreated &&
			(error as NodeJS.ErrnoException).code === 'EEXIST'
		) {
			throw new Error(
				`Worktree path already exists: ${worktreePath}. Nothing was changed.`,
			);
		}
		const cleanupErrors: string[] = [];
		if (directoryCreated) {
			// Git may register a worktree even when checkout fails. Remove a
			// registration only when it uses the branch created by this attempt.
			let registration: string | null = null;
			let inspected = false;
			try {
				registration = registeredBranchAtPath(
					await git(['-C', root, 'worktree', 'list', '--porcelain']),
					worktreePath,
				);
				inspected = true;
			} catch (cleanupError) {
				cleanupErrors.push(
					`worktree inspection failed: ${errorMessage(cleanupError)}`,
				);
			}
			if (registration === `refs/heads/${branch}`) {
				try {
					await git([
						'-C',
						root,
						'worktree',
						'remove',
						'--force',
						worktreePath,
					]);
				} catch (cleanupError) {
					cleanupErrors.push(
						`worktree cleanup failed: ${errorMessage(cleanupError)}`,
					);
				}
			} else if (registration) {
				cleanupErrors.push(
					`worktree path is registered to ${registration}; it was left intact`,
				);
			}
			if (inspected && !registration) {
				try {
					rmSync(worktreePath, {recursive: true, force: true});
				} catch (cleanupError) {
					cleanupErrors.push(
						`directory cleanup failed: ${errorMessage(cleanupError)}`,
					);
				}
			}
		}
		if (branchCreated) {
			try {
				await git(['-C', root, 'branch', '-D', branch]);
			} catch (cleanupError) {
				cleanupErrors.push(
					`branch cleanup failed: ${errorMessage(cleanupError)}`,
				);
			}
		}
		const cleanupNote = cleanupErrors.length
			? ` Cleanup also failed: ${cleanupErrors.join('; ')}.`
			: '';
		throw new Error(
			`Could not ${phase} for PR #${prNumber}: ${errorMessage(error)}.${cleanupNote}`,
		);
	}
}
