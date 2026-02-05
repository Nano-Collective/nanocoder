/**
 * Git Branch Tool
 *
 * Branch management: list, create, switch, delete.
 */

import {Box, Text} from 'ink';
import React from 'react';

import {getCurrentMode} from '@/context/mode-context';
import {useTheme} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {
	branchExists,
	execGit,
	getCurrentBranch,
	getLocalBranches,
	getRemoteBranches,
	hasUncommittedChanges,
} from './utils';

// ============================================================================
// Types
// ============================================================================

interface GitBranchInput {
	list?: boolean;
	all?: boolean;
	create?: string;
	from?: string;
	switch?: string;
	delete?: string;
	force?: boolean;
}

// ============================================================================
// Execution
// ============================================================================

const executeGitBranch = async (args: GitBranchInput): Promise<string> => {
	try {
		// Determine action
		const action = args.create
			? 'create'
			: args.switch
				? 'switch'
				: args.delete
					? 'delete'
					: 'list';

		// LIST
		if (action === 'list') {
			const local = await getLocalBranches();
			const current = await getCurrentBranch();

			const lines: string[] = [];
			lines.push(`Current branch: ${current}`);
			lines.push('');
			lines.push(`Local branches (${local.length}):`);

			for (const branch of local) {
				const marker = branch.current ? '* ' : '  ';
				let info = branch.name;
				if (branch.upstream) {
					const sync: string[] = [];
					if (branch.ahead > 0) sync.push(`${branch.ahead} ahead`);
					if (branch.behind > 0) sync.push(`${branch.behind} behind`);
					if (sync.length > 0) {
						info += ` [${branch.upstream}: ${sync.join(', ')}]`;
					} else {
						info += ` [${branch.upstream}]`;
					}
				}
				lines.push(`${marker}${info}`);
			}

			if (args.all) {
				const remote = await getRemoteBranches();
				lines.push('');
				lines.push(`Remote branches (${remote.length}):`);
				for (const branch of remote.slice(0, 20)) {
					lines.push(`  ${branch}`);
				}
				if (remote.length > 20) {
					lines.push(`  ... and ${remote.length - 20} more`);
				}
			}

			return lines.join('\n');
		}

		// CREATE
		if (action === 'create' && args.create) {
			const name = args.create;

			// Check if branch already exists
			const exists = await branchExists(name);
			if (exists) {
				return `Error: Branch '${name}' already exists.`;
			}

			// Create and switch to the new branch
			const gitArgs = ['checkout', '-b', name];
			if (args.from) {
				gitArgs.push(args.from);
			}

			await execGit(gitArgs);

			const lines: string[] = [];
			lines.push(`Created and switched to branch '${name}'`);
			if (args.from) {
				lines.push(`Based on: ${args.from}`);
			}

			return lines.join('\n');
		}

		// SWITCH
		if (action === 'switch' && args.switch) {
			const name = args.switch;

			// Check if branch exists
			const exists = await branchExists(name);
			if (!exists) {
				// Check if it's a remote branch we can track
				const remote = await getRemoteBranches();
				const remoteBranch = remote.find(
					r => r === `origin/${name}` || r.endsWith(`/${name}`),
				);
				if (remoteBranch) {
					// Create tracking branch
					await execGit(['checkout', '-b', name, '--track', remoteBranch]);
					return `Switched to new branch '${name}' tracking '${remoteBranch}'`;
				}
				return `Error: Branch '${name}' does not exist.`;
			}

			// Check for uncommitted changes
			const hasChanges = await hasUncommittedChanges();
			if (hasChanges && !args.force) {
				return 'Error: You have uncommitted changes. Commit, stash, or use force=true to discard them.';
			}

			const gitArgs = ['checkout'];
			if (args.force) {
				gitArgs.push('-f');
			}
			gitArgs.push(name);

			await execGit(gitArgs);

			return `Switched to branch '${name}'`;
		}

		// DELETE
		if (action === 'delete' && args.delete) {
			const name = args.delete;
			const current = await getCurrentBranch();

			// Can't delete current branch
			if (name === current) {
				return `Error: Cannot delete the currently checked out branch '${name}'.`;
			}

			// Check if branch exists
			const exists = await branchExists(name);
			if (!exists) {
				return `Error: Branch '${name}' does not exist.`;
			}

			const gitArgs = ['branch'];
			if (args.force) {
				gitArgs.push('-D');
			} else {
				gitArgs.push('-d');
			}
			gitArgs.push(name);

			try {
				await execGit(gitArgs);
				return `Deleted branch '${name}'`;
			} catch (error) {
				const message = error instanceof Error ? error.message : '';
				if (message.includes('not fully merged')) {
					return `Error: Branch '${name}' is not fully merged. Use force=true to delete anyway (you will lose commits).`;
				}
				throw error;
			}
		}

		return 'Error: No valid action specified.';
	} catch (error) {
		return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
	}
};

// ============================================================================
// Tool Definition
// ============================================================================

const gitBranchCoreTool = tool({
	description:
		'Manage git branches. List branches (default), create new branch, switch to branch, or delete branch.',
	inputSchema: jsonSchema<GitBranchInput>({
		type: 'object',
		properties: {
			list: {
				type: 'boolean',
				description: 'List branches (default action)',
			},
			all: {
				type: 'boolean',
				description: 'Include remote branches in list',
			},
			create: {
				type: 'string',
				description: 'Create a new branch with this name and switch to it',
			},
			from: {
				type: 'string',
				description: 'Base branch/commit for new branch (default: HEAD)',
			},
			switch: {
				type: 'string',
				description: 'Switch to this branch',
			},
			delete: {
				type: 'string',
				description: 'Delete this branch',
			},
			force: {
				type: 'boolean',
				description:
					'Force operation (discard changes on switch, delete unmerged on delete)',
			},
		},
		required: [],
	}),
	// Approval varies by action
	needsApproval: (args: GitBranchInput) => {
		const mode = getCurrentMode();

		// AUTO for list
		if (!args.create && !args.switch && !args.delete) {
			return false;
		}

		// ALWAYS_APPROVE for force delete
		if (args.delete && args.force) {
			return true;
		}

		// STANDARD for create, switch, normal delete
		return mode === 'normal';
	},
	execute: async (args, _options) => {
		return await executeGitBranch(args);
	},
});

// ============================================================================
// Formatter
// ============================================================================

function GitBranchFormatter({
	args,
	result,
}: {
	args: GitBranchInput;
	result?: string;
}): React.ReactElement {
	const {colors} = useTheme();

	// Determine action
	const action = args.create
		? 'create'
		: args.switch
			? 'switch'
			: args.delete
				? 'delete'
				: 'list';

	// Parse result for list
	let currentBranch = '';
	let localCount = 0;
	let remoteCount = 0;

	if (result && action === 'list') {
		const currentMatch = result.match(/Current branch: (.+)/);
		if (currentMatch) currentBranch = currentMatch[1];

		const localMatch = result.match(/Local branches \((\d+)\)/);
		if (localMatch) localCount = parseInt(localMatch[1], 10);

		const remoteMatch = result.match(/Remote branches \((\d+)\)/);
		if (remoteMatch) remoteCount = parseInt(remoteMatch[1], 10);
	}

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={colors.tool}>⚒ git_branch</Text>

			<Box>
				<Text color={colors.secondary}>Action: </Text>
				<Text color={colors.text}>{action}</Text>
			</Box>

			{action === 'list' && (
				<>
					{currentBranch && (
						<Box>
							<Text color={colors.secondary}>Current: </Text>
							<Text color={colors.primary}>{currentBranch}</Text>
						</Box>
					)}
					{localCount > 0 && (
						<Box>
							<Text color={colors.secondary}>Local: </Text>
							<Text color={colors.text}>{localCount} branches</Text>
						</Box>
					)}
					{remoteCount > 0 && (
						<Box>
							<Text color={colors.secondary}>Remote: </Text>
							<Text color={colors.text}>{remoteCount} branches</Text>
						</Box>
					)}
				</>
			)}

			{action === 'create' && (
				<>
					<Box>
						<Text color={colors.secondary}>Name: </Text>
						<Text color={colors.primary}>{args.create}</Text>
					</Box>
					{args.from && (
						<Box>
							<Text color={colors.secondary}>From: </Text>
							<Text color={colors.text}>{args.from}</Text>
						</Box>
					)}
				</>
			)}

			{action === 'switch' && (
				<Box>
					<Text color={colors.secondary}>Target: </Text>
					<Text color={colors.primary}>{args.switch}</Text>
				</Box>
			)}

			{action === 'delete' && (
				<>
					{args.force && (
						<Box>
							<Text color={colors.error}>
								⚠️ FORCE DELETE - May lose unmerged commits!
							</Text>
						</Box>
					)}
					<Box>
						<Text color={colors.secondary}>Branch: </Text>
						<Text color={colors.warning}>{args.delete}</Text>
					</Box>
				</>
			)}

			{result?.includes('Switched to') && (
				<Box marginTop={1}>
					<Text color={colors.success}>✓ Switch completed</Text>
				</Box>
			)}

			{result?.includes('Created and switched') && (
				<Box marginTop={1}>
					<Text color={colors.success}>✓ Branch created</Text>
				</Box>
			)}

			{result?.includes('Deleted branch') && (
				<Box marginTop={1}>
					<Text color={colors.success}>✓ Branch deleted</Text>
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

const formatter = (
	args: GitBranchInput,
	result?: string,
): React.ReactElement => {
	return <GitBranchFormatter args={args} result={result} />;
};

// ============================================================================
// Export
// ============================================================================

export const gitBranchTool: NanocoderToolExport = {
	name: 'git_branch' as const,
	tool: gitBranchCoreTool,
	formatter,
};
