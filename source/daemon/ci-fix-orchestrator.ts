/**
 * Ties together the isolated worktree, the one-shot fix subprocess, and the
 * harness-mediated push/PR step for auto-fix/full-commit CI investigations.
 * Invoked from `entry.ts`'s `buildExecutor` in place of running
 * `verify-ci-investigator` inline, whenever the resolved trust level is
 * `auto-fix` or `full-commit`.
 */

import {type ChildProcess, spawn} from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {
	TIMEOUT_CI_FIX_RUNNER_MS,
	TIMEOUT_GH_LOG_MS,
	TIMEOUT_GIT_PUSH_MS,
} from '@/constants';
import type {CiFixRunnerInput, CiFixRunnerResult} from '@/daemon/ci-fix-runner';
import type {CiJobFailedPayload} from '@/events/types';
import type {SubagentResult, SubagentTask} from '@/subagents/types';
import {createDraftPr, execGh, execGit} from '@/tools/git/utils';
import {formatError} from '@/utils/error-formatter';
import {redactSecrets} from '@/verify/redact-secrets';
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
	/** Fetch the failing steps' log in this (credentialed) process and stage
	 * it inside the clone for the runner. Returns the path relative to the
	 * clone, or undefined when the log could not be fetched. */
	stageFailedLog: (
		clonePath: string,
		runId: number,
	) => Promise<string | undefined>;
	/** Publish the clone's branch to origin from this process. */
	publishBranch: (opts: PublishBranchOptions) => Promise<void>;
	createDraftPr: typeof createDraftPr;
	/** SHAs of commits this daemon already published as CI fixes. */
	readAutoFixedShas: (projectRoot: string) => Promise<string[]>;
	recordAutoFixedShas: (projectRoot: string, shas: string[]) => Promise<void>;
}

export interface PublishBranchOptions {
	projectRoot: string;
	clonePath: string;
	/** Branch inside the clone, and the branch name to publish on origin. */
	branch: string;
	runId: number;
}

const MAX_TRACKED_AUTO_FIXED_SHAS = 50;

/**
 * Where the parent stages the failed-step log, relative to the clone. Inside
 * `.git/` so it is reachable by the runner's path-contained `read_file` but
 * can never be staged or committed.
 */
export const FAILED_LOG_RELATIVE_PATH = '.git/nanocoder-ci/failed-steps.log';

// Env vars that carry GitHub / git credentials, or that point git at a
// credential source, removed from the fix runner's environment. The runner
// executes `execute_bash` with no approval in a clone whose origin is the
// real repo, steered by an attacker-controllable CI log: anything here would
// let an injected instruction `git push --force` or `gh pr merge`.
const CREDENTIAL_ENV_VARS: readonly string[] = [
	'GH_TOKEN',
	'GITHUB_TOKEN',
	'GH_ENTERPRISE_TOKEN',
	'GITHUB_ENTERPRISE_TOKEN',
	'GH_CONFIG_DIR',
	'SSH_AUTH_SOCK',
	'SSH_AGENT_PID',
	'GIT_ASKPASS',
	'SSH_ASKPASS',
	'GIT_SSH',
	'GIT_SSH_COMMAND',
	'GIT_PROXY_COMMAND',
	'GIT_CONFIG_PARAMETERS',
	'GIT_CONFIG_COUNT',
	'GIT_CONFIG_GLOBAL',
	'GIT_CONFIG_SYSTEM',
];

const CREDENTIAL_ENV_PATTERNS: readonly RegExp[] = [
	// GH_PAT, GITHUB_PAT, GITHUB_APP_TOKEN, GH_ENTERPRISE_TOKEN...
	/^(GH|GITHUB)_(.*_)?(TOKEN|PAT)$/,
	/^GIT_CONFIG_(KEY|VALUE)_\d+$/,
];

/**
 * Build the fix runner's environment: the daemon's own environment (the
 * runner still needs provider API keys, which config may read from env)
 * minus every git/gh credential vector, plus settings that make a push or
 * an authenticated `gh` call from inside the runner fail:
 *
 * - no token env vars and an empty `GH_CONFIG_DIR`, so `gh` is logged out;
 * - no ssh-agent socket, and `GIT_SSH_COMMAND=false`, so ssh remotes fail;
 * - no askpass or terminal prompt, no system git config, and
 *   `credential.helper` reset to empty (command-scope config, which outranks
 *   the user's global helper), so https remotes have no credentials;
 * - `remote.origin.pushurl` pointed at a dead URL as a belt-and-braces stop.
 *
 * The publish step runs afterwards in the daemon process with the user's
 * normal credentials (see `publishFromClone`).
 */
export function buildFixRunnerEnv(
	baseEnv: NodeJS.ProcessEnv,
	opts: {ghConfigDir: string; inputPath: string; resultPath: string},
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(baseEnv)) {
		if (CREDENTIAL_ENV_VARS.includes(key)) continue;
		if (CREDENTIAL_ENV_PATTERNS.some(re => re.test(key))) continue;
		env[key] = value;
	}
	return {
		...env,
		GH_CONFIG_DIR: opts.ghConfigDir,
		GH_PROMPT_DISABLED: '1',
		GIT_TERMINAL_PROMPT: '0',
		GIT_ASKPASS: 'false',
		SSH_ASKPASS_REQUIRE: 'never',
		GIT_SSH_COMMAND: 'false',
		GIT_CONFIG_NOSYSTEM: '1',
		GIT_CONFIG_COUNT: '2',
		GIT_CONFIG_KEY_0: 'credential.helper',
		GIT_CONFIG_VALUE_0: '',
		GIT_CONFIG_KEY_1: 'remote.origin.pushurl',
		GIT_CONFIG_VALUE_1: 'nanocoder-push-disabled://ci-fix-runner',
		NANOCODER_CI_FIX_INPUT_PATH: opts.inputPath,
		NANOCODER_CI_FIX_RESULT_PATH: opts.resultPath,
	};
}

/**
 * Fetch the failing steps' log with the daemon's own `gh` login, then write
 * it under the clone's `.git/` for the runner to read. The runner itself has
 * no GitHub credentials (see `buildFixRunnerEnv`), so this is its only way
 * to see the log.
 */
async function stageFailedLogInClone(
	clonePath: string,
	runId: number,
): Promise<string | undefined> {
	try {
		const log = await execGh(
			['run', 'view', runId.toString(), '--log-failed'],
			TIMEOUT_GH_LOG_MS,
		);
		const absPath = join(clonePath, FAILED_LOG_RELATIVE_PATH);
		mkdirSync(join(absPath, '..'), {recursive: true});
		writeFileSync(absPath, log, 'utf-8');
		return FAILED_LOG_RELATIVE_PATH;
	} catch (err) {
		console.error(
			`Could not fetch failed-step log for run ${runId}: ${formatError(err)}`,
		);
		return undefined;
	}
}

/**
 * Publish the fix without trusting anything inside the clone. The runner
 * could have rewritten the clone's `.git/config` (a different origin URL, a
 * `credential.helper` or `core.sshCommand` that runs a command, `insteadOf`
 * rewrites) or planted hooks, and a `git push` run inside the clone would
 * honour all of it with the user's real credentials. Instead, fetch the
 * branch from the clone into a private ref of the user's own repository and
 * push from there, to the project's own `origin`, with hooks skipped (a
 * fresh clone never had any, so this matches what pushing from it did).
 */
export async function publishFromClone(
	opts: PublishBranchOptions,
	exec: typeof execGit = execGit,
): Promise<void> {
	const ref = `refs/nanocoder/ci-fix/${opts.runId}`;
	await exec([
		'-C',
		opts.projectRoot,
		'fetch',
		'--no-tags',
		'--no-write-fetch-head',
		pathToFileURL(opts.clonePath).href,
		`+refs/heads/${opts.branch}:${ref}`,
	]);
	try {
		await exec(
			[
				'-C',
				opts.projectRoot,
				'push',
				'--no-verify',
				'origin',
				`${ref}:refs/heads/${opts.branch}`,
			],
			TIMEOUT_GIT_PUSH_MS,
		);
	} finally {
		await exec(['-C', opts.projectRoot, 'update-ref', '-d', ref]).catch(
			() => undefined,
		);
	}
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
	opts: {signal?: AbortSignal; cwd?: string} = {},
): Promise<CiFixRunnerResult> {
	return new Promise((resolve, reject) => {
		const runnerEntry = fileURLToPath(
			new URL('./ci-fix-runner.js', import.meta.url),
		);
		const workDir = mkdtempSync(join(tmpdir(), 'nanocoder-ci-fix-io-'));
		const inputPath = join(workDir, 'input.json');
		const resultPath = join(workDir, 'result.json');
		const ghConfigDir = join(workDir, 'gh-config');
		mkdirSync(ghConfigDir);
		writeFileSync(inputPath, JSON.stringify(input), 'utf-8');

		const cleanupIoDir = () => rmSync(workDir, {recursive: true, force: true});

		let child: ChildProcess;
		try {
			// The runner chdirs into the clone itself, but starts in the project
			// root so it resolves the project's agents.config.json (providers are
			// often defined in an uncommitted local config).
			child = spawn(process.execPath, [runnerEntry], {
				cwd: opts.cwd,
				env: buildFixRunnerEnv(process.env, {
					ghConfigDir,
					inputPath,
					resultPath,
				}),
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
	stageFailedLog: stageFailedLogInClone,
	publishBranch: opts => publishFromClone(opts),
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
		stageFailedLog,
		publishBranch,
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
		const failedLogPath = await stageFailedLog(worktree.path, payload.runId);

		let runnerResult: CiFixRunnerResult;
		try {
			runnerResult = await spawnFixRunner(
				{
					worktreePath: worktree.path,
					trustLevel,
					payload,
					taskDescription: task.description,
					failedLogPath,
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

		const publishOpts: PublishBranchOptions = {
			projectRoot,
			clonePath: worktree.path,
			branch: worktree.branch,
			runId: payload.runId,
		};
		let pushed = false;
		try {
			if (trustLevel === 'auto-fix') {
				await publishBranch(publishOpts);
				pushed = true;
				await recordAutoFixedShas(projectRoot, runnerResult.commitShas).catch(
					() => undefined,
				);
				const prUrl = await createDraftPr({
					title: `fix(ci): ${payload.workflowName} failed on ${payload.branch}`,
					body: redactSecrets(runnerResult.output),
					base: payload.branch,
					head: worktree.branch,
				});
				return toSubagentResult(task.subagent_type, startTime, {
					success: true,
					fixApplied: true,
					output: `Opened draft PR: ${prUrl}\n\n${runnerResult.output}`,
				});
			}

			await publishBranch(publishOpts);
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
