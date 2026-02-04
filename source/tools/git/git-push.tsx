/**
 * Git Push Tool
 *
 * Push commits to remote repository.
 */

import {Box, Text} from 'ink';
import React from 'react';

import {useTheme} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {
	type CommitInfo,
	execGit,
	getCurrentBranch,
	getUnpushedCommits,
	getUpstreamBranch,
	remoteExists,
} from './utils';

// ============================================================================
// Types
// ============================================================================

interface GitPushInput {
	remote?: string;
	branch?: string;
	setUpstream?: boolean;
	force?: boolean;
	forceWithLease?: boolean;
}

// ============================================================================
// Preview
// ============================================================================

async function getPushPreview(args: GitPushInput): Promise<{
	remote: string;
	branch: string;
	upstream: string | null;
	commits: CommitInfo[];
	isForce: boolean;
	needsUpstream: boolean;
}> {
	const remote = args.remote || 'origin';
	const branch = args.branch || (await getCurrentBranch());
	const upstream = await getUpstreamBranch();
	const commits = await getUnpushedCommits();
	const isForce = args.force || args.forceWithLease || false;
	const needsUpstream = !upstream && !args.setUpstream;

	return {remote, branch, upstream, commits, isForce, needsUpstream};
}

// ============================================================================
// Execution
// ============================================================================

const executeGitPush = async (args: GitPushInput): Promise<string> => {
	try {
		const remote = args.remote || 'origin';
		const branch = args.branch || (await getCurrentBranch());

		// Validate remote exists
		const exists = await remoteExists(remote);
		if (!exists) {
			return `Error: Remote '${remote}' does not exist.`;
		}

		// Get commits that will be pushed
		const commits = await getUnpushedCommits();

		// Build git command
		const gitArgs: string[] = ['push'];

		if (args.setUpstream) {
			gitArgs.push('-u');
		}

		if (args.force) {
			gitArgs.push('--force');
		} else if (args.forceWithLease) {
			gitArgs.push('--force-with-lease');
		}

		gitArgs.push(remote, branch);

		await execGit(gitArgs);

		const lines: string[] = [];
		lines.push(`Pushed to ${remote}/${branch}`);

		if (commits.length > 0) {
			lines.push('');
			lines.push(`Commits pushed (${commits.length}):`);
			for (const commit of commits.slice(0, 10)) {
				lines.push(`  ${commit.shortHash} ${commit.subject}`);
			}
			if (commits.length > 10) {
				lines.push(`  ... and ${commits.length - 10} more`);
			}
		}

		if (args.setUpstream) {
			lines.push('');
			lines.push(`Upstream set to ${remote}/${branch}`);
		}

		if (args.force || args.forceWithLease) {
			lines.push('');
			lines.push('(Force push completed)');
		}

		return lines.join('\n');
	} catch (error) {
		return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
	}
};

// ============================================================================
// Tool Definition
// ============================================================================

const gitPushCoreTool = tool({
	description:
		'Push commits to remote repository. Use setUpstream=true to set tracking branch, force or forceWithLease for force push (use with caution!).',
	inputSchema: jsonSchema<GitPushInput>({
		type: 'object',
		properties: {
			remote: {
				type: 'string',
				description: 'Remote name (default: origin)',
			},
			branch: {
				type: 'string',
				description: 'Branch to push (default: current branch)',
			},
			setUpstream: {
				type: 'boolean',
				description: 'Set upstream tracking branch (-u)',
			},
			force: {
				type: 'boolean',
				description: 'Force push (DANGEROUS - overwrites remote history)',
			},
			forceWithLease: {
				type: 'boolean',
				description: 'Safer force push (fails if remote has new commits)',
			},
		},
		required: [],
	}),
	// ALWAYS_APPROVE - user should see what commits will be pushed
	needsApproval: () => true,
	execute: async (args, _options) => {
		return await executeGitPush(args);
	},
});

// ============================================================================
// Formatter
// ============================================================================

function GitPushFormatter({
	args,
	result,
}: {
	args: GitPushInput;
	result?: string;
}): React.ReactElement {
	const {colors} = useTheme();
	const [preview, setPreview] = React.useState<{
		remote: string;
		branch: string;
		upstream: string | null;
		commits: CommitInfo[];
		isForce: boolean;
		needsUpstream: boolean;
	} | null>(null);

	// Load preview before execution
	React.useEffect(() => {
		if (!result) {
			getPushPreview(args)
				.then(setPreview)
				.catch(() => {});
		}
	}, [args, result]);

	const isForce = args.force || args.forceWithLease;

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={colors.tool}>⚒ git_push</Text>

			{isForce && (
				<Box>
					<Text color={colors.error}>
						{args.force
							? '⚠️  FORCE PUSH - This will overwrite remote history!'
							: '⚠️  FORCE WITH LEASE - Safer but still rewrites history'}
					</Text>
				</Box>
			)}

			{preview && (
				<>
					<Box>
						<Text color={colors.secondary}>Remote: </Text>
						<Text color={colors.text}>{preview.remote}</Text>
					</Box>

					<Box>
						<Text color={colors.secondary}>Branch: </Text>
						<Text color={colors.primary}>{preview.branch}</Text>
					</Box>

					{preview.commits.length > 0 && (
						<Box flexDirection="column">
							<Text color={colors.secondary}>
								Commits to push ({preview.commits.length}):
							</Text>
							{preview.commits.slice(0, 5).map((commit, i) => (
								<Text key={i} color={colors.text}>
									{'  '}
									{commit.shortHash}
								</Text>
							))}
							{preview.commits.length > 5 && (
								<Text color={colors.primary}>
									{'  '}... and {preview.commits.length - 5} more
								</Text>
							)}
						</Box>
					)}

					{preview.commits.length === 0 && !result && (
						<Box>
							<Text color={colors.warning}>
								No commits to push (up to date)
							</Text>
						</Box>
					)}

					{preview.needsUpstream && (
						<Box>
							<Text color={colors.warning}>
								No upstream set. Consider using setUpstream: true
							</Text>
						</Box>
					)}
				</>
			)}

			{args.setUpstream && (
				<Box>
					<Text color={colors.secondary}>Set upstream: </Text>
					<Text color={colors.text}>yes</Text>
				</Box>
			)}

			{result?.includes('Pushed to') && (
				<Box marginTop={1}>
					<Text color={colors.success}>✓ Push completed successfully</Text>
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

const formatter = (args: GitPushInput, result?: string): React.ReactElement => {
	return <GitPushFormatter args={args} result={result} />;
};

// ============================================================================
// Validator
// ============================================================================

const validator = async (
	args: GitPushInput,
): Promise<{valid: true} | {valid: false; error: string}> => {
	const remote = args.remote || 'origin';

	// Validate remote exists
	const exists = await remoteExists(remote);
	if (!exists) {
		return {valid: false, error: `Remote '${remote}' does not exist`};
	}

	return {valid: true};
};

// ============================================================================
// Export
// ============================================================================

export const gitPushTool: NanocoderToolExport = {
	name: 'git_push' as const,
	tool: gitPushCoreTool,
	formatter,
	validator,
};
