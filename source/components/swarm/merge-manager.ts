import {execFile} from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {removeWorktree} from '@/utils/git-worktree';
import type {TaskDefinition} from './coordinator-utils';

const execFileAsync = promisify(execFile);

/**
 * Performs a 3-way merge of all worker patches.
 * Validates that no out-of-scope edits occurred before applying each patch.
 * Throws an error if any worker violated its scope or if a merge conflict cannot be resolved automatically.
 *
 * @param tasks - The task definitions (used for worker IDs and file scopes)
 * @param preSwarmCommit - The base commit before any swarm modifications
 * @param cwd - The main repository root directory
 */
export async function executeSwarmMerge(
	tasks: TaskDefinition[],
	preSwarmCommit: string,
	cwd: string,
): Promise<void> {
	for (const task of tasks) {
		const branchName = `nanocoder-swarm-${task.id}`;
		const targetPath = `.nanocoder/worktrees/${task.id}`;
		const worktreeAbsPath = path.resolve(cwd, targetPath);

		try {
			// 1. Post-hoc Scope Validation: Check for scope violations inside the worker's branch before applying
			const {stdout: changedFilesRaw} = await execFileAsync(
				'git',
				['diff', '--name-only', preSwarmCommit],
				{cwd: worktreeAbsPath},
			);
			const changedFiles = changedFilesRaw.split('\n').filter(Boolean);

			for (const changedFile of changedFiles) {
				let allowed = false;
				for (const allowedPath of task.fileScope) {
					const normChanged = path.normalize(changedFile);
					const normAllowed = path.normalize(allowedPath);
					if (
						normChanged === normAllowed ||
						normChanged.startsWith(normAllowed + path.sep)
					) {
						allowed = true;
						break;
					}
				}
				if (!allowed && task.fileScope.length > 0) {
					throw new Error(
						`Scope violation: Worker ${task.id} modified ${changedFile} which is outside its scope`,
					);
				}
			}

			// 2. Patch Extraction & Preservation
			const {stdout: patchData} = await execFileAsync(
				'git',
				['diff', preSwarmCommit],
				{cwd: worktreeAbsPath},
			);

			if (patchData.trim()) {
				// Save patch to .nanocoder directory so work isn't lost on later failures
				const patchPath = path.join(cwd, '.nanocoder', `${task.id}.patch`);
				await fs.promises.writeFile(patchPath, patchData);

				// 3. Patch Application
				await execFileAsync('git', ['apply', '--3way', patchPath], {
					cwd,
				});
			}
		} finally {
			// Always remove the worktree when merging is done (or failed)
			try {
				removeWorktree(targetPath, branchName, cwd);
			} catch (e) {
				console.error(`Failed to cleanup worktree for task ${task.id}`, e);
			}
		}
	}
}

/**
 * Executes an All-or-Nothing rollback of the Swarm.
 * Tears down any remaining worktrees, resets HEAD back to pre-swarm state, and drops untracked files.
 * Note: patches saved in .nanocoder/*.patch are preserved because .nanocoder is ignored.
 *
 * @param tasks - The task definitions
 * @param preSwarmCommit - The base commit to reset to
 * @param cwd - The main repository root directory
 */
export async function executeSwarmRollback(
	tasks: TaskDefinition[],
	preSwarmCommit: string,
	cwd: string,
): Promise<void> {
	// 1. Teardown worktrees if they exist
	for (const task of tasks) {
		const branchName = `nanocoder-swarm-${task.id}`;
		const targetPath = `.nanocoder/worktrees/${task.id}`;
		if (fs.existsSync(path.resolve(cwd, targetPath))) {
			try {
				removeWorktree(targetPath, branchName, cwd);
			} catch (e) {
				console.error(`Rollback: failed to remove worktree for ${task.id}`, e);
			}
		}
	}

	// 2. Hard reset back to original state
	await execFileAsync('git', ['reset', '--hard', preSwarmCommit], {cwd});
	await execFileAsync('git', ['clean', '-fd'], {cwd});
}
