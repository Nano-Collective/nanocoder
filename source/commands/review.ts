import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
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
import {errorMsg, successMsg, warningMsg} from '@/utils/message-factory';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadReviewPrompt(): string {
	try {
		const promptPath = join(__dirname, '../app/prompts/sections/review.md');
		return readFileSync(promptPath, 'utf-8').trim();
	} catch {
		return 'You are a senior software engineer performing a code review. Review the diff for bugs, security issues, and style violations. Be concise and actionable.';
	}
}

type ReviewDependencies = {
	execGit: (args: string[]) => Promise<string>;
	getCurrentBranch: () => Promise<string>;
	getDefaultBranch: () => Promise<string>;
	isGhAvailable: () => boolean;
	execGh: (args: string[]) => Promise<string>;
};

const defaultDependencies: ReviewDependencies = {
	execGit,
	getCurrentBranch,
	getDefaultBranch,
	isGhAvailable,
	execGh,
};

export function createReviewCommand(
	dependencies: ReviewDependencies = defaultDependencies,
): Command {
	return {
		name: 'review',
		description:
			'Review a branch or PR diff for bugs, security issues, and style violations',
		progressLabel: 'Reviewing code',
		handler: async (args, _messages, metadata) => {
			if (args.length === 0) {
				return warningMsg(
					'Usage: /review <branch-or-pr-number>\n\nExamples:\n  /review main\n  /review feature/auth\n  /review 42',
					'review',
				);
			}

			const target = args[0] as string;

			const client = metadata.client;
			if (!client) {
				return errorMsg('No active LLM client available.', 'review');
			}

			try {
				const currentBranch = await dependencies.getCurrentBranch();
				const defaultBranch = await dependencies.getDefaultBranch();

				let diff: string;
				let targetDescription: string;

				// If target looks like a PR number and we have gh, use gh pr diff
				const isPRNumber = /^\d+$/.test(target);
				if (isPRNumber) {
					try {
						if (dependencies.isGhAvailable()) {
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
							diff = await dependencies.execGh([
								'pr',
								'diff',
								target,
								'--repo',
								match[1],
							]);
							targetDescription = `PR #${target}`;
						} else {
							// Treat as branch name fallback
							diff = await getBranchDiff(dependencies, target, defaultBranch);
							targetDescription = `branch "${target}" (treated as branch — gh CLI not available for PR lookup)`;
						}
					} catch {
						// If gh fails, treat as branch name
						diff = await getBranchDiff(dependencies, target, defaultBranch);
						targetDescription = `branch "${target}" (PR lookup failed)`;
					}
				} else {
					// Branch name
					diff = await getBranchDiff(dependencies, target, defaultBranch);
					targetDescription = `branch "${target}"`;
				}

				const truncated = truncateDiff(diff, 1000);

				if (!truncated.content.trim()) {
					return warningMsg(
						`No changes found between "${currentBranch}" and "${targetDescription}".`,
						'review',
					);
				}

				const reviewPrompt = loadReviewPrompt();

				const messages: Message[] = [
					{role: 'system', content: reviewPrompt},
					{
						role: 'user',
						content: `Reviewing changes from ${targetDescription} into "${currentBranch}":\n\n${truncated.content}`,
					},
				];

				const response = await client.chat(messages, {}, {});
				const review = response?.choices?.[0]?.message?.content?.trim();

				if (!review) {
					return warningMsg('Model returned an empty review.', 'review');
				}

				return successMsg(review, 'review');
			} catch (error) {
				return errorMsg(formatError(error), 'review');
			}
		},
	};
}

async function getBranchDiff(
	dependencies: ReviewDependencies,
	branch: string,
	defaultBranch: string,
): Promise<string> {
	// Verify the branch exists
	await dependencies.execGit(['rev-parse', '--verify', branch]);

	// Diff the target branch against the default branch
	return dependencies.execGit([
		'diff',
		'--no-ext-diff',
		'--no-color',
		`${defaultBranch}...${branch}`,
	]);
}

export const reviewCommand = createReviewCommand();
