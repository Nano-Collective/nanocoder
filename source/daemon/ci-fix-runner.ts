#!/usr/bin/env node
/**
 * One-shot CI-fix subprocess entry point.
 *
 * Spawned by `ci-fix-orchestrator.ts` for a single auto-fix/full-commit
 * attempt. Unlike `entry.ts` (a long-running event loop), this process
 * does one thing and exits: run `verify-ci-investigator` at an elevated
 * trust level against an isolated `git worktree`, then report what
 * happened. Its own `process.cwd()` is set to the worktree path — safe
 * here specifically because this process has no other concurrent work
 * sharing that cwd, unlike the daemon's own long-running process.
 *
 * Handoff is via two JSON files (paths in env vars), not stdout scraping —
 * same "state lives on disk" precedent as `daemon/lockfile.ts` — so nothing
 * the subagent itself prints to stdout can corrupt the result.
 */

import {readFileSync, writeFileSync} from 'node:fs';
import {createLLMClient} from '@/client-factory';
import type {CiJobFailedPayload} from '@/events/types';
import {SubagentExecutor} from '@/subagents/subagent-executor';
import type {SubagentTask} from '@/subagents/types';
import {execGit} from '@/tools/git/utils';
import {ToolManager} from '@/tools/tool-manager';
import {formatError} from '@/utils/error-formatter';
import {
	getAllowedToolNames,
	getHeadlessAutoApproveToolNames,
	type TrustLevel,
} from '@/verify/trust';

export interface CiFixRunnerInput {
	worktreePath: string;
	trustLevel: Extract<TrustLevel, 'auto-fix' | 'full-commit'>;
	payload: CiJobFailedPayload;
	taskDescription: string;
}

export interface CiFixRunnerResult {
	success: boolean;
	committed: boolean;
	commitShas: string[];
	output: string;
	error?: string;
}

async function main(): Promise<void> {
	const inputPath = process.env.NANOCODER_CI_FIX_INPUT_PATH;
	const resultPath = process.env.NANOCODER_CI_FIX_RESULT_PATH;
	if (!inputPath || !resultPath) {
		console.error(
			'ci-fix-runner: NANOCODER_CI_FIX_INPUT_PATH/NANOCODER_CI_FIX_RESULT_PATH not set.',
		);
		process.exit(1);
	}

	const input = JSON.parse(
		readFileSync(inputPath, 'utf-8'),
	) as CiFixRunnerInput;

	// Safe here — this process has no other concurrent work sharing its cwd,
	// which is the entire reason it's a separate process from the daemon.
	process.chdir(input.worktreePath);

	let result: CiFixRunnerResult;
	try {
		const {client} = await createLLMClient();
		const toolManager = new ToolManager();
		const executor = new SubagentExecutor(
			toolManager,
			client,
			input.worktreePath,
			'headless',
		);

		const baselineSha = (await execGit(['rev-parse', 'HEAD'])).trim();

		const task: SubagentTask = {
			subagent_type: 'verify-ci-investigator',
			description: input.taskDescription,
			context: {
				trigger: {
					type: 'event',
					kind: 'ci.job.failed',
					payload: input.payload,
				},
				trustLevel: input.trustLevel,
			},
		};

		const subagentResult = await executor.execute(
			task,
			undefined,
			0,
			undefined,
			{
				tools: getAllowedToolNames(input.trustLevel),
				alwaysAllow: getHeadlessAutoApproveToolNames(input.trustLevel),
			},
		);

		const commitLog = await execGit([
			'log',
			`${baselineSha}..HEAD`,
			'--format=%H',
		]);
		const commitShas = commitLog.split('\n').filter(Boolean);

		result = {
			success: subagentResult.success,
			committed: commitShas.length > 0,
			commitShas,
			output: subagentResult.output,
			error: subagentResult.error,
		};
	} catch (err) {
		result = {
			success: false,
			committed: false,
			commitShas: [],
			output: '',
			error: formatError(err),
		};
	}

	writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf-8');
	process.exit(result.success ? 0 : 1);
}

main().catch(err => {
	console.error('ci-fix-runner failed:', err);
	process.exit(1);
});
