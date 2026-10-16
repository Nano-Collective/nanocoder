/**
 * Isolated git clone lifecycle for auto-fix/full-commit CI investigations.
 * Harness-only (not an agent tool) — used by `ci-fix-orchestrator.ts` to
 * give the one-shot fix subprocess its own `process.cwd()`, decoupled from
 * the daemon's own working directory and event loop. See the Phase 4 plan's
 * Context section for why this isolation is necessary: every tool in this
 * codebase resolves paths against the single process-global
 * `process.cwd()`, which the daemon shares across every
 * concurrently-dispatchable triggered run.
 *
 * Deliberately a full `git clone`, not a `git worktree add`: a linked
 * worktree shares its parent repo's refs, so git refuses to check out a
 * branch that's already checked out elsewhere — and the branch CI just
 * failed on is *always* the daemon's own currently-checked-out branch
 * (`CiEventSource` defaults to `getCurrentBranch()`; nothing configures it
 * otherwise), so `full-commit` would deterministically fail to ever create
 * a worktree. A clone has its own independent object database, so checking
 * out that same branch a second time here is never a conflict. The
 * trade-off: the clone's new commits exist only in its own `.git`, so
 * publishing them (`pushBranch`) must run with this clone as its `cwd`,
 * not the daemon's project root — see `ci-fix-orchestrator.ts`.
 */

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execGit} from '@/tools/git/utils';

export interface CiFixWorktree {
	path: string;
	/** Branch checked out inside the clone. */
	branch: string;
	/** true for auto-fix (a fresh branch off the failing branch); false for
	 * full-commit (the failing branch itself, checked out directly). */
	isNewBranch: boolean;
}

export interface CreateCiFixWorktreeOptions {
	projectRoot: string;
	originalBranch: string;
	runId: number;
	trustLevel: 'auto-fix' | 'full-commit';
}

function fixBranchName(originalBranch: string, runId: number): string {
	// Slashes in the original branch name are fine in a git ref, but keep
	// this readable and collision-resistant across repeated attempts.
	return `nanocoder/ci-fix/${originalBranch}-${runId}`;
}

async function getRemoteUrl(projectRoot: string): Promise<string> {
	const output = await execGit([
		'-C',
		projectRoot,
		'remote',
		'get-url',
		'origin',
	]);
	return output.trim();
}

export async function createCiFixWorktree(
	opts: CreateCiFixWorktreeOptions,
): Promise<CiFixWorktree> {
	const clonePath = mkdtempSync(join(tmpdir(), 'nanocoder-ci-fix-'));
	try {
		const remoteUrl = await getRemoteUrl(opts.projectRoot);
		// --single-branch: this is a throwaway, single-purpose checkout, not
		// a general-purpose clone — no need to fetch every branch.
		await execGit([
			'clone',
			'--origin',
			'origin',
			'--branch',
			opts.originalBranch,
			'--single-branch',
			remoteUrl,
			clonePath,
		]);

		if (opts.trustLevel === 'auto-fix') {
			const branch = fixBranchName(opts.originalBranch, opts.runId);
			await execGit(['-C', clonePath, 'checkout', '-b', branch]);
			return {path: clonePath, branch, isNewBranch: true};
		}

		return {path: clonePath, branch: opts.originalBranch, isNewBranch: false};
	} catch (err) {
		rmSync(clonePath, {recursive: true, force: true});
		throw err;
	}
}

export async function removeCiFixWorktree(
	worktree: CiFixWorktree,
): Promise<void> {
	// A full clone, not a linked worktree — there's no registration in the
	// main repo to clean up (no `git worktree remove`), just the directory.
	try {
		rmSync(worktree.path, {recursive: true, force: true});
	} catch (err) {
		console.error(
			`Failed to clean up CI-fix clone directory (${worktree.path}): ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
}
