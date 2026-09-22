import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderReviewReport} from '@/review/review-report.js';
import {runDeepReview, runDefaultReview} from '@/review/run-default-review.js';
import {getProjectRoot} from '@/services/session-cwd';
import {getSubagentLoader} from '@/subagents/subagent-loader.js';
import {getAgentToolExecutor} from '@/tools/agent-tool';
import {
	execGh,
	execGit,
	getCurrentBranch,
	getDefaultBranch,
	isGhAvailable,
	truncateDiff,
} from '@/tools/git/utils';
import type {Command} from '@/types/commands';
import type {Message} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {getLogger} from '@/utils/logging';
import {errorMsg, successMsg, warningMsg} from '@/utils/message-factory';
import {loadSection} from '@/utils/prompt-builder';
import {parseReviewArgs} from './review-tier';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Maximum number of diff lines to send to the model. truncateDiff keeps
// the first and last half of this budget; keep in sync with the test
// assertion that checks the truncation note.
const REVIEW_MAX_DIFF_LINES = 1000;

export type ReviewDependencies = {
	execGit: (args: string[]) => Promise<string>;
	getCurrentBranch: () => Promise<string>;
	getDefaultBranch: () => Promise<string>;
	isGhAvailable?: () => boolean;
	execGh?: (args: string[]) => Promise<string>;
	loadPrompt?: () => string;
	/** Test seam: overrides the executor the agentic tiers use. */
	getExecutor?: () => unknown;
};

const defaultDependencies: ReviewDependencies = {
	execGit,
	getCurrentBranch,
	getDefaultBranch,
	isGhAvailable,
	execGh,
};

function loadReviewPrompt(): string {
	const content = loadSection('review');
	if (content) return content;

	const logger = getLogger();
	const promptPath = join(
		__dirname,
		'../../source/app/prompts/sections/review.md',
	);
	logger.warn(
		'Review prompt not found at %s — falling back to built-in default',
		promptPath,
	);
	return 'You are a senior software engineer performing a code review. Review the diff for bugs, security issues, and style violations. Be concise and actionable.';
}

function validateTarget(target: string): string | null {
	if (target.startsWith('-')) {
		return 'Target must not start with "-". Pass a branch name or PR number.';
	}
	return null;
}

/**
 * Resolve what to review into a diff plus a human-readable description.
 * Extracted verbatim from the original handler so both tiers share one
 * implementation and the one-shot behavior is unchanged.
 */
async function resolveReviewTarget(
	dependencies: ReviewDependencies,
	args: string[],
): Promise<
	| {ok: true; diff: string; targetDescription: string}
	| {ok: false; error: string}
> {
	const defaultBranch = await dependencies.getDefaultBranch();
	const currentBranch = await dependencies.getCurrentBranch();

	if (args.length === 0) {
		// No target: review current branch against default branch
		const diff = await getBranchDiff(
			dependencies,
			currentBranch,
			defaultBranch,
		);
		return {
			ok: true,
			diff,
			targetDescription: `current branch "${currentBranch}" against "${defaultBranch}"`,
		};
	}

	const target = args[0] as string;

	const validationError = validateTarget(target);
	if (validationError) {
		return {ok: false, error: validationError};
	}

	const isPRNumber = /^\d+$/.test(target);
	if (isPRNumber) {
		const ghAvailable = dependencies.isGhAvailable?.() ?? false;
		if (ghAvailable && dependencies.execGh) {
			try {
				const remote = await dependencies.execGit([
					'remote',
					'get-url',
					'origin',
				]);
				const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
				if (!match?.[1]) {
					throw new Error(
						'Cannot determine GitHub repository slug from remote URL.',
					);
				}
				const diff = await dependencies.execGh([
					'pr',
					'diff',
					target,
					'--repo',
					match[1],
				]);
				return {ok: true, diff, targetDescription: `PR #${target}`};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					error: `Failed to fetch PR #${target} diff: ${message}`,
				};
			}
		}
		return {
			ok: false,
			error:
				'PR review requires the gh CLI. Install it from https://cli.github.com or use a branch name instead.',
		};
	}

	// If the user passes the default branch name, they want to review the
	// current branch against it (not an empty diff of main...main).
	const branch = target === defaultBranch ? currentBranch : target;
	const diff = await getBranchDiff(dependencies, branch, defaultBranch);
	return {
		ok: true,
		diff,
		targetDescription:
			target === defaultBranch
				? `current branch "${currentBranch}" against "${defaultBranch}"`
				: `branch "${target}" against "${defaultBranch}"`,
	};
}

async function getBranchDiff(
	dependencies: ReviewDependencies,
	branch: string,
	defaultBranch: string,
): Promise<string> {
	await dependencies.execGit(['rev-parse', '--verify', branch]);

	// defaultBranch...branch shows changes on `branch` since it diverged
	// from defaultBranch — exactly what a reviewer wants to see.
	return dependencies.execGit([
		'diff',
		'--no-ext-diff',
		'--no-color',
		`${defaultBranch}...${branch}`,
	]);
}

/** The one-shot quick tier, unchanged from the original implementation. */
type QuickReviewOutcome =
	| {kind: 'no-changes'}
	| {kind: 'empty'}
	| {kind: 'review'; text: string};

async function runQuickReview(
	dependencies: ReviewDependencies,
	diff: string,
	targetDescription: string,
	client: unknown,
): Promise<QuickReviewOutcome> {
	const truncated = truncateDiff(diff, REVIEW_MAX_DIFF_LINES);

	if (!truncated.content.trim()) {
		return {kind: 'no-changes'};
	}

	const reviewPrompt = dependencies.loadPrompt?.() ?? loadReviewPrompt();

	const parts: string[] = [`Reviewing changes from ${targetDescription}:\n`];
	if (truncated.truncated) {
		const halfLines = Math.ceil(REVIEW_MAX_DIFF_LINES / 2);
		parts.push(
			`[Note: diff truncated — reviewed first and last ${halfLines} of ${truncated.totalLines} lines]\n`,
		);
	}
	parts.push(truncated.content);

	const messages: Message[] = [
		{role: 'system', content: reviewPrompt},
		{role: 'user', content: parts.join('\n')},
	];

	const response = await (
		client as {chat: (messages: Message[]) => Promise<unknown>}
	).chat(messages);
	const review = (
		response as {
			choices?: Array<{message?: {content?: string}}>;
		}
	)?.choices?.[0]?.message?.content?.trim();
	return review ? {kind: 'review', text: review} : {kind: 'empty'};
}

export function createReviewCommand(
	dependencies: ReviewDependencies = defaultDependencies,
): Command {
	return {
		name: 'review',
		description:
			'Review a branch or PR diff for bugs, security issues, and style violations',
		progressLabel: 'Reviewing code',
		handler: async (args, _messages, metadata) => {
			const client = metadata.client;
			if (!client) {
				return errorMsg('No active LLM client available.', 'review');
			}

			try {
				const {tier, args: tierArgs} = parseReviewArgs(args);

				const resolved = await resolveReviewTarget(dependencies, tierArgs);
				if (!resolved.ok) {
					return errorMsg(resolved.error, 'review');
				}
				const {diff, targetDescription} = resolved;

				if (tier !== 'quick') {
					const executor =
						(dependencies.getExecutor?.() as ReturnType<
							typeof getAgentToolExecutor
						>) ?? getAgentToolExecutor();
					if (executor) {
						const result =
							tier === 'deep'
								? await runDeepReview(executor, {
										diff,
										targetDescription,
										projectRoot: getProjectRoot(),
										signal: undefined,
										loader: getSubagentLoader(),
									})
								: await runDefaultReview(executor, {
										diff,
										targetDescription,
										projectRoot: getProjectRoot(),
										signal: undefined,
										loader: getSubagentLoader(),
									});
						return successMsg(
							renderReviewReport(result, targetDescription),
							'review',
						);
					}
					// Agentic tiers need the executor; without one, say so and fall
					// back to the one-shot path rather than failing outright.
					const outcome = await runQuickReview(
						dependencies,
						diff,
						targetDescription,
						client,
					);
					if (outcome.kind === 'no-changes') {
						return warningMsg(
							`No changes found in ${targetDescription}.`,
							'review',
						);
					}
					if (outcome.kind === 'empty') {
						return warningMsg('Model returned an empty review.', 'review');
					}
					return successMsg(
						`${outcome.text}\n\n_(Ran as one-shot review: the subagent executor is not available in this session. Start nanocoder normally for the verified multi-agent review.)_`,
						'review',
					);
				}

				const outcome = await runQuickReview(
					dependencies,
					diff,
					targetDescription,
					client,
				);
				if (outcome.kind === 'no-changes') {
					return warningMsg(
						`No changes found in ${targetDescription}.`,
						'review',
					);
				}
				if (outcome.kind === 'empty') {
					return warningMsg('Model returned an empty review.', 'review');
				}
				return successMsg(outcome.text, 'review');
			} catch (error) {
				return errorMsg(formatError(error), 'review');
			}
		},
	};
}

export const reviewCommand = createReviewCommand();
