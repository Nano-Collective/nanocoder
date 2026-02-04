/**
 * Git Status Tool
 *
 * Shows repository status including branch, changes, and sync state.
 */

import {Box, Text} from 'ink';
import React from 'react';

import {useTheme} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {
	execGit,
	type FileChange,
	formatStatusChar,
	getAheadBehind,
	getCurrentBranch,
	getDiffStats,
	getStashCount,
	getUpstreamBranch,
	isMergeInProgress,
	isRebaseInProgress,
	parseGitStatus,
} from './utils';

// ============================================================================
// Types
// ============================================================================

interface GitStatusInput {
	// No parameters - always shows full status
}

interface GitStatusResult {
	branch: string;
	upstream: string | null;
	ahead: number;
	behind: number;
	staged: FileChange[];
	unstaged: FileChange[];
	untracked: string[];
	conflicts: string[];
	stashCount: number;
	isRebase: boolean;
	isMerge: boolean;
	totalAdditions: number;
	totalDeletions: number;
}

// ============================================================================
// Execution
// ============================================================================

async function getStatus(): Promise<GitStatusResult> {
	// Get branch info
	const branch = await getCurrentBranch();
	const upstream = await getUpstreamBranch();
	const {ahead, behind} = await getAheadBehind();

	// Get status
	const statusOutput = await execGit(['status', '--porcelain']);
	const {staged, unstaged, untracked, conflicts} = parseGitStatus(statusOutput);

	// Get diff stats for staged files
	const stagedStats = await getDiffStats(true);
	for (const file of staged) {
		const stats = stagedStats.get(file.path);
		if (stats) {
			file.additions = stats.additions;
			file.deletions = stats.deletions;
		}
	}

	// Get diff stats for unstaged files
	const unstagedStats = await getDiffStats(false);
	for (const file of unstaged) {
		const stats = unstagedStats.get(file.path);
		if (stats) {
			file.additions = stats.additions;
			file.deletions = stats.deletions;
		}
	}

	// Calculate totals
	const totalAdditions =
		staged.reduce((sum, f) => sum + f.additions, 0) +
		unstaged.reduce((sum, f) => sum + f.additions, 0);
	const totalDeletions =
		staged.reduce((sum, f) => sum + f.deletions, 0) +
		unstaged.reduce((sum, f) => sum + f.deletions, 0);

	// Get additional state
	const stashCount = await getStashCount();
	const isRebase = await isRebaseInProgress();
	const isMerge = await isMergeInProgress();

	return {
		branch,
		upstream,
		ahead,
		behind,
		staged,
		unstaged,
		untracked,
		conflicts,
		stashCount,
		isRebase,
		isMerge,
		totalAdditions,
		totalDeletions,
	};
}

const executeGitStatus = async (_args: GitStatusInput): Promise<string> => {
	try {
		const status = await getStatus();
		const lines: string[] = [];

		// Branch info
		lines.push(`Branch: ${status.branch}`);
		if (status.upstream) {
			lines.push(`Upstream: ${status.upstream}`);
			if (status.ahead > 0 || status.behind > 0) {
				const parts: string[] = [];
				if (status.ahead > 0) parts.push(`${status.ahead} ahead`);
				if (status.behind > 0) parts.push(`${status.behind} behind`);
				lines.push(`Sync: ${parts.join(', ')}`);
			}
		} else {
			lines.push('Upstream: not set');
		}
		lines.push('');

		// Special states
		if (status.isRebase) {
			lines.push('STATE: Rebase in progress');
			lines.push('');
		}
		if (status.isMerge) {
			lines.push('STATE: Merge in progress');
			lines.push('');
		}

		// Conflicts
		if (status.conflicts.length > 0) {
			lines.push(`CONFLICTS (${status.conflicts.length}):`);
			for (const file of status.conflicts.slice(0, 10)) {
				lines.push(`  UU ${file}`);
			}
			if (status.conflicts.length > 10) {
				lines.push(`  ... and ${status.conflicts.length - 10} more`);
			}
			lines.push('');
		}

		// Staged changes
		if (status.staged.length > 0) {
			const stagedAdd = status.staged.reduce((s, f) => s + f.additions, 0);
			const stagedDel = status.staged.reduce((s, f) => s + f.deletions, 0);
			lines.push(
				`Staged (${status.staged.length} files, +${stagedAdd}, -${stagedDel}):`,
			);
			for (const file of status.staged.slice(0, 10)) {
				const char = formatStatusChar(file.status);
				lines.push(`  ${char}  ${file.path}`);
			}
			if (status.staged.length > 10) {
				lines.push(`  ... and ${status.staged.length - 10} more`);
			}
			lines.push('');
		}

		// Unstaged changes
		if (status.unstaged.length > 0) {
			const unstagedAdd = status.unstaged.reduce((s, f) => s + f.additions, 0);
			const unstagedDel = status.unstaged.reduce((s, f) => s + f.deletions, 0);
			lines.push(
				`Modified (${status.unstaged.length} files, +${unstagedAdd}, -${unstagedDel}):`,
			);
			for (const file of status.unstaged.slice(0, 10)) {
				const char = formatStatusChar(file.status);
				lines.push(`  ${char}  ${file.path}`);
			}
			if (status.unstaged.length > 10) {
				lines.push(`  ... and ${status.unstaged.length - 10} more`);
			}
			lines.push('');
		}

		// Untracked files
		if (status.untracked.length > 0) {
			lines.push(`Untracked (${status.untracked.length} files):`);
			for (const file of status.untracked.slice(0, 10)) {
				lines.push(`  ?  ${file}`);
			}
			if (status.untracked.length > 10) {
				lines.push(`  ... and ${status.untracked.length - 10} more`);
			}
			lines.push('');
		}

		// Stash
		if (status.stashCount > 0) {
			lines.push(`Stash: ${status.stashCount} stashed change(s)`);
			lines.push('');
		}

		// Clean state
		if (
			status.staged.length === 0 &&
			status.unstaged.length === 0 &&
			status.untracked.length === 0 &&
			status.conflicts.length === 0
		) {
			lines.push('Working tree clean');
		}

		return lines.join('\n');
	} catch (error) {
		return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
	}
};

// ============================================================================
// Tool Definition
// ============================================================================

const gitStatusCoreTool = tool({
	description:
		'Show git repository status including branch, staged/unstaged changes, and sync state with remote.',
	inputSchema: jsonSchema<GitStatusInput>({
		type: 'object',
		properties: {},
		required: [],
	}),
	// AUTO - read-only operation, never needs approval
	needsApproval: () => false,
	execute: async (args, _options) => {
		return await executeGitStatus(args);
	},
});

// ============================================================================
// Formatter
// ============================================================================

function GitStatusFormatter({result}: {result?: string}): React.ReactElement {
	const {colors} = useTheme();

	// Parse result for display
	let branch = '';
	let ahead = 0;
	let behind = 0;
	let stagedCount = 0;
	let modifiedCount = 0;
	let untrackedCount = 0;
	let hasConflicts = false;

	if (result) {
		const branchMatch = result.match(/Branch: (.+)/);
		if (branchMatch) branch = branchMatch[1];

		const syncMatch = result.match(/Sync: (.+)/);
		if (syncMatch) {
			const aheadMatch = syncMatch[1].match(/(\d+) ahead/);
			const behindMatch = syncMatch[1].match(/(\d+) behind/);
			if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
			if (behindMatch) behind = parseInt(behindMatch[1], 10);
		}

		const stagedMatch = result.match(/Staged \((\d+) files/);
		if (stagedMatch) stagedCount = parseInt(stagedMatch[1], 10);

		const modifiedMatch = result.match(/Modified \((\d+) files/);
		if (modifiedMatch) modifiedCount = parseInt(modifiedMatch[1], 10);

		const untrackedMatch = result.match(/Untracked \((\d+) files/);
		if (untrackedMatch) untrackedCount = parseInt(untrackedMatch[1], 10);

		hasConflicts = result.includes('CONFLICTS');
	}

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={colors.tool}>⚒ git_status</Text>

			{branch && (
				<Box>
					<Text color={colors.secondary}>Branch: </Text>
					<Text color={colors.primary}>{branch}</Text>
				</Box>
			)}

			{(ahead > 0 || behind > 0) && (
				<Box>
					<Text color={colors.secondary}>Sync: </Text>
					{ahead > 0 && <Text color={colors.success}>{ahead} ahead</Text>}
					{ahead > 0 && behind > 0 && <Text color={colors.secondary}>, </Text>}
					{behind > 0 && <Text color={colors.warning}>{behind} behind</Text>}
				</Box>
			)}

			{hasConflicts && (
				<Box>
					<Text color={colors.error}>Conflicts detected!</Text>
				</Box>
			)}

			{(stagedCount > 0 || modifiedCount > 0 || untrackedCount > 0) && (
				<Box>
					<Text color={colors.secondary}>Changes: </Text>
					{stagedCount > 0 && (
						<Text color={colors.success}>{stagedCount} staged</Text>
					)}
					{stagedCount > 0 && (modifiedCount > 0 || untrackedCount > 0) && (
						<Text color={colors.secondary}>, </Text>
					)}
					{modifiedCount > 0 && (
						<Text color={colors.warning}>{modifiedCount} modified</Text>
					)}
					{modifiedCount > 0 && untrackedCount > 0 && (
						<Text color={colors.secondary}>, </Text>
					)}
					{untrackedCount > 0 && (
						<Text color={colors.text}>{untrackedCount} untracked</Text>
					)}
				</Box>
			)}

			{stagedCount === 0 &&
				modifiedCount === 0 &&
				untrackedCount === 0 &&
				!hasConflicts &&
				branch && (
					<Box>
						<Text color={colors.success}>Working tree clean</Text>
					</Box>
				)}
		</Box>
	);
}

const formatter = (
	_args: GitStatusInput,
	result?: string,
): React.ReactElement => {
	return <GitStatusFormatter result={result} />;
};

// ============================================================================
// Export
// ============================================================================

export const gitStatusTool: NanocoderToolExport = {
	name: 'git_status' as const,
	tool: gitStatusCoreTool,
	formatter,
};
