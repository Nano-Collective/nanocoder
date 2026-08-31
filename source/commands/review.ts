import {readFileSync} from 'node:fs';
import {basename, dirname, join, normalize} from 'node:path';
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
import {getLogger} from '@/utils/logging';
import {errorMsg, successMsg, warningMsg} from '@/utils/message-factory';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Match the prompt-builder.ts path resolution: sections live under
// source/app/prompts/sections (shipped in the npm package). The basename
// guard prevents directory-traversal via crafted names.
const reviewSectionsDir = join(__dirname, '../../source/app/prompts/sections');

function loadReviewPrompt(): string {
	try {
		const safeName = basename(normalize('review').replace(/^([/\\])+/, ''));
		const promptPath = join(reviewSectionsDir, `${safeName}.md`);
		return readFileSync(promptPath, 'utf-8').trim();
	} catch {
		const logger = getLogger();
		logger.warn(
			'Review prompt not found at %s — falling back to built-in default',
			join(reviewSectionsDir, 'review.md'),
		);
		return 'You are a senior software engineer performing a code review. Review the diff for bugs, security issues, and style violations. Be concise and actionable.';
	}
}

export type ReviewDependencies = {
	execGit: (args: string[]) => Promise<string>;
	getCurrentBranch: () => Promise<string>;
	getDefaultBranch: () => Promise<string>;
	isGhAvailable?: () => boolean;
	execGh?: (args: string[]) => Promise<string>;
};

const defaultDependencies: ReviewDependencies = {
	execGit,
	getCurrentBranch,
	getDefaultBranch,
	isGhAvailable,
	execGh,
};

function validateTarget(target: string): string | null {
	if (target.startsWith('-')) {
		return 'Target must not start with "-". Pass a branch name or PR number.';
	}
	return null;
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
				const defaultBranch = await dependencies.getDefaultBranch();
				const currentBranch = await dependencies.getCurrentBranch();

				let diff: string;
				let targetDescription: string;

				if (args.length === 0) {
					// No target: review current branch against default branch
					diff = await getBranchDiff(
						dependencies,
						currentBranch,
						defaultBranch,
					);
					targetDescription = `current branch "${currentBranch}" against "${defaultBranch}"`;
				} else {
					const target = args[0] as string;

					const validationError = validateTarget(target);
					if (validationError) {
						return errorMsg(validationError, 'review');
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
								diff = await dependencies.execGh([
									'pr',
									'diff',
									target,
									'--repo',
									match[1],
								]);
								targetDescription = `PR #${target}`;
							} catch (error) {
								const message =
									error instanceof Error ? error.message : String(error);
								return errorMsg(
									`Failed to fetch PR #${target} diff: ${message}`,
									'review',
								);
							}
						} else {
							return errorMsg(
								'PR review requires the gh CLI. Install it from https://cli.github.com or use a branch name instead.',
								'review',
							);
						}
					} else {
						// If the user passes the default branch name, they want
						// to review the current branch against it (not an empty
						// diff of main...main).
						const branch = target === defaultBranch ? currentBranch : target;
						diff = await getBranchDiff(dependencies, branch, defaultBranch);
						targetDescription =
							target === defaultBranch
								? `current branch "${currentBranch}" against "${defaultBranch}"`
								: `branch "${target}" against "${defaultBranch}"`;
					}
				}

				const truncated = truncateDiff(diff, 1000);

				if (!truncated.content.trim()) {
					return warningMsg(
						`No changes found in ${targetDescription}.`,
						'review',
					);
				}

				const reviewPrompt = loadReviewPrompt();

				const parts: string[] = [
					`Reviewing changes from ${targetDescription}:\n`,
				];
				if (truncated.truncated) {
					parts.push(
						`[Note: diff truncated — reviewed first and last ${Math.ceil(truncated.totalLines / 2)} of ${truncated.totalLines} lines]\n`,
					);
				}
				parts.push(truncated.content);

				const messages: Message[] = [
					{role: 'system', content: reviewPrompt},
					{role: 'user', content: parts.join('\n')},
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

export const reviewCommand = createReviewCommand();
