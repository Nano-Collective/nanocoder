/**
 * Git Status Enhanced Tool
 *
 * Provides an enhanced view of the git repository status with
 * categorized changes, stash information, and action suggestions.
 */

import {Box, Text} from 'ink';
import React from 'react';
import ToolMessage from '@/components/tool-message';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import type {EnhancedStatusInput} from './types';
import {execGit, getEnhancedStatus, isGitRepository} from './utils';

/**
 * Get stash list
 */
async function getStashList(): Promise<
	Array<{index: number; message: string}>
> {
	try {
		const stashList = await execGit(['stash', 'list']);
		if (!stashList.trim()) {
			return [];
		}

		return stashList.split('\n').map((line, index) => {
			// Format: stash@{0}: WIP on branch: message
			const match = line.match(/stash@\{(\d+)\}:\s*(.+)/);
			return {
				index: match ? parseInt(match[1], 10) : index,
				message: match ? match[2] : line,
			};
		});
	} catch {
		return [];
	}
}

/**
 * Get recent commit log
 */
async function getRecentCommits(
	count: number = 5,
): Promise<Array<{hash: string; subject: string; date: string}>> {
	try {
		const log = await execGit([
			'log',
			`-n`,
			count.toString(),
			'--format=%h|%s|%cr',
		]);

		if (!log.trim()) {
			return [];
		}

		return log.split('\n').map(line => {
			const [hash, subject, date] = line.split('|');
			return {hash: hash || '', subject: subject || '', date: date || ''};
		});
	} catch {
		return [];
	}
}

/**
 * Generate action suggestions based on status
 */
function generateSuggestions(
	status: Awaited<ReturnType<typeof getEnhancedStatus>>,
	hasStash: boolean,
): string[] {
	const suggestions: string[] = [];

	// Conflict resolution
	if (status.hasConflicts) {
		suggestions.push('Resolve conflicts before proceeding');
		suggestions.push('  git status  # See conflicting files');
		suggestions.push('  git diff    # Review conflicts');
	}

	// Staged changes
	if (status.staged.length > 0) {
		suggestions.push('You have staged changes ready to commit');
		suggestions.push('  git commit -m "message"  # Create commit');
		suggestions.push('  git reset HEAD <file>    # Unstage file');
	}

	// Unstaged changes
	if (status.unstaged.length > 0) {
		suggestions.push('You have unstaged modifications');
		suggestions.push('  git add <file>  # Stage specific file');
		suggestions.push('  git add -A      # Stage all changes');
		suggestions.push('  git checkout -- <file>  # Discard changes');
	}

	// Untracked files
	if (status.untracked.length > 0) {
		suggestions.push(`You have ${status.untracked.length} untracked file(s)`);
		suggestions.push('  git add <file>  # Start tracking');
		suggestions.push('  # Or add to .gitignore if not needed');
	}

	// Sync status
	if (status.behind > 0) {
		suggestions.push(
			`Your branch is ${status.behind} commit(s) behind upstream`,
		);
		suggestions.push('  git pull        # Fetch and merge upstream');
		suggestions.push('  git pull --rebase  # Fetch and rebase');
	}

	if (status.ahead > 0) {
		suggestions.push(`Your branch is ${status.ahead} commit(s) ahead`);
		suggestions.push('  git push  # Push to remote');
	}

	// Stash
	if (hasStash) {
		suggestions.push('You have stashed changes');
		suggestions.push('  git stash pop   # Apply and remove latest stash');
		suggestions.push('  git stash list  # View all stashes');
	}

	// Clean state
	if (
		status.staged.length === 0 &&
		status.unstaged.length === 0 &&
		status.untracked.length === 0 &&
		!status.hasConflicts
	) {
		suggestions.push('Working tree is clean');
		suggestions.push('  Ready to start new work or push existing commits');
	}

	return suggestions;
}

/**
 * Execute the git_status_enhanced tool
 */
const executeGitStatusEnhanced = async (
	args: EnhancedStatusInput,
): Promise<string> => {
	// Check if we're in a git repository
	if (!(await isGitRepository())) {
		return 'Error: Not a git repository. Please run this command from within a git repository.';
	}

	// Get enhanced status
	const status = await getEnhancedStatus();

	// Get optional data
	const stashList = args.showStash ? await getStashList() : [];
	const recentCommits = args.detailed ? await getRecentCommits(5) : [];

	// Build response
	const responseLines: string[] = [];
	responseLines.push('=== Git Status ===');
	responseLines.push('');

	// Branch info
	responseLines.push(`Branch: ${status.branch}`);
	if (status.upstream) {
		responseLines.push(`Upstream: ${status.upstream}`);
		if (status.ahead > 0 || status.behind > 0) {
			const parts: string[] = [];
			if (status.ahead > 0) parts.push(`${status.ahead} ahead`);
			if (status.behind > 0) parts.push(`${status.behind} behind`);
			responseLines.push(`Sync: ${parts.join(', ')}`);
		}
	} else {
		responseLines.push('Upstream: Not configured');
	}
	responseLines.push('');

	// Summary
	responseLines.push(`Summary: ${status.summary}`);
	responseLines.push('');

	// Conflicts
	if (status.hasConflicts) {
		responseLines.push('!!! CONFLICTS !!!');
		for (const conflict of status.conflicts) {
			responseLines.push(`  UU ${conflict}`);
		}
		responseLines.push('');
	}

	// Staged changes
	if (status.staged.length > 0) {
		responseLines.push('--- Staged Changes ---');
		for (const file of status.staged) {
			const indicator = file.status[0].toUpperCase();
			responseLines.push(`  ${indicator}  ${file.path}`);
		}
		responseLines.push('');
	}

	// Unstaged changes
	if (status.unstaged.length > 0) {
		responseLines.push('--- Unstaged Changes ---');
		for (const file of status.unstaged) {
			const indicator = file.status[0].toUpperCase();
			responseLines.push(`  ${indicator}  ${file.path}`);
		}
		responseLines.push('');
	}

	// Untracked files
	if (status.untracked.length > 0) {
		responseLines.push('--- Untracked Files ---');
		for (const file of status.untracked.slice(0, 10)) {
			responseLines.push(`  ?  ${file}`);
		}
		if (status.untracked.length > 10) {
			responseLines.push(`  ... and ${status.untracked.length - 10} more`);
		}
		responseLines.push('');
	}

	// Stash (if requested)
	if (args.showStash && stashList.length > 0) {
		responseLines.push('--- Stash ---');
		for (const stash of stashList.slice(0, 5)) {
			responseLines.push(`  [${stash.index}] ${stash.message}`);
		}
		if (stashList.length > 5) {
			responseLines.push(`  ... and ${stashList.length - 5} more`);
		}
		responseLines.push('');
	}

	// Recent commits (if detailed)
	if (args.detailed && recentCommits.length > 0) {
		responseLines.push('--- Recent Commits ---');
		for (const commit of recentCommits) {
			responseLines.push(`  ${commit.hash} ${commit.subject} (${commit.date})`);
		}
		responseLines.push('');
	}

	// Suggestions
	const suggestions = generateSuggestions(status, stashList.length > 0);
	if (suggestions.length > 0) {
		responseLines.push('--- Suggestions ---');
		for (const suggestion of suggestions) {
			responseLines.push(suggestion);
		}
	}

	return responseLines.join('\n');
};

// AI SDK tool definition with execute function
const gitStatusEnhancedCoreTool = tool({
	description:
		'Get an enhanced view of git repository status with categorized changes, sync status, and action suggestions.',
	inputSchema: jsonSchema<EnhancedStatusInput>({
		type: 'object',
		properties: {
			detailed: {
				type: 'boolean',
				description:
					'If true, includes recent commits in the output. Default: false',
			},
			showStash: {
				type: 'boolean',
				description:
					'If true, includes stash list in the output. Default: false',
			},
		},
		required: [],
	}),
	execute: async (args, _options) => {
		return await executeGitStatusEnhanced(args);
	},
});

// Formatter component
const GitStatusEnhancedFormatter = React.memo(
	({args, result}: {args: EnhancedStatusInput; result?: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext is required');
		}
		const {colors} = themeContext;

		// Parse result for display
		let branch = '';
		let summary = '';
		let hasConflicts = false;

		if (result) {
			const branchMatch = result.match(/Branch: (.+)/);
			if (branchMatch) branch = branchMatch[1];

			const summaryMatch = result.match(/Summary: (.+)/);
			if (summaryMatch) summary = summaryMatch[1];

			hasConflicts = result.includes('!!! CONFLICTS !!!');
		}

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>git_status_enhanced</Text>

				{branch && (
					<Box>
						<Text color={colors.secondary}>Branch: </Text>
						<Text color={colors.primary}>{branch}</Text>
					</Box>
				)}

				{summary && (
					<Box>
						<Text color={colors.secondary}>Status: </Text>
						<Text color={hasConflicts ? colors.error : colors.white}>
							{summary}
						</Text>
					</Box>
				)}

				{hasConflicts && (
					<Box>
						<Text color={colors.error}>Conflicts detected!</Text>
					</Box>
				)}

				{args.detailed && (
					<Box>
						<Text color={colors.secondary}>Mode: </Text>
						<Text color={colors.white}>detailed</Text>
					</Box>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const formatter = (
	args: EnhancedStatusInput,
	result?: string,
): React.ReactElement => {
	return <GitStatusEnhancedFormatter args={args} result={result} />;
};

const validator = async (
	_args: EnhancedStatusInput,
): Promise<{valid: true} | {valid: false; error: string}> => {
	// Check if in git repository
	if (!(await isGitRepository())) {
		return {
			valid: false,
			error: 'git Not in a git repository',
		};
	}

	return {valid: true};
};

// Export the tool using NanocoderToolExport pattern
export const gitStatusEnhancedTool: NanocoderToolExport = {
	name: 'git_status_enhanced' as const,
	tool: gitStatusEnhancedCoreTool,
	formatter,
	validator,
};
