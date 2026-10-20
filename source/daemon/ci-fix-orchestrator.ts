/**
 * Ties together the isolated worktree, the one-shot fix subprocess, and the
 * harness-mediated push/PR step for auto-fix/full-commit CI investigations.
 * Invoked from `entry.ts`'s `buildExecutor` in place of running
 * `verify-ci-investigator` inline, whenever the resolved trust level is
 * `auto-fix` or `full-commit`.
 */

import {type ChildProcess, spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TIMEOUT_CI_FIX_RUNNER_MS} from '@/constants';
import type {CiFixRunnerInput, CiFixRunnerResult} from '@/daemon/ci-fix-runner';
import type {CiJobFailedPayload} from '@/events/types';
import type {SubagentResult, SubagentTask} from '@/subagents/types';
import {createDraftPr, pushBranch} from '@/tools/git/utils';
import type {TrustLevel} from '@/verify/trust';
import {
	type CiFixWorktree,
	createCiFixWorktree,
	removeCiFixWorktree,
} from './ci-fix-worktree';
import {readCiWatchState, writeCiWatchState} from './ci-watch-state';

export interface CiFixOrchestratorDeps {
	createWorktree: typeof createCiFixWorktree;
	removeWorktree: typeof removeCiFixWorktree;
	spawnFixRunner: (
		input: CiFixRunnerInput,
		opts?: {signal?: AbortSignal; cwd?: string},
	) => Promise<CiFixRunnerResult>;
	pushBranch: typeof pushBranch;
	createDraftPr: typeof createDraftPr;
	/** SHAs of commits this daemon already published as CI fixes. */
	readAutoFixedShas: (projectRoot: string) => Promise<string[]>;
	recordAutoFixedShas: (projectRoot: string, shas: string[]) => Promise<void>;
}

const MAX_TRACKED_AUTO_FIXED_SHAS = 50;

function extractCiPayload(task: SubagentTask): CiJobFailedPayload | undefined {
	const trigger = task.context?.trigger as
		| {kind?: string; payload?: CiJobFailedPayload}
		| undefined;
	if (trigger?.kind !== 'ci.job.failed' || !trigger.payload) return undefined;
	return trigger.payload;
}

function defaultSpawnFixRunner(
	input: CiFixRunnerInput,
	opts: {signal?: AbortSignal; cwd?: string} = {},
): Promise<CiFixRunnerResult> {
	return new Promise((resolve, reject) => {
		const runnerEntry = fileURLToPath(
			new URL('./ci-fix-runner.js', import.meta.url),
		);
		const workDir = mkdtempSync(join(tmpdir(), 'nanocoder-ci-fix-io-'));
		const inputPath = join(workDir, 'input.json');
		const resultPath = join(workDir, 'result.json');
		writeFileSync(inputPath, JSON.stringify(input), 'utf-8');

		const cleanupIoDir = () => rmSync(workDir, {recursive: true, force: true});

		let child: ChildProcess;
		try {
			// The runner chdirs into the clone itself, but starts in the project
			// root so it resolves the project's agents.config.json (providers are
			// often defined in an uncommitted local config).
			child = spawn(process.execPath, [runnerEntry], {
				cwd: opts.cwd,
				env: {
					...process.env,
					NANOCODER_CI_FIX_INPUT_PATH: inputPath,
					NANOCODER_CI_FIX_RESULT_PATH: resultPath,
				},
				stdio: 'inherit',
			});
		} catch (err) {
			cleanupIoDir();
			reject(err);
			return;
		}

		const terminate = () => {
			child.kill('SIGTERM');
			const forceKill = setTimeout(() => child.kill('SIGKILL'), 5000);
			forceKill.unref();
		};
		const timer = setTimeout(terminate, TIMEOUT_CI_FIX_RUNNER_MS);
		timer.unref();

		// Daemon shutdown: stop the runner now instead of orphaning it. The
		// runner writes a failure result on SIGTERM, so `close` still resolves.
		const onAbort = () => terminate();
		if (opts.signal?.aborted) onAbort();
		else opts.signal?.addEventListener('abort', onAbort, {once: true});

		child.on('error', err => {
			clearTimeout(timer);
			opts.signal?.removeEventListener('abort', onAbort);
			cleanupIoDir();
			reject(err);
		});

		child.on('close', () => {
			clearTimeout(timer);
			opts.signal?.removeEventListener('abort', onAbort);
			try {
				const result = JSON.parse(
					readFileSync(resultPath, 'utf-8'),
				) as CiFixRunnerResult;
				resolve(result);
			} catch (err) {
				resolve({
					success: false,
					committed: false,
					commitShas: [],
					output: '',
					error: `ci-fix-runner produced no readable result: ${
						err instanceof Error ? err.message : String(err)
					}`,
				});
			} finally {
				cleanupIoDir();
			}
		});
	});
}

const defaultDeps: CiFixOrchestratorDeps = {
	createWorktree: createCiFixWorktree,
	removeWorktree: removeCiFixWorktree,
	spawnFixRunner: defaultSpawnFixRunner,
	pushBranch,
	createDraftPr,
	readAutoFixedShas: async projectRoot =>
		(await readCiWatchState(projectRoot)).autoFixedShas ?? [],
	recordAutoFixedShas: async (projectRoot, shas) => {
		const state = await readCiWatchState(projectRoot);
		await writeCiWatchState(projectRoot, {
			autoFixedShas: [...(state.autoFixedShas ?? []), ...shas].slice(
				-MAX_TRACKED_AUTO_FIXED_SHAS,
			),
		});
	},
};

function toSubagentResult(
	subagentName: string,
	startTime: number,
	overrides: Partial<SubagentResult>,
): SubagentResult {
	return {
		subagentName,
		output: '',
		success: false,
		executionTimeMs: Date.now() - startTime,
		...overrides,
	};
}

export async function runCiAutoFixFlow(
	task: SubagentTask,
	trustLevel: Extract<TrustLevel, 'auto-fix' | 'full-commit'>,
	projectRoot: string,
	deps: Partial<CiFixOrchestratorDeps> = {},
	signal?: AbortSignal,
): Promise<SubagentResult> {
	const {
		createWorktree,
		removeWorktree,
		spawnFixRunner,
		pushBranch,
		createDraftPr,
		readAutoFixedShas,
		recordAutoFixedShas,
	} = {...defaultDeps, ...deps};
	const startTime = Date.now();

	const payload = extractCiPayload(task);
	if (!payload) {
		return toSubagentResult(task.subagent_type, startTime, {
			error: 'ci-fix-orchestrator: task carries no ci.job.failed payload',
		});
	}

	if (signal?.aborted) {
		return toSubagentResult(task.subagent_type, startTime, {
			error: 'CI-fix run cancelled: the daemon is shutting down',
		});
	}

	// Loop guard: if the run that failed was triggered by a commit this daemon
	// itself published as a fix, another automated attempt would just chase its
	// own tail (especially at full-commit, where every push re-runs CI).
	try {
		const fixedShas = await readAutoFixedShas(projectRoot);
		if (fixedShas.includes(payload.headSha)) {
			return toSubagentResult(task.subagent_type, startTime, {
				error:
					`CI is still failing on ${payload.headSha.slice(0, 7)}, a commit an earlier ` +
					'automated fix published. Not attempting another automated fix; this needs a human.',
			});
		}
	} catch (err) {
		console.error(
			`Could not read auto-fix history, continuing: ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}

	let worktree: CiFixWorktree;
	try {
		worktree = await createWorktree({
			projectRoot,
			originalBranch: payload.branch,
			runId: payload.runId,
			trustLevel,
		});
	} catch (err) {
		return toSubagentResult(task.subagent_type, startTime, {
			error: `Failed to create CI-fix worktree: ${
				err instanceof Error ? err.message : String(err)
			}`,
		});
	}

	try {
		let runnerResult: CiFixRunnerResult;
		try {
			runnerResult = await spawnFixRunner(
				{
					worktreePath: worktree.path,
					trustLevel,
					payload,
					taskDescription: task.description,
				},
				{signal, cwd: projectRoot},
			);
		} catch (err) {
			return toSubagentResult(task.subagent_type, startTime, {
				error: `CI-fix subprocess failed to run: ${
					err instanceof Error ? err.message : String(err)
				}`,
			});
		}

		if (!runnerResult.success) {
			return toSubagentResult(task.subagent_type, startTime, {
				output: runnerResult.output,
				error: runnerResult.error ?? 'CI-fix subprocess did not succeed',
			});
		}

		if (signal?.aborted) {
			return toSubagentResult(task.subagent_type, startTime, {
				output: runnerResult.output,
				error:
					'CI-fix run cancelled: the daemon is shutting down; nothing was pushed',
			});
		}

		if (!runnerResult.committed) {
			return toSubagentResult(task.subagent_type, startTime, {
				success: true,
				output: runnerResult.output,
			});
		}

		let pushed = false;
		try {
			if (trustLevel === 'auto-fix') {
				await pushBranch(worktree.branch, {
					setUpstream: true,
					cwd: worktree.path,
				});
				pushed = true;
				await recordAutoFixedShas(projectRoot, runnerResult.commitShas).catch(
					() => undefined,
				);
				const prUrl = await createDraftPr({
					title: `fix(ci): ${payload.workflowName} failed on ${payload.branch}`,
					body: runnerResult.output,
					base: payload.branch,
					head: worktree.branch,
				});
				return toSubagentResult(task.subagent_type, startTime, {
					success: true,
					fixApplied: true,
					output: `Opened draft PR: ${prUrl}\n\n${runnerResult.output}`,
				});
			}

			await pushBranch(worktree.branch, {cwd: worktree.path});
			await recordAutoFixedShas(projectRoot, runnerResult.commitShas).catch(
				() => undefined,
			);
			return toSubagentResult(task.subagent_type, startTime, {
				success: true,
				fixApplied: true,
				output: `Pushed directly to ${worktree.branch}.\n\n${runnerResult.output}`,
			});
		} catch (err) {
			// If the push itself succeeded and only createDraftPr failed
			// afterward, the fix branch is now live on origin with nothing
			// referencing it — name it explicitly so it's discoverable (and
			// cleanable) from the daemon log rather than only implied.
			const publishStage = pushed
				? `opening a PR for pushed branch "${worktree.branch}"`
				: 'pushing the fix';
			return toSubagentResult(task.subagent_type, startTime, {
				output: runnerResult.output,
				error: `Fix was committed but ${publishStage} failed: ${
					err instanceof Error ? err.message : String(err)
				}`,
			});
		}
	} finally {
		await removeWorktree(worktree);
	}
}
