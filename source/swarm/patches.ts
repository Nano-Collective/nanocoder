import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {runGit} from '@/utils/git-worktree';
import {isPathInScope} from '@/utils/restricted-scope';
import type {TaskDefinition} from './tasks';
import type {SwarmPatch} from './types';

// Any `nanocoder run` may add its runtime entries here, which is not the
// worker's work.
const RUNTIME_GITIGNORE = '.nanocoder/.gitignore';

/**
 * Saves everything a worker changed since `baseCommit`, including its own
 * commits, as a patch. Checks the changed paths against the task's scope, which
 * also catches edits made through the shell. Returns undefined when the worker
 * changed nothing.
 */
export async function collectPatch(
	task: TaskDefinition,
	worktreePath: string,
	baseCommit: string,
	patchPath: string,
): Promise<SwarmPatch | undefined> {
	await runGit(['add', '-A'], worktreePath);
	if (!isPathInScope(RUNTIME_GITIGNORE, task.fileScope)) {
		await runGit(
			['reset', '-q', baseCommit, '--', RUNTIME_GITIGNORE],
			worktreePath,
		);
	}
	// Without --no-renames only the destination of a move would be listed.
	const files = (
		await runGit(
			['diff', '--staged', '--name-only', '--no-renames', '-z', baseCommit],
			worktreePath,
		)
	)
		.split('\0')
		.filter(Boolean);
	if (files.length === 0) return undefined;

	const outside = files.filter(file => !isPathInScope(file, task.fileScope));
	if (outside.length > 0) {
		throw new Error(
			`Scope violation: worker ${task.id} changed ${outside.join(', ')}, outside its scope (${task.fileScope.map(entry => entry || '.').join(', ')}).`,
		);
	}

	// The explicit flags override user diff settings that `git apply` rejects.
	await runGit(
		[
			'diff',
			'--staged',
			'--binary',
			'--full-index',
			'--no-renames',
			'--no-ext-diff',
			'--no-textconv',
			'--no-color',
			'--src-prefix=a/',
			'--dst-prefix=b/',
			`--output=${path.resolve(patchPath)}`,
			baseCommit,
		],
		worktreePath,
	);
	return {id: task.id, files, patchPath};
}

/**
 * Applies all patches to the working tree, or none of them. They are joined
 * into one file because `git apply` is only atomic within a single input.
 */
export async function applyPatches(
	patches: SwarmPatch[],
	baseCommit: string,
	combinedPath: string,
	cwd: string,
): Promise<void> {
	if ((await runGit(['rev-parse', 'HEAD'], cwd)).trim() !== baseCommit) {
		throw new Error('HEAD moved while swarm was running.');
	}
	if ((await runGit(['status', '--porcelain'], cwd)).trim()) {
		throw new Error('The working tree changed while swarm was running.');
	}

	const contents = await Promise.all(
		patches.map(patch => readFile(path.resolve(cwd, patch.patchPath))),
	);
	await writeFile(path.resolve(cwd, combinedPath), Buffer.concat(contents));
	await runGit(
		['apply', '--whitespace=nowarn', path.resolve(cwd, combinedPath)],
		cwd,
	);
}
