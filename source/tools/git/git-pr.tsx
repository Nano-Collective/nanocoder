/**
 * Git PR Tool
 *
 * Pull request management using gh CLI: create, view, list.
 */

import {Box, Text} from 'ink';
import React from 'react';

import {useTheme} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {
	type CommitInfo,
	execGh,
	getCommits,
	getCurrentBranch,
	getDefaultBranch,
	getUpstreamBranch,
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

const executeGitPr = async (args: GitPrInput): Promise<string> => {
	try {
		// CREATE
		if (args.create) {
			const base = args.create.base || (await getDefaultBranch());
			const branch = await getCurrentBranch();

			// Check if upstream is set
			const upstream = await getUpstreamBranch();
			if (!upstream) {
				return 'Error: No upstream branch set. Push your branch first with git_push (setUpstream: true).';
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

		// LIST
		if (args.list || (!args.create && args.view === undefined)) {
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

		return 'Error: No valid action specified. Use create, view, or list.';
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';

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
		'Manage GitHub pull requests. Create new PR, view PR details, or list PRs. Requires gh CLI to be installed and authenticated.',
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
		},
		required: [],
	}),
	// Approval varies by action
	needsApproval: (args: GitPrInput) => {
		// ALWAYS_APPROVE for create (user should see title/body)
		if (args.create) {
			return true;
		}

		// AUTO for view and list
		return false;
	},
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
		<Box flexDirection="column" marginBottom={1}>
			<Text color={colors.tool}>⚒ git_pr</Text>

			<Box>
				<Text color={colors.secondary}>Action: </Text>
				<Text color={colors.text}>{action}</Text>
			</Box>

			{action === 'create' && args.create && (
				<>
					<Box flexDirection="column">
						<Text color={colors.secondary}>Title:</Text>
						<Box marginLeft={2}>
							<Text color={colors.primary}>{args.create.title}</Text>
						</Box>
					</Box>

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

					{args.create.body && (
						<Box flexDirection="column">
							<Text color={colors.secondary}>Body:</Text>
							<Box marginLeft={2} flexDirection="column">
								<Text color={colors.text}>
									{args.create.body.length > 200
										? `${args.create.body.substring(0, 200)}...`
										: args.create.body}
								</Text>
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

			{result?.includes('Error:') && (
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
};
