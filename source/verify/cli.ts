/**
 * CLI surface for `nanocoder verify --pr <n> [--post-review]`.
 *
 * Headless PR review (issue #861, Phase 2 of the Agentic CI/CD Gate
 * roadmap): runs the read-only `verify-pr-review` subagent plus a semgrep
 * pass, formats the result into a single Markdown review body, and either
 * prints it (dry run, the default) or posts it via `gh pr review --comment`
 * (`--post-review`).
 *
 * Posting is done here, by the harness, never by the subagent's own tool
 * calls — a headless run has no registered tool-approval-queue handler, so
 * any `git_pr comment/review` call the subagent attempted would be silently
 * auto-denied (see `source/utils/tool-approval-queue.ts`). See the plan
 * doc / EXPLANATION.md for the full rationale.
 */

import type {SubagentTask} from '@/subagents/types';
import {execGh, getCurrentBranch, isGhAvailable} from '@/tools/git/utils';
import type {LLMClient} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {formatReviewBody} from './format-review';
import {
	runSecurityScan as defaultRunSecurityScan,
	formatFindingsForPrompt,
	type SecurityScanResult,
} from './security-scan';

export interface VerifyCliOptions {
	projectRoot: string;
}

export interface VerifyCliDeps {
	initializePlain: typeof import('@/plain/initialize').initializePlain;
	isGhAvailable: typeof isGhAvailable;
	runSecurityScan: typeof defaultRunSecurityScan;
	runSubagent: (
		init: import('@/plain/initialize').PlainInitResult,
		projectRoot: string,
		task: SubagentTask,
		signal: AbortSignal,
	) => Promise<import('@/subagents/types').SubagentResult>;
	postReview: (pr: number, body: string) => Promise<void>;
}

async function defaultRunSubagent(
	init: import('@/plain/initialize').PlainInitResult,
	projectRoot: string,
	task: SubagentTask,
	signal: AbortSignal,
): Promise<import('@/subagents/types').SubagentResult> {
	const {SubagentExecutor} = await import('@/subagents/subagent-executor');
	const executor = new SubagentExecutor(
		init.toolManager,
		init.client as LLMClient,
		projectRoot,
		'headless',
	);
	return executor.execute(task, signal);
}

async function defaultPostReview(pr: number, body: string): Promise<void> {
	await execGh(['pr', 'review', pr.toString(), '--comment', '--body', body]);
}

const USAGE =
	'Usage: nanocoder verify --pr <number> [--post-review] [--provider <name>] [--model <name>]';

const PROVIDER_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MODEL_PATTERN = /^[a-zA-Z0-9_/.:-]+$/;

interface ParsedArgs {
	pr: number;
	postReview: boolean;
	provider?: string;
	model?: string;
}

function parseArgs(args: string[]): ParsedArgs | {error: string} {
	let prRaw: string | undefined;
	let postReview = false;
	let provider: string | undefined;
	let model: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--pr') {
			prRaw = args[i + 1];
			i++;
		} else if (arg === '--post-review') {
			postReview = true;
		} else if (arg === '--provider') {
			const value = args[i + 1];
			i++;
			if (!value || !PROVIDER_PATTERN.test(value)) {
				return {error: `Invalid --provider value: "${value ?? ''}".`};
			}
			provider = value;
		} else if (arg === '--model') {
			const value = args[i + 1];
			i++;
			if (!value || !MODEL_PATTERN.test(value)) {
				return {error: `Invalid --model value: "${value ?? ''}".`};
			}
			model = value;
		}
	}

	if (!prRaw) {
		return {error: 'Missing required flag: --pr <number>'};
	}
	const pr = Number(prRaw);
	if (!Number.isInteger(pr) || pr <= 0) {
		return {
			error: `Invalid --pr value: "${prRaw}". Must be a positive integer.`,
		};
	}

	return {pr, postReview, provider, model};
}

const defaultDeps: VerifyCliDeps = {
	initializePlain: async opts => {
		const {initializePlain} = await import('@/plain/initialize');
		return initializePlain(opts);
	},
	isGhAvailable,
	runSecurityScan: defaultRunSecurityScan,
	runSubagent: defaultRunSubagent,
	postReview: defaultPostReview,
};

export interface VerifyCliResult {
	exitCode: 0 | 1 | 2;
	output: string;
}

export async function runVerifyCli(
	args: string[],
	opts: VerifyCliOptions,
	depsOverride?: Partial<VerifyCliDeps>,
): Promise<VerifyCliResult> {
	const deps: VerifyCliDeps = {...defaultDeps, ...depsOverride};

	const parsed = parseArgs(args);
	if ('error' in parsed) {
		return {exitCode: 1, output: `${parsed.error}\n${USAGE}`};
	}
	const {pr, postReview, provider, model} = parsed;

	if (!deps.isGhAvailable()) {
		return {
			exitCode: 1,
			output:
				'Error: gh CLI not found. Install and authenticate gh, then retry.',
		};
	}

	// Independent of each other (scan reads the working tree, init bootstraps
	// the LLM/tool stack) — run concurrently rather than paying both
	// durations back-to-back.
	let scan: SecurityScanResult;
	let init: import('@/plain/initialize').PlainInitResult;
	try {
		[scan, init] = await Promise.all([
			deps.runSecurityScan({cwd: opts.projectRoot}),
			deps.initializePlain({cliProvider: provider, cliModel: model}),
		]);
	} catch (error) {
		return {exitCode: 1, output: `Error: ${formatError(error)}`};
	}

	const targetBranch = await getCurrentBranch();
	const task: SubagentTask = {
		subagent_type: 'verify-pr-review',
		description: `Review PR #${pr}`,
		context: {
			prNumber: pr,
			targetBranch,
			semgrepFindings: formatFindingsForPrompt(scan),
		},
	};

	const abortController = new AbortController();
	const sigint = () => abortController.abort();
	process.on('SIGINT', sigint);

	let result: import('@/subagents/types').SubagentResult;
	try {
		result = await deps.runSubagent(
			init,
			opts.projectRoot,
			task,
			abortController.signal,
		);
	} finally {
		process.off('SIGINT', sigint);
	}

	if (!result.success) {
		return {
			exitCode: 1,
			output: `Error: review generation failed: ${result.error ?? 'unknown error'}`,
		};
	}

	const body = formatReviewBody({
		prNumber: pr,
		subagentOutput: result.output,
		scan,
	});

	if (!postReview) {
		return {exitCode: 0, output: body};
	}

	try {
		await deps.postReview(pr, body);
	} catch (error) {
		return {
			exitCode: 2,
			output: `Error: failed to post review (${formatError(error)}). Printing generated review instead:\n\n${body}`,
		};
	}

	return {exitCode: 0, output: `Review posted to PR #${pr}.\n\n${body}`};
}
