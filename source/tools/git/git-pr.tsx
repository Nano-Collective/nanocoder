/**
 * Git PR Tool
 *
 * Pull request management using gh CLI: create, view, list, diff, comment,
 * review, checks, and CI run log reading.
 */

import {Box, Text} from 'ink';
import React from 'react';
import {TIMEOUT_GH_LOG_MS} from '@/constants';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {queryCiLog} from './log-utils';
import {
	type CommitInfo,
	execGh,
	getCommits,
	getCurrentBranch,
	getDefaultBranch,
	getUpstreamBranch,
	truncateDiff,
} from './utils';

// ============================================================================
// Types
// ============================================================================

interface GitPrInput {
	create?: {
		title: string;
		body?: string;
		base?: string;
		draft?: boolean;
	};
	view?: number;
	list?: {
		state?: 'open' | 'closed' | 'merged' | 'all';
		author?: string;
		limit?: number;
	};
	diff?: number;
	comment?: {
		pr: number;
		body: string;
	};
	review?: {
		pr: number;
		verdict: 'approve' | 'request-changes' | 'comment';
		body?: string;
	};
	checks?: {
		pr: number;
	};
	logs?: {
		run?: number;
		pr?: number;
		branch?: string;
		failedOnly?: boolean;
		search?: string;
		offset?: number;
		limit?: number;
	};
}

// ============================================================================
// Preview
// ============================================================================

async function getCreatePreview(
	base: string,
): Promise<{commits: CommitInfo[]; branch: string}> {
	const branch = await getCurrentBranch();
	const commits = await getCommits({range: `${base}..HEAD`});
	return {commits, branch};
}

// ============================================================================
// Execution
// ============================================================================

/**
 * Resolve a GitHub Actions run ID for the `logs` action: an explicit `run`
 * wins; otherwise resolve a branch (explicit `branch`, else the given PR's
 * head branch, else the current branch) and take its most recent run.
 */
async function resolveRunId(
	logs: NonNullable<GitPrInput['logs']>,
): Promise<string> {
	if (logs.run !== undefined) {
		return logs.run.toString();
	}

	let branch = logs.branch;
	if (!branch && logs.pr !== undefined) {
		const output = await execGh(
			['pr', 'view', logs.pr.toString(), '--json', 'headRefName'],
			TIMEOUT_GH_LOG_MS,
		);
		branch = JSON.parse(output).headRefName;
	}
	if (!branch) {
		branch = await getCurrentBranch();
	}

	// --status completed: an in-progress/queued run has no (or incomplete)
	// failure logs, so only ever resolve to the latest finished run.
	const output = await execGh(
		[
			'run',
			'list',
			'--branch',
			branch,
			'--status',
			'completed',
			'--limit',
			'1',
			'--json',
			'databaseId',
		],
		TIMEOUT_GH_LOG_MS,
	);
	const runs = JSON.parse(output);
	if (!runs.length) {
		throw new Error(`No completed CI runs found for branch "${branch}".`);
	}
	return runs[0].databaseId.toString();
}

const executeGitPr = async (args: GitPrInput): Promise<string> => {
	try {
		// CREATE
		if (args.create) {
			const base = args.create.base || (await getDefaultBranch());
			const branch = await getCurrentBranch();

			// Check if upstream is set
			const upstream = await getUpstreamBranch();
			if (!upstream) {
				return 'Error: No upstream branch set. Push your branch first with execute_bash (e.g. `git push -u origin HEAD`).';
			}

			// Build gh command
			const ghArgs: string[] = [
				'pr',
				'create',
				'--title',
				args.create.title,
				'--base',
				base,
			];

			if (args.create.body) {
				ghArgs.push('--body', args.create.body);
			} else {
				ghArgs.push('--body', '');
			}

			if (args.create.draft) {
				ghArgs.push('--draft');
			}

			const output = await execGh(ghArgs);

			const lines: string[] = [];
			lines.push('Pull request created successfully!');
			lines.push('');
			lines.push(`Title: ${args.create.title}`);
			lines.push(`Base: ${base} ← ${branch}`);

			// Extract PR URL from output
			const urlMatch = output.match(/https:\/\/github\.com\/[^\s]+/);
			if (urlMatch) {
				lines.push('');
				lines.push(`URL: ${urlMatch[0]}`);
			}

			if (args.create.draft) {
				lines.push('');
				lines.push('(Created as draft)');
			}

			return lines.join('\n');
		}

		// VIEW
		if (args.view !== undefined) {
			const output = await execGh([
				'pr',
				'view',
				args.view.toString(),
				'--json',
				'number,title,state,author,url,body,headRefName,baseRefName,additions,deletions,changedFiles',
			]);

			const pr = JSON.parse(output);

			const lines: string[] = [];
			lines.push(`PR #${pr.number}: ${pr.title}`);
			lines.push('');
			lines.push(`State: ${pr.state}`);
			lines.push(`Author: ${pr.author?.login || 'unknown'}`);
			lines.push(`Branch: ${pr.baseRefName} ← ${pr.headRefName}`);
			lines.push(
				`Changes: ${pr.changedFiles} files (+${pr.additions}, -${pr.deletions})`,
			);
			lines.push('');
			lines.push(`URL: ${pr.url}`);

			if (pr.body) {
				lines.push('');
				lines.push('Description:');
				lines.push(pr.body.substring(0, 500));
				if (pr.body.length > 500) {
					lines.push('... (truncated)');
				}
			}

			return lines.join('\n');
		}

		// DIFF
		if (args.diff !== undefined) {
			const output = await execGh(['pr', 'diff', args.diff.toString()]);
			const {content, truncated, totalLines} = truncateDiff(output);

			const lines: string[] = [];
			lines.push(`Diff for PR #${args.diff}:`);
			lines.push('');
			lines.push(content);
			if (truncated) {
				lines.push('');
				lines.push(`(${totalLines} total lines)`);
			}

			return lines.join('\n');
		}

		// COMMENT
		if (args.comment) {
			await execGh([
				'pr',
				'comment',
				args.comment.pr.toString(),
				'--body',
				args.comment.body,
			]);
			return `Comment posted on PR #${args.comment.pr}.`;
		}

		// REVIEW
		if (args.review) {
			const {pr, verdict, body} = args.review;
			const ghArgs: string[] = ['pr', 'review', pr.toString()];

			if (verdict === 'approve') {
				ghArgs.push('--approve');
			} else if (verdict === 'request-changes') {
				ghArgs.push('--request-changes');
			} else {
				ghArgs.push('--comment');
			}

			if (body) {
				ghArgs.push('--body', body);
			}

			await execGh(ghArgs);
			return `Review (${verdict}) submitted on PR #${pr}.`;
		}

		// CHECKS
		if (args.checks) {
			const output = await execGh([
				'pr',
				'checks',
				args.checks.pr.toString(),
				'--json',
				'name,bucket,state,workflow',
			]);
			const checks = JSON.parse(output);

			if (!Array.isArray(checks) || checks.length === 0) {
				return `No checks found for PR #${args.checks.pr}.`;
			}

			const lines: string[] = [];
			lines.push(`Checks for PR #${args.checks.pr}:`);
			lines.push('');
			for (const c of checks) {
				const icon =
					c.bucket === 'pass' ? '✓' : c.bucket === 'fail' ? '✗' : '…';
				lines.push(`${icon} ${c.name} (${c.state})`);
			}

			return lines.join('\n');
		}

		// LOGS
		if (args.logs) {
			const runId = await resolveRunId(args.logs);
			const failedOnly = args.logs.failedOnly !== false;

			const rawLog = await execGh(
				['run', 'view', runId, failedOnly ? '--log-failed' : '--log'],
				TIMEOUT_GH_LOG_MS,
			);

			const {content, totalLines, truncated, matchCount} = queryCiLog(rawLog, {
				search: args.logs.search,
				offset: args.logs.offset,
				limit: args.logs.limit,
			});

			const lines: string[] = [];
			lines.push(
				`Log for run #${runId}${failedOnly ? ' (failed steps only)' : ''}:`,
			);
			lines.push(
				`Total lines: ${totalLines}` +
					(matchCount !== undefined ? `, matches: ${matchCount}` : '') +
					(truncated ? ' (truncated)' : ''),
			);
			lines.push('');
			lines.push(content || '(empty)');

			return lines.join('\n');
		}

		// LIST
		if (
			args.list ||
			(!args.create &&
				args.view === undefined &&
				args.diff === undefined &&
				!args.comment &&
				!args.review &&
				!args.checks &&
				!args.logs)
		) {
			const state = args.list?.state || 'open';
			const limit = args.list?.limit || 10;

			const ghArgs: string[] = [
				'pr',
				'list',
				'--state',
				state,
				'--limit',
				limit.toString(),
				'--json',
				'number,title,state,author,headRefName,updatedAt',
			];

			if (args.list?.author) {
				ghArgs.push('--author', args.list.author);
			}

			const output = await execGh(ghArgs);
			const prs = JSON.parse(output);

			if (prs.length === 0) {
				return `No ${state} pull requests found.`;
			}

			const lines: string[] = [];
			lines.push(`Pull requests (${state}, ${prs.length} found):`);
			lines.push('');

			for (const pr of prs) {
				lines.push(`#${pr.number} ${pr.title}`);
				lines.push(
					`  ${pr.headRefName} by ${pr.author?.login || 'unknown'} (${pr.state})`,
				);
			}

			return lines.join('\n');
		}

		return 'Error: No valid action specified. Use create, view, list, diff, comment, review, checks, or logs.';
	} catch (error) {
		const message = formatError(error);

		// Check for common gh errors
		if (message.includes('gh auth login')) {
			return 'Error: Not authenticated with GitHub. Run "gh auth login" first.';
		}

		if (message.includes('not a git repository')) {
			return 'Error: Not in a git repository.';
		}

		if (message.includes('no upstream')) {
			return 'Error: No upstream branch. Push your branch first.';
		}

		return `Error: ${message}`;
	}
};

// ============================================================================
// Tool Definition
// ============================================================================

const gitPrCoreTool = tool({
	description:
		'Manage GitHub pull requests: create, view, list, diff, comment, review, check CI status, and read CI run logs. Requires gh CLI to be installed and authenticated.',
	inputSchema: jsonSchema<GitPrInput>({
		type: 'object',
		properties: {
			create: {
				type: 'object',
				description: 'Create a new pull request',
				properties: {
					title: {
						type: 'string',
						description: 'PR title (required)',
					},
					body: {
						type: 'string',
						description: 'PR description/body',
					},
					base: {
						type: 'string',
						description: 'Base branch (default: main/master)',
					},
					draft: {
						type: 'boolean',
						description: 'Create as draft PR',
					},
				},
				required: ['title'],
			},
			view: {
				type: 'number',
				description: 'View details of a specific PR by number',
			},
			list: {
				type: 'object',
				description: 'List pull requests',
				properties: {
					state: {
						type: 'string',
						enum: ['open', 'closed', 'merged', 'all'],
						description: 'Filter by state (default: open)',
					},
					author: {
						type: 'string',
						description: 'Filter by author (use "@me" for self)',
					},
					limit: {
						type: 'number',
						description: 'Max results (default: 10)',
					},
				},
			},
			diff: {
				type: 'number',
				description: 'Show the diff for a specific PR by number',
			},
			comment: {
				type: 'object',
				description: 'Post a comment on a PR',
				properties: {
					pr: {type: 'number', description: 'PR number'},
					body: {type: 'string', description: 'Comment body'},
				},
				required: ['pr', 'body'],
			},
			review: {
				type: 'object',
				description: 'Submit a review on a PR',
				properties: {
					pr: {type: 'number', description: 'PR number'},
					verdict: {
						type: 'string',
						enum: ['approve', 'request-changes', 'comment'],
						description: 'Review verdict',
					},
					body: {
						type: 'string',
						description: 'Review body (required by gh for request-changes)',
					},
				},
				required: ['pr', 'verdict'],
			},
			checks: {
				type: 'object',
				description: 'List CI check status for a PR',
				properties: {
					pr: {type: 'number', description: 'PR number'},
				},
				required: ['pr'],
			},
			logs: {
				type: 'object',
				description:
					'Read a CI run log, with search/pagination to avoid returning huge logs. ' +
					'Resolves the run from `run`, else the head branch of `pr`, else `branch`, else the current branch.',
				properties: {
					run: {
						type: 'number',
						description: 'Explicit GitHub Actions run ID',
					},
					pr: {
						type: 'number',
						description: "Resolve the latest run from this PR's head branch",
					},
					branch: {
						type: 'string',
						description: 'Resolve the latest run from this branch',
					},
					failedOnly: {
						type: 'boolean',
						description:
							'Only fetch failed-step logs via --log-failed (default: true). Set false for --log (full log).',
					},
					search: {
						type: 'string',
						description:
							'Case-insensitive substring filter; returns matching lines with context instead of the whole log',
					},
					offset: {
						type: 'number',
						description:
							'Line offset for pagination, counted back from the end of the log (ignored when `search` is set)',
					},
					limit: {
						type: 'number',
						description: 'Max lines returned (default 300, hard cap 2000)',
					},
				},
			},
		},
		required: [],
	}),
	execute: async (args, _options) => {
		return await executeGitPr(args);
	},
});

// ============================================================================
// Formatter
// ============================================================================

function GitPrFormatter({
	args,
	result,
}: {
	args: GitPrInput;
	result?: string;
}): React.ReactElement {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();
	const [preview, setPreview] = React.useState<{
		commits: CommitInfo[];
		branch: string;
		base: string;
	} | null>(null);

	// Determine action
	const action = args.create
		? 'create'
		: args.view !== undefined
			? 'view'
			: args.diff !== undefined
				? 'diff'
				: args.comment
					? 'comment'
					: args.review
						? 'review'
						: args.checks
							? 'checks'
							: args.logs
								? 'logs'
								: 'list';

	// Load preview for create before execution
	React.useEffect(() => {
		if (!result && args.create) {
			(async () => {
				const base = args.create?.base || (await getDefaultBranch());
				const {commits, branch} = await getCreatePreview(base);
				setPreview({commits, branch, base});
			})().catch(() => {});
		}
	}, [args, result]);

	return (
		<Box flexDirection="column" marginBottom={1} width={boxWidth}>
			<Text color={colors.tool}>⚒ git_pr</Text>

			<Box>
				<Text color={colors.secondary}>Action: </Text>
				<Text color={colors.text}>{action}</Text>
			</Box>

			{action === 'create' && args.create && (
				<>
					{preview && (
						<Box>
							<Text color={colors.secondary}>Branch: </Text>
							<Text color={colors.text}>{preview.branch}</Text>
						</Box>
					)}

					{preview && preview.commits.length > 0 && (
						<Box>
							<Text color={colors.secondary}>Commits: </Text>
							<Text color={colors.text}>{preview.commits.length}</Text>
						</Box>
					)}

					{args.create.draft && (
						<Box>
							<Text color={colors.secondary}>Draft: </Text>
							<Text color={colors.warning}>yes</Text>
						</Box>
					)}

					<Box flexDirection="column">
						<Text color={colors.secondary}>Title:</Text>
						<Box marginLeft={2} flexShrink={1}>
							<Text wrap="truncate-end" color={colors.primary}>
								{args.create.title}
							</Text>
						</Box>
					</Box>

					{args.create.body && (
						<Box flexDirection="column">
							<Text color={colors.secondary}>Body:</Text>
							<Box marginLeft={2} flexDirection="column">
								<Text color={colors.text}>{args.create.body}</Text>
							</Box>
						</Box>
					)}
				</>
			)}

			{action === 'view' && (
				<Box>
					<Text color={colors.secondary}>PR: </Text>
					<Text color={colors.primary}>#{args.view}</Text>
				</Box>
			)}

			{action === 'diff' && (
				<Box>
					<Text color={colors.secondary}>PR: </Text>
					<Text color={colors.primary}>#{args.diff}</Text>
				</Box>
			)}

			{action === 'comment' && args.comment && (
				<>
					<Box>
						<Text color={colors.secondary}>PR: </Text>
						<Text color={colors.primary}>#{args.comment.pr}</Text>
					</Box>
					<Box flexDirection="column">
						<Text color={colors.secondary}>Body:</Text>
						<Box marginLeft={2} flexDirection="column">
							<Text color={colors.text}>{args.comment.body}</Text>
						</Box>
					</Box>
				</>
			)}

			{action === 'review' && args.review && (
				<>
					<Box>
						<Text color={colors.secondary}>PR: </Text>
						<Text color={colors.primary}>#{args.review.pr}</Text>
					</Box>
					<Box>
						<Text color={colors.secondary}>Verdict: </Text>
						<Text
							color={
								args.review.verdict === 'request-changes'
									? colors.warning
									: colors.text
							}
						>
							{args.review.verdict}
						</Text>
					</Box>
					{args.review.body && (
						<Box flexDirection="column">
							<Text color={colors.secondary}>Body:</Text>
							<Box marginLeft={2} flexDirection="column">
								<Text color={colors.text}>{args.review.body}</Text>
							</Box>
						</Box>
					)}
				</>
			)}

			{action === 'checks' && args.checks && (
				<Box>
					<Text color={colors.secondary}>PR: </Text>
					<Text color={colors.primary}>#{args.checks.pr}</Text>
				</Box>
			)}

			{action === 'logs' && args.logs && (
				<>
					<Box>
						<Text color={colors.secondary}>Run: </Text>
						<Text color={colors.text}>
							{args.logs.run !== undefined
								? `#${args.logs.run}`
								: args.logs.pr !== undefined
									? `PR #${args.logs.pr}`
									: args.logs.branch || 'current branch'}
						</Text>
					</Box>
					{args.logs.search && (
						<Box>
							<Text color={colors.secondary}>Search: </Text>
							<Text color={colors.text}>{args.logs.search}</Text>
						</Box>
					)}
					{args.logs.offset !== undefined && (
						<Box>
							<Text color={colors.secondary}>Offset: </Text>
							<Text color={colors.text}>{args.logs.offset}</Text>
						</Box>
					)}
				</>
			)}

			{action === 'list' && (
				<Box>
					<Text color={colors.secondary}>State: </Text>
					<Text color={colors.text}>{args.list?.state || 'open'}</Text>
					{args.list?.author && (
						<>
							<Text color={colors.secondary}> by </Text>
							<Text color={colors.text}>{args.list.author}</Text>
						</>
					)}
				</Box>
			)}

			{result?.includes('created successfully') && (
				<Box marginTop={1}>
					<Text color={colors.success}>✓ PR created successfully</Text>
				</Box>
			)}

			{(result?.includes('Comment posted') ||
				result?.includes('submitted on PR')) && (
				<Box marginTop={1}>
					<Text color={colors.success}>✓ {result}</Text>
				</Box>
			)}

			{result?.startsWith('Error:') && (
				<Box marginTop={1}>
					<Text color={colors.error}>✗ {result}</Text>
				</Box>
			)}
		</Box>
	);
}

const formatter = (args: GitPrInput, result?: string): React.ReactElement => {
	return <GitPrFormatter args={args} result={result} />;
};

// ============================================================================
// Export
// ============================================================================

export const gitPrTool: NanocoderToolExport = {
	name: 'git_pr' as const,
	tool: gitPrCoreTool,
	formatter,
	// Deliberately NOT readOnly: true. That would let tool-executor.tsx's
	// classifyTool() batch consecutive git_pr calls into a parallel
	// Promise.all group (see isReadOnly()'s one consumer, classifyTool, in
	// source/hooks/chat-handler/conversation/tool-executor.tsx). That's safe
	// for every mode EXCEPT yolo: resolveToolApproval short-circuits to "no
	// approval needed" for every tool when mode === 'yolo' (before the
	// `approval` fn below is ever consulted), so in yolo mode a mutating
	// action (create/comment/review) reaches the same auto-executed path as
	// view/list/diff/checks/logs — and would then run concurrently with
	// other git_pr calls instead of one at a time. Since git_pr can't be
	// split per-action here (one tool name covers reads and writes), the
	// whole tool stays non-readOnly and every call keeps running serially.
	// Approval varies by action: actions that write to GitHub (create,
	// comment, review) always prompt; read-only inspection (view, list,
	// diff, checks, logs) auto-runs.
	approval: (args: GitPrInput) =>
		Boolean(args.create || args.comment || args.review),
};
