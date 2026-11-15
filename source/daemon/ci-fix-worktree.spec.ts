import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {createCiFixWorktree, removeCiFixWorktree} from './ci-fix-worktree';

console.log('\nci-fix-worktree.spec.ts');

function git(cwd: string, args: string[]): string {
	return execFileSync('git', args, {cwd, encoding: 'utf-8'});
}

/** A real bare "remote" repo plus a clone of it acting as the daemon's own
 * `projectRoot` — checked out ON `failing-branch` itself, mirroring the
 * guaranteed real-world case: `CiEventSource` defaults to whatever branch
 * is currently checked out, so the failing branch IS always the daemon's
 * own checkout. `createCiFixWorktree` must still succeed here (this is
 * exactly the scenario a `git worktree add` approach cannot handle, since
 * git refuses to check out a branch that's already checked out elsewhere —
 * cloning from the bare remote sidesteps that entirely). */
async function tempProjectWithFailingBranchCheckedOut(): Promise<{
	projectRoot: string;
	remoteDir: string;
	headSha: string;
}> {
	const remoteDir = await mkdtemp(join(tmpdir(), 'ci-fix-remote-'));
	git(remoteDir, ['init', '--bare', '--initial-branch=main']);

	const projectRoot = await mkdtemp(join(tmpdir(), 'ci-fix-project-'));
	execFileSync('git', ['clone', remoteDir, projectRoot], {encoding: 'utf-8'});
	git(projectRoot, ['config', 'user.email', 'test@example.com']);
	git(projectRoot, ['config', 'user.name', 'Test']);
	git(projectRoot, ['commit', '--allow-empty', '-m', 'initial']);
	git(projectRoot, ['push', 'origin', 'main']);
	git(projectRoot, ['checkout', '-b', 'failing-branch']);
	git(projectRoot, ['commit', '--allow-empty', '-m', 'broke ci']);
	git(projectRoot, ['push', 'origin', 'failing-branch']);
	// Left checked out on failing-branch — the realistic case.

	const headSha = git(projectRoot, ['rev-parse', 'HEAD']).trim();
	return {projectRoot, remoteDir, headSha};
}

test('auto-fix clones and creates a new branch, even though the failing branch is checked out at projectRoot', async t => {
	const {projectRoot, remoteDir, headSha} = await tempProjectWithFailingBranchCheckedOut();
	try {
		const worktree = await createCiFixWorktree({
			projectRoot,
			originalBranch: 'failing-branch',
			runId: 42,
			headSha,
			trustLevel: 'auto-fix',
		});
		try {
			t.true(worktree.isNewBranch);
			t.is(worktree.branch, 'nanocoder/ci-fix/failing-branch-42');
			t.true(existsSync(worktree.path));
			t.not(worktree.path, projectRoot);

			const branchInClone = git(worktree.path, [
				'rev-parse',
				'--abbrev-ref',
				'HEAD',
			]).trim();
			t.is(branchInClone, 'nanocoder/ci-fix/failing-branch-42');
		} finally {
			await removeCiFixWorktree(worktree);
		}
	} finally {
		await rm(projectRoot, {recursive: true, force: true});
		await rm(remoteDir, {recursive: true, force: true});
	}
});

test('full-commit clones and checks out the failing branch directly, without conflicting with projectRoot\'s own checkout', async t => {
	const {projectRoot, remoteDir, headSha} = await tempProjectWithFailingBranchCheckedOut();
	try {
		// projectRoot itself is already checked out on failing-branch — a
		// `git worktree add` for the same branch would fail here; cloning
		// from the remote must not.
		const worktree = await createCiFixWorktree({
			projectRoot,
			originalBranch: 'failing-branch',
			runId: 42,
			headSha,
			trustLevel: 'full-commit',
		});
		try {
			t.false(worktree.isNewBranch);
			t.is(worktree.branch, 'failing-branch');

			const branchInClone = git(worktree.path, [
				'rev-parse',
				'--abbrev-ref',
				'HEAD',
			]).trim();
			t.is(branchInClone, 'failing-branch');
		} finally {
			await removeCiFixWorktree(worktree);
		}
	} finally {
		await rm(projectRoot, {recursive: true, force: true});
		await rm(remoteDir, {recursive: true, force: true});
	}
});

test('the clone has its own independent commit history from projectRoot', async t => {
	const {projectRoot, remoteDir, headSha} = await tempProjectWithFailingBranchCheckedOut();
	try {
		const worktree = await createCiFixWorktree({
			projectRoot,
			originalBranch: 'failing-branch',
			runId: 1,
			headSha,
			trustLevel: 'full-commit',
		});
		try {
			// The clone is a fresh repo with no identity; CI runners have no global one.
			git(worktree.path, ['config', 'user.email', 'test@example.com']);
			git(worktree.path, ['config', 'user.name', 'Test']);
			git(worktree.path, ['commit', '--allow-empty', '-m', 'a fix']);
			const cloneLog = git(worktree.path, ['log', '--oneline']).trim();
			const projectLog = git(projectRoot, ['log', '--oneline']).trim();

			t.true(cloneLog.includes('a fix'));
			t.false(
				projectLog.includes('a fix'),
				'a commit made in the clone must not appear in projectRoot until explicitly pushed there',
			);
		} finally {
			await removeCiFixWorktree(worktree);
		}
	} finally {
		await rm(projectRoot, {recursive: true, force: true});
		await rm(remoteDir, {recursive: true, force: true});
	}
});

test('removeCiFixWorktree cleans up the clone directory and is tolerant of an already-gone directory', async t => {
	const {projectRoot, remoteDir, headSha} = await tempProjectWithFailingBranchCheckedOut();
	try {
		const worktree = await createCiFixWorktree({
			projectRoot,
			originalBranch: 'failing-branch',
			runId: 7,
			headSha,
			trustLevel: 'auto-fix',
		});
		await removeCiFixWorktree(worktree);
		t.false(existsSync(worktree.path));

		// Removing again (directory already gone) must not throw.
		await t.notThrowsAsync(() => removeCiFixWorktree(worktree));
	} finally {
		await rm(projectRoot, {recursive: true, force: true});
		await rm(remoteDir, {recursive: true, force: true});
	}
});

// origin's branch moved on after the run: a fix must still answer the
// commit that failed, never whatever the tip is now.
async function pushNewerTip(projectRoot: string): Promise<string> {
	git(projectRoot, ['commit', '--allow-empty', '-m', 'pushed after the run']);
	git(projectRoot, ['push', 'origin', 'failing-branch']);
	return git(projectRoot, ['rev-parse', 'HEAD']).trim();
}

test('auto-fix starts the fix branch at the failing commit when origin has moved on', async t => {
	const {projectRoot, remoteDir, headSha} = await tempProjectWithFailingBranchCheckedOut();
	try {
		await pushNewerTip(projectRoot);
		const worktree = await createCiFixWorktree({
			projectRoot,
			originalBranch: 'failing-branch',
			runId: 3,
			headSha,
			trustLevel: 'auto-fix',
		});
		try {
			t.is(git(worktree.path, ['rev-parse', 'HEAD']).trim(), headSha);
		} finally {
			await removeCiFixWorktree(worktree);
		}
	} finally {
		await rm(projectRoot, {recursive: true, force: true});
		await rm(remoteDir, {recursive: true, force: true});
	}
});

test('full-commit refuses when origin has moved past the failing commit', async t => {
	const {projectRoot, remoteDir, headSha} = await tempProjectWithFailingBranchCheckedOut();
	try {
		await pushNewerTip(projectRoot);
		await t.throwsAsync(
			createCiFixWorktree({
				projectRoot,
				originalBranch: 'failing-branch',
				runId: 4,
				headSha,
				trustLevel: 'full-commit',
			}),
			{message: /moved past the failing commit/},
		);
	} finally {
		await rm(projectRoot, {recursive: true, force: true});
		await rm(remoteDir, {recursive: true, force: true});
	}
});

test('auto-fix refuses a failing commit that is not on the origin branch (a fork with the same branch name)', async t => {
	const {projectRoot, remoteDir} = await tempProjectWithFailingBranchCheckedOut();
	try {
		git(projectRoot, ['checkout', '--orphan', 'fork-main']);
		git(projectRoot, ['commit', '--allow-empty', '-m', 'fork commit']);
		const forkSha = git(projectRoot, ['rev-parse', 'HEAD']).trim();
		await t.throwsAsync(
			createCiFixWorktree({
				projectRoot,
				originalBranch: 'failing-branch',
				runId: 5,
				headSha: forkSha,
				trustLevel: 'auto-fix',
			}),
			{message: /not on origin\/failing-branch/},
		);
	} finally {
		await rm(projectRoot, {recursive: true, force: true});
		await rm(remoteDir, {recursive: true, force: true});
	}
});
