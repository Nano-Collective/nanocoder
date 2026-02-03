/**
 * Git Log Tool
 *
 * View commit history with various filters.
 */

import {Box, Text} from 'ink';
import React from 'react';

import {useTheme} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {getCommits, getCurrentBranch} from './utils';

// ============================================================================
// Types
// ============================================================================

interface GitLogInput {
	count?: number;
	file?: string;
	author?: string;
	since?: string;
	grep?: string;
	branch?: string;
}

// ============================================================================
// Execution
// ============================================================================

const executeGitLog = async (args: GitLogInput): Promise<string> => {
	try {
		const count = Math.min(args.count || 10, 50); // Cap at 50
		const branch = args.branch || (await getCurrentBranch());

		const commits = await getCommits({
			count,
			file: args.file,
			author: args.author,
			since: args.since,
			grep: args.grep,
		});

		if (commits.length === 0) {
			const filters: string[] = [];
			if (args.author) filters.push(`author: ${args.author}`);
			if (args.since) filters.push(`since: ${args.since}`);
			if (args.grep) filters.push(`grep: ${args.grep}`);
			if (args.file) filters.push(`file: ${args.file}`);

			if (filters.length > 0) {
				return `No commits found matching filters: ${filters.join(', ')}`;
			}
			return 'No commits found.';
		}

		const lines: string[] = [];
		lines.push(`Showing ${commits.length} commit(s) on ${branch}:`);
		lines.push('');

		for (const commit of commits) {
			lines.push(
				`${commit.shortHash} ${commit.subject} (${commit.relativeDate})`,
			);
			lines.push(`  Author: ${commit.author} <${commit.email}>`);
		}

		return lines.join('\n');
	} catch (error) {
		return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
	}
};

// ============================================================================
// Tool Definition
// ============================================================================

const gitLogCoreTool = tool({
	description:
		'View git commit history. Supports filtering by count, file, author, date, and commit message search.',
	inputSchema: jsonSchema<GitLogInput>({
		type: 'object',
		properties: {
			count: {
				type: 'number',
				description: 'Number of commits to show (default: 10, max: 50)',
			},
			file: {
				type: 'string',
				description: 'Show history for a specific file',
			},
			author: {
				type: 'string',
				description: 'Filter by author name or email',
			},
			since: {
				type: 'string',
				description:
					'Show commits after date (e.g., "2024-01-01", "1 week ago")',
			},
			grep: {
				type: 'string',
				description: 'Search commit messages for a pattern',
			},
			branch: {
				type: 'string',
				description: 'Show commits on a specific branch (default: current)',
			},
		},
		required: [],
	}),
	// AUTO - read-only operation, never needs approval
	needsApproval: () => false,
	execute: async (args, _options) => {
		return await executeGitLog(args);
	},
});

// ============================================================================
// Formatter
// ============================================================================

function GitLogFormatter({
	args,
	result,
}: {
	args: GitLogInput;
	result?: string;
}): React.ReactElement {
	const {colors} = useTheme();

	// Parse result for display
	let commitCount = 0;
	let branch = '';
	let dateRange = '';

	if (result) {
		const countMatch = result.match(/Showing (\d+) commit/);
		if (countMatch) commitCount = parseInt(countMatch[1], 10);

		const branchMatch = result.match(/on (.+):/);
		if (branchMatch) branch = branchMatch[1];

		// Extract date range from first and last commits
		const dateMatches = result.match(/\(([^)]+)\)/g);
		if (dateMatches && dateMatches.length > 0) {
			const first = dateMatches[0].replace(/[()]/g, '');
			const last = dateMatches[dateMatches.length - 1].replace(/[()]/g, '');
			if (first !== last) {
				dateRange = `${last} → ${first}`;
			} else {
				dateRange = first;
			}
		}
	}

	// Build filter description
	const filters: string[] = [];
	if (args.author) filters.push(`author: ${args.author}`);
	if (args.since) filters.push(`since: ${args.since}`);
	if (args.grep) filters.push(`grep: "${args.grep}"`);
	if (args.file) filters.push(`file: ${args.file}`);

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={colors.tool}>⚒ git_log</Text>

			{branch && (
				<Box>
					<Text color={colors.secondary}>Branch: </Text>
					<Text color={colors.primary}>{branch}</Text>
				</Box>
			)}

			{commitCount > 0 && (
				<Box>
					<Text color={colors.secondary}>Showing: </Text>
					<Text color={colors.text}>{commitCount} commits</Text>
				</Box>
			)}

			{dateRange && (
				<Box>
					<Text color={colors.secondary}>Range: </Text>
					<Text color={colors.text}>{dateRange}</Text>
				</Box>
			)}

			{filters.length > 0 && (
				<Box>
					<Text color={colors.secondary}>Filters: </Text>
					<Text color={colors.text}>{filters.join(', ')}</Text>
				</Box>
			)}

			{commitCount === 0 && result && (
				<Box>
					<Text color={colors.warning}>No commits found</Text>
				</Box>
			)}
		</Box>
	);
}

const formatter = (args: GitLogInput, result?: string): React.ReactElement => {
	return <GitLogFormatter args={args} result={result} />;
};

// ============================================================================
// Export
// ============================================================================

export const gitLogTool: NanocoderToolExport = {
	name: 'git_log' as const,
	tool: gitLogCoreTool,
	formatter,
};
