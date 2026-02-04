/**
 * Git Diff Tool
 *
 * View changes between states (staged, unstaged, or against a commit/branch).
 */

import {Box, Text} from 'ink';
import React from 'react';

import {useTheme} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {execGit, truncateDiff} from './utils';

// ============================================================================
// Types
// ============================================================================

interface GitDiffInput {
	staged?: boolean;
	file?: string;
	base?: string;
	stat?: boolean;
}

// ============================================================================
// Execution
// ============================================================================

const executeGitDiff = async (args: GitDiffInput): Promise<string> => {
	try {
		const gitArgs: string[] = ['diff'];

		// Add --cached for staged changes
		if (args.staged) {
			gitArgs.push('--cached');
		}

		// Add base reference (branch or commit)
		if (args.base) {
			gitArgs.push(args.base);
		}

		// Show stat only
		if (args.stat) {
			gitArgs.push('--stat');
		}

		// Specific file
		if (args.file) {
			gitArgs.push('--', args.file);
		}

		const output = await execGit(gitArgs);

		if (!output.trim()) {
			if (args.staged) {
				return 'No staged changes.';
			}
			if (args.base) {
				return `No differences with ${args.base}.`;
			}
			return 'No unstaged changes.';
		}

		// Truncate if too long (unless stat mode which is already compact)
		if (!args.stat) {
			const {content, truncated, totalLines} = truncateDiff(output, 500);
			if (truncated) {
				return `${content}\n\n[Total: ${totalLines} lines]`;
			}
		}

		return output;
	} catch (error) {
		return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
	}
};

// ============================================================================
// Tool Definition
// ============================================================================

const gitDiffCoreTool = tool({
	description:
		'View git diff of changes. Shows unstaged changes by default, use staged=true for staged changes, or base to compare against a branch/commit.',
	inputSchema: jsonSchema<GitDiffInput>({
		type: 'object',
		properties: {
			staged: {
				type: 'boolean',
				description: 'Show staged changes instead of unstaged (default: false)',
			},
			file: {
				type: 'string',
				description: 'Show diff for a specific file only',
			},
			base: {
				type: 'string',
				description:
					'Compare against a branch or commit (e.g., "main", "HEAD~3")',
			},
			stat: {
				type: 'boolean',
				description: 'Show only diffstat summary instead of full diff',
			},
		},
		required: [],
	}),
	// AUTO - read-only operation, never needs approval
	needsApproval: () => false,
	execute: async (args, _options) => {
		return await executeGitDiff(args);
	},
});

// ============================================================================
// Formatter
// ============================================================================

function GitDiffFormatter({
	args,
	result,
}: {
	args: GitDiffInput;
	result?: string;
}): React.ReactElement {
	const {colors} = useTheme();

	// Parse result for stats
	let filesChanged = 0;
	let insertions = 0;
	let deletions = 0;
	let isEmpty = false;

	if (result) {
		isEmpty =
			result.includes('No staged changes') ||
			result.includes('No unstaged changes') ||
			result.includes('No differences');

		// Parse diffstat summary line
		const statMatch = result.match(
			/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
		);
		if (statMatch) {
			filesChanged = parseInt(statMatch[1], 10) || 0;
			insertions = parseInt(statMatch[2], 10) || 0;
			deletions = parseInt(statMatch[3], 10) || 0;
		}
	}

	// Determine what we're comparing
	let comparing = 'working tree vs HEAD';
	if (args.staged) {
		comparing = 'staged vs HEAD';
	}
	if (args.base) {
		comparing = `working tree vs ${args.base}`;
		if (args.staged) {
			comparing = `staged vs ${args.base}`;
		}
	}

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={colors.tool}>⚒ git_diff</Text>

			<Box>
				<Text color={colors.secondary}>Comparing: </Text>
				<Text color={colors.text}>{comparing}</Text>
			</Box>

			{args.file && (
				<Box>
					<Text color={colors.secondary}>File: </Text>
					<Text color={colors.primary}>{args.file}</Text>
				</Box>
			)}

			{args.stat && (
				<Box>
					<Text color={colors.secondary}>Mode: </Text>
					<Text color={colors.text}>stat only</Text>
				</Box>
			)}

			{isEmpty && (
				<Box marginTop={1}>
					<Text color={colors.success}>No changes</Text>
				</Box>
			)}

			{!isEmpty && filesChanged > 0 && (
				<Box marginTop={1}>
					<Text color={colors.secondary}>Stats: </Text>
					<Text color={colors.text}>{filesChanged} files, </Text>
					<Text color={colors.success}>+{insertions}</Text>
					<Text color={colors.text}>, </Text>
					<Text color={colors.error}>-{deletions}</Text>
				</Box>
			)}
		</Box>
	);
}

const formatter = (args: GitDiffInput, result?: string): React.ReactElement => {
	return <GitDiffFormatter args={args} result={result} />;
};

// ============================================================================
// Export
// ============================================================================

export const gitDiffTool: NanocoderToolExport = {
	name: 'git_diff' as const,
	tool: gitDiffCoreTool,
	formatter,
};
