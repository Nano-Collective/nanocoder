/**
 * Git Add Tool
 *
 * Stage files for commit.
 */

import {Box, Text} from 'ink';
import React from 'react';

import {getCurrentMode} from '@/context/mode-context';
import {useTheme} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {execGit, formatStatusChar, getDiffStats, parseGitStatus} from './utils';

// ============================================================================
// Types
// ============================================================================

interface GitAddInput {
	files?: string[];
	all?: boolean;
	update?: boolean;
}

// ============================================================================
// Execution
// ============================================================================

const executeGitAdd = async (args: GitAddInput): Promise<string> => {
	try {
		const gitArgs: string[] = ['add'];

		if (args.all) {
			gitArgs.push('-A');
		} else if (args.update) {
			gitArgs.push('-u');
		} else if (args.files && args.files.length > 0) {
			gitArgs.push(...args.files);
		} else {
			// Default to staging all changes
			gitArgs.push('-A');
		}

		await execGit(gitArgs);

		// Get the new status to show what was staged
		const statusOutput = await execGit(['status', '--porcelain']);
		const {staged} = parseGitStatus(statusOutput);

		// Get diff stats for staged files
		const stats = await getDiffStats(true);
		for (const file of staged) {
			const fileStats = stats.get(file.path);
			if (fileStats) {
				file.additions = fileStats.additions;
				file.deletions = fileStats.deletions;
			}
		}

		if (staged.length === 0) {
			return 'No changes to stage.';
		}

		const totalAdditions = staged.reduce((sum, f) => sum + f.additions, 0);
		const totalDeletions = staged.reduce((sum, f) => sum + f.deletions, 0);

		const lines: string[] = [];
		lines.push(
			`Staged ${staged.length} file(s) (+${totalAdditions}, -${totalDeletions}):`,
		);
		lines.push('');

		for (const file of staged.slice(0, 15)) {
			const char = formatStatusChar(file.status);
			const fileStats =
				file.additions || file.deletions
					? ` (+${file.additions}, -${file.deletions})`
					: '';
			lines.push(`  ${char}  ${file.path}${fileStats}`);
		}

		if (staged.length > 15) {
			lines.push(`  ... and ${staged.length - 15} more files`);
		}

		return lines.join('\n');
	} catch (error) {
		return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
	}
};

// ============================================================================
// Tool Definition
// ============================================================================

const gitAddCoreTool = tool({
	description:
		'Stage files for commit. Use files array for specific files, all=true for all changes including untracked, or update=true for only tracked files.',
	inputSchema: jsonSchema<GitAddInput>({
		type: 'object',
		properties: {
			files: {
				type: 'array',
				items: {type: 'string'},
				description: 'Specific files or patterns to stage',
			},
			all: {
				type: 'boolean',
				description: 'Stage all changes including untracked files (-A)',
			},
			update: {
				type: 'boolean',
				description: 'Stage only already tracked files (-u)',
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
		return await executeGitAdd(args);
	},
});

// ============================================================================
// Formatter
// ============================================================================

function GitAddFormatter({
	args,
	result,
}: {
	args: GitAddInput;
	result?: string;
}): React.ReactElement {
	const {colors} = useTheme();

	// Parse result for display
	let fileCount = 0;
	let additions = 0;
	let deletions = 0;

	if (result) {
		const countMatch = result.match(/Staged (\d+) file/);
		if (countMatch) fileCount = parseInt(countMatch[1], 10);

		const statsMatch = result.match(/\(\+(\d+), -(\d+)\)/);
		if (statsMatch) {
			additions = parseInt(statsMatch[1], 10);
			deletions = parseInt(statsMatch[2], 10);
		}
	}

	// Determine mode
	let mode = 'all';
	if (args.files && args.files.length > 0) {
		mode = `${args.files.length} specific file(s)`;
	} else if (args.update) {
		mode = 'tracked files only';
	}

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={colors.tool}>⚒ git_add</Text>

			<Box>
				<Text color={colors.secondary}>Mode: </Text>
				<Text color={colors.text}>{mode}</Text>
			</Box>

			{fileCount > 0 && (
				<Box>
					<Text color={colors.secondary}>Staging: </Text>
					<Text color={colors.text}>{fileCount} files </Text>
					<Text color={colors.success}>(+{additions}</Text>
					<Text color={colors.text}>, </Text>
					<Text color={colors.error}>-{deletions}</Text>
					<Text color={colors.text}>)</Text>
				</Box>
			)}

			{result?.includes('No changes') && (
				<Box>
					<Text color={colors.warning}>No changes to stage</Text>
				</Box>
			)}
		</Box>
	);
}

const formatter = (args: GitAddInput, result?: string): React.ReactElement => {
	return <GitAddFormatter args={args} result={result} />;
};

// ============================================================================
// Export
// ============================================================================

export const gitAddTool: NanocoderToolExport = {
	name: 'git_add' as const,
	tool: gitAddCoreTool,
	formatter,
};
