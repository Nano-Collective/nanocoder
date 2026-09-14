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

export interface CiFixOrchestratorDeps {
	createWorktree: typeof createCiFixWorktree;
	removeWorktree: typeof removeCiFixWorktree;
	spawnFixRunner: (input: CiFixRunnerInput) => Promise<CiFixRunnerResult>;
	pushBranch: typeof pushBranch;
	createDraftPr: typeof createDraftPr;
}

function extractCiPayload(task: SubagentTask): CiJobFailedPayload | undefined {
	const trigger = task.context?.trigger as
		| {kind?: string; payload?: CiJobFailedPayload}
		| undefined;
	if (trigger?.kind !== 'ci.job.failed' || !trigger.payload) return undefined;
	return trigger.payload;
}

function defaultSpawnFixRunner(
	input: CiFixRunnerInput,
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
			child = spawn(process.execPath, [runnerEntry], {
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

		const timer = setTimeout(() => {
			child.kill('SIGTERM');
			const forceKill = setTimeout(() => child.kill('SIGKILL'), 5000);
			forceKill.unref();
		}, TIMEOUT_CI_FIX_RUNNER_MS);
		timer.unref();

		child.on('error', err => {
			clearTimeout(timer);
			cleanupIoDir();
			reject(err);
		});

		child.on('close', () => {
			clearTimeout(timer);
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
): Promise<SubagentResult> {
	const {
		createWorktree,
		removeWorktree,
		spawnFixRunner,
		pushBranch,
		createDraftPr,
	} = {...defaultDeps, ...deps};
	const startTime = Date.now();

	const payload = extractCiPayload(task);
	if (!payload) {
		return toSubagentResult(task.subagent_type, startTime, {
			error: 'ci-fix-orchestrator: task carries no ci.job.failed payload',
		});
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
			runnerResult = await spawnFixRunner({
				worktreePath: worktree.path,
				trustLevel,
				payload,
				taskDescription: task.description,
			});
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
