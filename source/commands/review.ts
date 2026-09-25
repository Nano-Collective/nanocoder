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
import {getLogger} from '@/utils/logging';
import {errorMsg, successMsg, warningMsg} from '@/utils/message-factory';
import {loadSection} from '@/utils/prompt-builder';

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

type PullRequestTarget = {
	number: string;
	repository?: string;
};

type ParsedReviewTarget =
	| {kind: 'default'}
	| {kind: 'branch'; branch: string}
	| {kind: 'pull-request'; pullRequest: PullRequestTarget};

type ReviewTargetParseResult =
	| {ok: true; target: ParsedReviewTarget}
	| {ok: false; error: string};

const REVIEW_USAGE =
	'Usage: /review [quick] [<branch | PR number | GitHub PR URL>]. Pass exactly one target.';

function parseReviewTarget(args: string[]): ReviewTargetParseResult {
	const targetArgs = args[0]?.toLowerCase() === 'quick' ? args.slice(1) : args;
	if (targetArgs.length > 1) {
		return {ok: false, error: REVIEW_USAGE};
	}

	const target = targetArgs[0];
	if (target === undefined) {
		return {ok: true, target: {kind: 'default'}};
	}

	const validationError = validateTarget(target);
	if (validationError) return {ok: false, error: validationError};

	if (/^\d+$/.test(target)) {
		const number = normalizePullRequestNumber(target);
		return number
			? {ok: true, target: {kind: 'pull-request', pullRequest: {number}}}
			: {
					ok: false,
					error: 'Pull request number must be a positive safe integer.',
				};
	}

	if (/^(?:https?:\/\/|ssh:\/\/|git@github\.com:)/i.test(target)) {
		const pullRequest = parsePullRequestUrl(target);
		return pullRequest
			? {ok: true, target: {kind: 'pull-request', pullRequest}}
			: {
					ok: false,
					error:
						'Target URL must be a GitHub pull request URL like https://github.com/owner/repo/pull/123.',
				};
	}

	return {ok: true, target: {kind: 'branch', branch: target}};
}

function normalizePullRequestNumber(value: string): string | null {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) return null;
	return String(number);
}

function parsePullRequestUrl(value: string): PullRequestTarget | null {
	try {
		const url = new URL(value);
		if (
			url.protocol !== 'https:' ||
			(url.hostname !== 'github.com' && url.hostname !== 'www.github.com')
		) {
			return null;
		}

		const match = url.pathname.match(
			/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:\/.*)?\/?$/,
		);
		if (!match) return null;
		const number = normalizePullRequestNumber(match[3]);
		if (!number) return null;

		return {
			number,
			repository: `${match[1]}/${match[2].replace(/\.git$/i, '')}`,
		};
	} catch {
		return null;
	}
}

function parseGitHubRepository(value: string): string | null {
	const remote = value.trim();
	const scpMatch = remote.match(
		/^(?:[^@/]+@)?github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i,
	);
	if (scpMatch) return scpMatch[1];

	try {
		const url = new URL(remote);
		if (
			!['https:', 'ssh:', 'git:'].includes(url.protocol) ||
			(url.hostname !== 'github.com' && url.hostname !== 'www.github.com')
		) {
			return null;
		}

		const path = url.pathname.replace(/\/+$/, '').replace(/\.git$/i, '');
		const match = path.match(/^\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/);
		return match?.[1] ?? null;
	} catch {
		return null;
	}
}

function parseRepositorySlug(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) ? value : null;
}

function isGitHubNotFound(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /\bHTTP 404\b|\bstatus(?: code)? 404\b/i.test(message);
}

async function getGitHubRepositoryCandidates(
	dependencies: ReviewDependencies,
	execGh: (args: string[]) => Promise<string>,
): Promise<string[]> {
	const remoteNames = (await dependencies.execGit(['remote']))
		.split(/\r?\n/)
		.map(remote => remote.trim())
		.filter(Boolean);
	const remoteRepositories = new Map<string, string>();

	for (const remoteName of remoteNames) {
		const remoteUrl = await dependencies.execGit([
			'remote',
			'get-url',
			'--',
			remoteName,
		]);
		const repository = parseGitHubRepository(remoteUrl);
		if (repository) {
			remoteRepositories.set(repository.toLowerCase(), repository);
		}
	}

	if (remoteRepositories.size === 0) {
		throw new Error(
			'Cannot determine a GitHub repository from the configured remotes. Pass a full GitHub PR URL instead.',
		);
	}

	const candidates = new Map(remoteRepositories);
	for (const repository of remoteRepositories.values()) {
		let metadata: unknown;
		try {
			const response = await execGh(['api', `repos/${repository}`]);
			metadata = JSON.parse(response);
		} catch (error) {
			if (isGitHubNotFound(error)) continue;
			throw new Error(
				`Could not inspect GitHub repository ${repository}: ${
					error instanceof Error ? error.message : String(error)
				}. Pass a full GitHub PR URL to specify the repository explicitly.`,
			);
		}
		if (!metadata || typeof metadata !== 'object') {
			throw new Error(
				`GitHub returned invalid repository data for ${repository}. Pass a full GitHub PR URL to specify the repository explicitly.`,
			);
		}
		const parent = parseRepositorySlug(
			(metadata as {parent?: {full_name?: unknown}}).parent?.full_name,
		);
		if (parent) candidates.set(parent.toLowerCase(), parent);
	}

	return [...candidates.values()];
}

async function resolvePullRequestRepository(
	dependencies: ReviewDependencies,
	execGh: (args: string[]) => Promise<string>,
	number: string,
): Promise<string> {
	const candidates = await getGitHubRepositoryCandidates(dependencies, execGh);
	const matches: string[] = [];

	for (const repository of candidates) {
		try {
			const response = await execGh([
				'api',
				`repos/${repository}/pulls/${number}`,
			]);
			const pullRequest: unknown = JSON.parse(response);
			if (
				!pullRequest ||
				typeof pullRequest !== 'object' ||
				typeof (pullRequest as {html_url?: unknown}).html_url !== 'string'
			) {
				throw new Error(
					`GitHub returned invalid pull request data for ${repository}#${number}.`,
				);
			}
			matches.push(repository);
		} catch (error) {
			if (isGitHubNotFound(error)) continue;
			throw new Error(
				`Could not check PR #${number} in ${repository}: ${
					error instanceof Error ? error.message : String(error)
				}. Pass a full GitHub PR URL to choose the repository explicitly.`,
			);
		}
	}

	if (matches.length === 0) {
		throw new Error(
			`PR #${number} was not found in the configured GitHub repositories. Pass a full GitHub PR URL to specify its owner and repository.`,
		);
	}
	if (matches.length > 1) {
		throw new Error(
			`PR #${number} exists in multiple configured GitHub repositories (${matches.join(', ')}). Pass a full GitHub PR URL to choose one.`,
		);
	}

	return matches[0];
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
				const parsed = parseReviewTarget(args);
				if (!parsed.ok) return errorMsg(parsed.error, 'review');
				let diff: string;
				let targetDescription: string;

				if (parsed.target.kind === 'default') {
					const defaultBranch = await dependencies.getDefaultBranch();
					const currentBranch = await dependencies.getCurrentBranch();
					diff = await getBranchDiff(
						dependencies,
						currentBranch,
						defaultBranch,
					);
					targetDescription = `current branch "${currentBranch}" against "${defaultBranch}"`;
				} else if (parsed.target.kind === 'branch') {
					const defaultBranch = await dependencies.getDefaultBranch();
					const currentBranch = await dependencies.getCurrentBranch();
					const target = parsed.target.branch;
					// If the user passes the default branch name, they want
					// to review the current branch against it (not an empty
					// diff of main...main).
					const branch = target === defaultBranch ? currentBranch : target;
					diff = await getBranchDiff(dependencies, branch, defaultBranch);
					targetDescription =
						target === defaultBranch
							? `current branch "${currentBranch}" against "${defaultBranch}"`
							: `branch "${target}" against "${defaultBranch}"`;
				} else {
					const {number, repository: explicitRepository} =
						parsed.target.pullRequest;
					const ghAvailable = dependencies.isGhAvailable?.() ?? false;
					if (!ghAvailable || !dependencies.execGh) {
						return errorMsg(
							'PR review requires the gh CLI. Install it from https://cli.github.com or use a branch name instead.',
							'review',
						);
					}

					try {
						const repository =
							explicitRepository ??
							(await resolvePullRequestRepository(
								dependencies,
								dependencies.execGh,
								number,
							));
						diff = await dependencies.execGh([
							'pr',
							'diff',
							number,
							'--repo',
							repository,
						]);
						targetDescription = `PR #${number} in ${repository}`;
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						return errorMsg(
							`Failed to fetch PR #${number} diff: ${message}`,
							'review',
						);
					}
				}

				const truncated = truncateDiff(diff, REVIEW_MAX_DIFF_LINES);

				if (!truncated.content.trim()) {
					return warningMsg(
						`No changes found in ${targetDescription}.`,
						'review',
					);
				}

				const coverageNotice = truncated.truncated
					? getTruncationNotice(truncated.totalLines)
					: null;
				const scopeNotice = `Review scope: ${targetDescription}.`;
				const reviewPrompt = dependencies.loadPrompt?.() ?? loadReviewPrompt();
				const parts: string[] = [
					`Reviewing changes from ${targetDescription}:\n`,
				];
				if (coverageNotice) {
					parts.push(`[Note: ${coverageNotice}]\n`);
				}
				parts.push(truncated.content);

				const messages: Message[] = [
					{role: 'system', content: reviewPrompt},
					{role: 'user', content: parts.join('\n')},
				];

				const response = await client.chat(messages, {}, {});
				const review = response?.choices?.[0]?.message?.content?.trim();

				if (!review) {
					const userFacingNotices = [scopeNotice];
					if (coverageNotice) userFacingNotices.push(coverageNotice);
					userFacingNotices.push('Model returned an empty review.');
					return warningMsg(userFacingNotices.join('\n\n'), 'review');
				}

				const userFacingNotices = [scopeNotice];
				if (coverageNotice) userFacingNotices.push(coverageNotice);
				return successMsg(
					`${userFacingNotices.join('\n\n')}\n\n${review}`,
					'review',
				);
			} catch (error) {
				return errorMsg(formatError(error), 'review');
			}
		},
	};
}

function getTruncationNotice(totalLines: number): string {
	const firstLines = Math.ceil(REVIEW_MAX_DIFF_LINES / 2);
	const lastLines = Math.floor(REVIEW_MAX_DIFF_LINES / 2);
	const omittedLines = totalLines - firstLines - lastLines;
	return `Partial diff coverage: the model received the first ${firstLines} and last ${lastLines} of ${totalLines} diff lines; ${omittedLines} intervening lines were omitted and were not reviewed.`;
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
