/**
 * Git Commit Tool
 *
 * Create a commit with the staged changes.
 */

import {Box, Text} from 'ink';
import React from 'react';

import {useTheme} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {
	execGit,
	type FileChange,
	getDiffStats,
	hasStagedChanges,
	isLastCommitPushed,
	parseGitStatus,
} from './utils';

// ============================================================================
// Types
// ============================================================================

interface GitCommitInput {
	message: string;
	body?: string;
	amend?: boolean;
	noVerify?: boolean;
}

// ============================================================================
// Preview (for formatter before execution)
// ============================================================================

async function getCommitPreview(args: GitCommitInput): Promise<{
	staged: FileChange[];
	totalAdditions: number;
	totalDeletions: number;
	amendWarning: string | null;
}> {
	// Get staged files
	const statusOutput = await execGit(['status', '--porcelain']);
	const {staged} = parseGitStatus(statusOutput);

	// Get diff stats
	const stats = await getDiffStats(true);
	for (const file of staged) {
		const fileStats = stats.get(file.path);
		if (fileStats) {
			file.additions = fileStats.additions;
			file.deletions = fileStats.deletions;
		}
	}

	const totalAdditions = staged.reduce((sum, f) => sum + f.additions, 0);
	const totalDeletions = staged.reduce((sum, f) => sum + f.deletions, 0);

	// Check if amending a pushed commit
	let amendWarning: string | null = null;
	if (args.amend) {
		const pushed = await isLastCommitPushed();
		if (pushed) {
			amendWarning = 'WARNING: Amending a commit that has already been pushed!';
		}
	}

	return {staged, totalAdditions, totalDeletions, amendWarning};
}

// ============================================================================
// Execution
// ============================================================================

const executeGitCommit = async (args: GitCommitInput): Promise<string> => {
	try {
		// Check for staged changes (unless amending)
		if (!args.amend) {
			const hasStaged = await hasStagedChanges();
			if (!hasStaged) {
				return 'Error: No staged changes to commit. Use git_add to stage changes first.';
			}
		}

		// Build commit message
		let fullMessage = args.message;
		if (args.body) {
			fullMessage = `${args.message}\n\n${args.body}`;
		}

		// Build git command
		const gitArgs: string[] = ['commit', '-m', fullMessage];

		if (args.amend) {
			gitArgs.push('--amend');
		}

		if (args.noVerify) {
			gitArgs.push('--no-verify');
		}

		const output = await execGit(gitArgs);

		// Parse the output to get commit info
		const lines: string[] = [];

		// Extract commit hash if present
		const hashMatch = output.match(/\[[\w-]+\s+([a-f0-9]+)\]/);
		if (hashMatch) {
			lines.push(`Commit created: ${hashMatch[1]}`);
		} else {
			lines.push('Commit created successfully.');
		}

		lines.push('');
		lines.push(`Message: ${args.message}`);
		if (args.body) {
			lines.push(
				`Body: ${args.body.substring(0, 100)}${args.body.length > 100 ? '...' : ''}`,
			);
		}

		if (args.amend) {
			lines.push('');
			lines.push('(Amended previous commit)');
		}

		return lines.join('\n');
	} catch (error) {
		return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
	}
};

// ============================================================================
// Tool Definition
// ============================================================================

const gitCommitCoreTool = tool({
	description:
		'Create a git commit with staged changes. Requires a commit message. Use body for extended description, amend to modify the last commit.',
	inputSchema: jsonSchema<GitCommitInput>({
		type: 'object',
		properties: {
			message: {
				type: 'string',
				description: 'The commit message (required)',
			},
			body: {
				type: 'string',
				description: 'Extended description (will be separated by blank line)',
			},
			amend: {
				type: 'boolean',
				description: 'Amend the previous commit instead of creating a new one',
			},
			noVerify: {
				type: 'boolean',
				description: 'Skip pre-commit and commit-msg hooks',
			},
		},
		required: ['message'],
	}),
	// ALWAYS_APPROVE - user should see the commit message before creation
	needsApproval: () => true,
	execute: async (args, _options) => {
		return await executeGitCommit(args);
	},
});

// ============================================================================
// Formatter
// ============================================================================

function GitCommitFormatter({
	args,
	result,
}: {
	args: GitCommitInput;
	result?: string;
}): React.ReactElement {
	const {colors} = useTheme();
	const [preview, setPreview] = React.useState<{
		staged: FileChange[];
		totalAdditions: number;
		totalDeletions: number;
		amendWarning: string | null;
	} | null>(null);

	// Load preview before execution
	React.useEffect(() => {
		if (!result) {
			getCommitPreview(args)
				.then(setPreview)
				.catch(() => {});
		}
	}, [args, result]);

	const stagedCount = preview?.staged.length || 0;
	const additions = preview?.totalAdditions || 0;
	const deletions = preview?.totalDeletions || 0;

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={colors.tool}>⚒ git_commit</Text>

			<Box flexDirection="column">
				<Text color={colors.secondary}>Message:</Text>
				<Box marginLeft={2}>
					<Text color={colors.primary}>{args.message}</Text>
				</Box>
			</Box>

			{args.body && (
				<Box flexDirection="column">
					<Text color={colors.secondary}>Body:</Text>
					<Box marginLeft={2}>
						<Text color={colors.text}>
							{args.body.length > 100
								? `${args.body.substring(0, 100)}...`
								: args.body}
						</Text>
					</Box>
				</Box>
			)}

			{!result && stagedCount > 0 && (
				<Box>
					<Text color={colors.secondary}>Staged: </Text>
					<Text color={colors.text}>{stagedCount} files </Text>
					<Text color={colors.success}>(+{additions}</Text>
					<Text color={colors.text}>, </Text>
					<Text color={colors.error}>-{deletions}</Text>
					<Text color={colors.text}>)</Text>
				</Box>
			)}

			{args.amend && (
				<Box>
					<Text color={colors.warning}>Amending previous commit</Text>
				</Box>
			)}

			{preview?.amendWarning && (
				<Box>
					<Text color={colors.error}>{preview.amendWarning}</Text>
				</Box>
			)}

			{args.noVerify && (
				<Box>
					<Text color={colors.secondary}>Hooks: </Text>
					<Text color={colors.warning}>skipped</Text>
				</Box>
			)}

			{result?.includes('Commit created') && (
				<Box>
					<Text color={colors.success}>Commit created successfully</Text>
				</Box>
			)}

			{result?.includes('Error:') && (
				<Box>
					<Text color={colors.error}>{result}</Text>
				</Box>
			)}
		</Box>
	);
}

const formatter = (
	args: GitCommitInput,
	result?: string,
): React.ReactElement => {
	return <GitCommitFormatter args={args} result={result} />;
};

// ============================================================================
// Validator
// ============================================================================

const validator = async (
	args: GitCommitInput,
): Promise<{valid: true} | {valid: false; error: string}> => {
	if (!args.message || args.message.trim().length === 0) {
		return {valid: false, error: 'Commit message cannot be empty'};
	}

	// Check for staged changes (unless amending)
	if (!args.amend) {
		const hasStaged = await hasStagedChanges();
		if (!hasStaged) {
			return {
				valid: false,
				error: 'No staged changes. Use git_add to stage changes first.',
			};
		}
	}

	return {valid: true};
};

// ============================================================================
// Export
// ============================================================================

export const gitCommitTool: NanocoderToolExport = {
	name: 'git_commit' as const,
	tool: gitCommitCoreTool,
	formatter,
	validator,
};
