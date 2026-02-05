/**
 * Git Pull Tool
 *
 * Pull changes from remote repository.
 */

import {Box, Text} from 'ink';
import React from 'react';

import {getCurrentMode} from '@/context/mode-context';
import {useTheme} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {
	execGit,
	getAheadBehind,
	getCurrentBranch,
	getUpstreamBranch,
	hasUncommittedChanges,
	remoteExists,
} from './utils';

// ============================================================================
// Types
// ============================================================================

interface GitPullInput {
	remote?: string;
	branch?: string;
	rebase?: boolean;
}

// ============================================================================
// Execution
// ============================================================================

const executeGitPull = async (args: GitPullInput): Promise<string> => {
	try {
		const remote = args.remote || 'origin';
		const currentBranch = await getCurrentBranch();
		const upstream = await getUpstreamBranch();

		// Determine branch to pull
		let branch = args.branch;
		if (!branch && upstream) {
			branch = upstream.replace(`${remote}/`, '');
		}
		if (!branch) {
			branch = currentBranch;
		}

		// Check for uncommitted changes
		const hasChanges = await hasUncommittedChanges();
		if (hasChanges && !args.rebase) {
			return 'Warning: You have uncommitted changes. Consider stashing them first or use rebase=true.';
		}

		// Validate remote exists
		const exists = await remoteExists(remote);
		if (!exists) {
			return `Error: Remote '${remote}' does not exist.`;
		}

		// Get ahead/behind before pull
		const {behind: behindBefore} = await getAheadBehind();

		// Build git command
		const gitArgs: string[] = ['pull'];

		if (args.rebase) {
			gitArgs.push('--rebase');
		}

		gitArgs.push(remote, branch);

		const output = await execGit(gitArgs);

		const lines: string[] = [];

		// Check if already up to date
		if (output.includes('Already up to date')) {
			lines.push('Already up to date.');
			return lines.join('\n');
		}

		lines.push(`Pulled from ${remote}/${branch}`);

		// Parse output for stats
		const statsMatch = output.match(
			/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
		);
		if (statsMatch) {
			const files = statsMatch[1] || '0';
			const insertions = statsMatch[2] || '0';
			const deletions = statsMatch[3] || '0';
			lines.push(`Changes: ${files} files, +${insertions}, -${deletions}`);
		}

		if (behindBefore > 0) {
			lines.push(`Merged ${behindBefore} commit(s)`);
		}

		if (args.rebase) {
			lines.push('');
			lines.push('(Rebased local commits on top)');
		}

		return lines.join('\n');
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';

		// Check for merge conflicts
		if (message.includes('CONFLICT') || message.includes('conflict')) {
			return `Error: Merge conflicts detected. Resolve conflicts and commit, or run git_reset to abort.\n\n${message}`;
		}

		return `Error: ${message}`;
	}
};

// ============================================================================
// Tool Definition
// ============================================================================

const gitPullCoreTool = tool({
	description:
		'Pull changes from remote repository. Use rebase=true to rebase local commits on top of remote changes.',
	inputSchema: jsonSchema<GitPullInput>({
		type: 'object',
		properties: {
			remote: {
				type: 'string',
				description: 'Remote name (default: origin)',
			},
			branch: {
				type: 'string',
				description: 'Branch to pull (default: current tracking branch)',
			},
			rebase: {
				type: 'boolean',
				description: 'Rebase local commits instead of merging',
			},
		},
		required: [],
	}),
	// STANDARD - requires approval in normal mode, skipped in auto-accept
	needsApproval: () => {
		const mode = getCurrentMode();
		return mode === 'normal';
	},
	execute: async (args, _options) => {
		return await executeGitPull(args);
	},
});

// ============================================================================
// Formatter
// ============================================================================

function GitPullFormatter({
	args,
	result,
}: {
	args: GitPullInput;
	result?: string;
}): React.ReactElement {
	const {colors} = useTheme();
	const [preview, setPreview] = React.useState<{
		remote: string;
		branch: string;
		behind: number;
		hasChanges: boolean;
	} | null>(null);

	// Load preview before execution
	React.useEffect(() => {
		if (!result) {
			(async () => {
				const remote = args.remote || 'origin';
				const currentBranch = await getCurrentBranch();
				const upstream = await getUpstreamBranch();
				let branch = args.branch;
				if (!branch && upstream) {
					branch = upstream.replace(`${remote}/`, '');
				}
				if (!branch) branch = currentBranch;
				const {behind} = await getAheadBehind();
				const hasChanges = await hasUncommittedChanges();
				setPreview({remote, branch, behind, hasChanges});
			})().catch(() => {});
		}
	}, [args, result]);

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={colors.tool}>⚒ git_pull</Text>

			{preview && (
				<>
					<Box>
						<Text color={colors.secondary}>Remote: </Text>
						<Text color={colors.text}>
							{preview.remote}/{preview.branch}
						</Text>
					</Box>

					<Box>
						<Text color={colors.secondary}>Strategy: </Text>
						<Text color={colors.text}>{args.rebase ? 'rebase' : 'merge'}</Text>
					</Box>

					{preview.behind > 0 && (
						<Box marginTop={1}>
							<Text color={colors.secondary}>Incoming: </Text>
							<Text color={colors.text}>{preview.behind} commit(s)</Text>
						</Box>
					)}

					{preview.behind === 0 && !result && (
						<Box marginTop={1}>
							<Text color={colors.success}>✓ Already up to date</Text>
						</Box>
					)}

					{preview.hasChanges && (
						<Box marginTop={1}>
							<Text color={colors.warning}>Uncommitted changes detected</Text>
						</Box>
					)}
				</>
			)}

			{result?.includes('Pulled from') && (
				<Box marginTop={1}>
					<Text color={colors.success}>✓ Pull completed successfully</Text>
				</Box>
			)}

			{result?.includes('Already up to date') && (
				<Box marginTop={1}>
					<Text color={colors.success}>✓ Already up to date</Text>
				</Box>
			)}

			{result?.includes('CONFLICT') && (
				<Box marginTop={1}>
					<Text color={colors.error}>✗ Merge conflicts detected!</Text>
				</Box>
			)}

			{result?.includes('Error:') && !result.includes('CONFLICT') && (
				<Box marginTop={1}>
					<Text color={colors.error}>✗ {result}</Text>
				</Box>
			)}
		</Box>
	);
}

const formatter = (args: GitPullInput, result?: string): React.ReactElement => {
	return <GitPullFormatter args={args} result={result} />;
};

// ============================================================================
// Export
// ============================================================================

export const gitPullTool: NanocoderToolExport = {
	name: 'git_pull' as const,
	tool: gitPullCoreTool,
	formatter,
};
