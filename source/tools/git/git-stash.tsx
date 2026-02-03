/**
 * Git Stash Tool
 *
 * Stash management: push, pop, apply, list, drop, clear.
 */

import {Box, Text} from 'ink';
import React from 'react';

import {getCurrentMode} from '@/context/mode-context';
import {useTheme} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {
	execGit,
	getStashCount,
	getStashList,
	hasUncommittedChanges,
	type StashEntry,
} from './utils';

// ============================================================================
// Types
// ============================================================================

interface GitStashInput {
	push?: {
		message?: string;
		includeUntracked?: boolean;
	};
	pop?: {
		index?: number;
	};
	apply?: {
		index?: number;
	};
	list?: boolean;
	drop?: {
		index?: number;
	};
	clear?: boolean;
}

// ============================================================================
// Execution
// ============================================================================

const executeGitStash = async (args: GitStashInput): Promise<string> => {
	try {
		// Determine action
		const action = args.push
			? 'push'
			: args.pop
				? 'pop'
				: args.apply
					? 'apply'
					: args.drop
						? 'drop'
						: args.clear
							? 'clear'
							: 'list';

		// LIST
		if (action === 'list') {
			const stashes = await getStashList();

			if (stashes.length === 0) {
				return 'No stashes found.';
			}

			const lines: string[] = [];
			lines.push(`Stash list (${stashes.length}):`);
			lines.push('');

			for (const stash of stashes) {
				lines.push(`  [${stash.index}] ${stash.message}`);
				lines.push(`      Branch: ${stash.branch}, ${stash.date}`);
			}

			return lines.join('\n');
		}

		// PUSH
		if (action === 'push') {
			const hasChanges = await hasUncommittedChanges();
			if (!hasChanges) {
				return 'No local changes to stash.';
			}

			const gitArgs: string[] = ['stash', 'push'];

			if (args.push?.message) {
				gitArgs.push('-m', args.push.message);
			}

			if (args.push?.includeUntracked) {
				gitArgs.push('-u');
			}

			await execGit(gitArgs);

			const lines: string[] = [];
			lines.push('Changes stashed successfully.');
			if (args.push?.message) {
				lines.push(`Message: ${args.push.message}`);
			}

			return lines.join('\n');
		}

		// POP
		if (action === 'pop') {
			const count = await getStashCount();
			if (count === 0) {
				return 'No stashes to pop.';
			}

			const index = args.pop?.index ?? 0;
			if (index >= count) {
				return `Error: Stash index ${index} does not exist. Available: 0-${count - 1}`;
			}

			await execGit(['stash', 'pop', `stash@{${index}}`]);

			return `Applied and removed stash@{${index}}`;
		}

		// APPLY
		if (action === 'apply') {
			const count = await getStashCount();
			if (count === 0) {
				return 'No stashes to apply.';
			}

			const index = args.apply?.index ?? 0;
			if (index >= count) {
				return `Error: Stash index ${index} does not exist. Available: 0-${count - 1}`;
			}

			await execGit(['stash', 'apply', `stash@{${index}}`]);

			return `Applied stash@{${index}} (stash kept)`;
		}

		// DROP
		if (action === 'drop') {
			const count = await getStashCount();
			if (count === 0) {
				return 'No stashes to drop.';
			}

			const index = args.drop?.index ?? 0;
			if (index >= count) {
				return `Error: Stash index ${index} does not exist. Available: 0-${count - 1}`;
			}

			// Get stash info before dropping
			const stashes = await getStashList();
			const stash = stashes.find(s => s.index === index);

			await execGit(['stash', 'drop', `stash@{${index}}`]);

			const lines: string[] = [];
			lines.push(`Dropped stash@{${index}}`);
			if (stash) {
				lines.push(`Message: ${stash.message}`);
			}

			return lines.join('\n');
		}

		// CLEAR
		if (action === 'clear') {
			const count = await getStashCount();
			if (count === 0) {
				return 'No stashes to clear.';
			}

			await execGit(['stash', 'clear']);

			return `Cleared all ${count} stash(es).`;
		}

		return 'Error: No valid action specified.';
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';

		// Check for merge conflicts
		if (message.includes('CONFLICT') || message.includes('conflict')) {
			return `Error: Merge conflicts while applying stash. Resolve conflicts manually.\n\n${message}`;
		}

		return `Error: ${message}`;
	}
};

// ============================================================================
// Tool Definition
// ============================================================================

const gitStashCoreTool = tool({
	description:
		'Manage git stash. Push to save changes, pop/apply to restore, list to view, drop/clear to remove.',
	inputSchema: jsonSchema<GitStashInput>({
		type: 'object',
		properties: {
			push: {
				type: 'object',
				description: 'Stash current changes',
				properties: {
					message: {
						type: 'string',
						description: 'Optional message for the stash',
					},
					includeUntracked: {
						type: 'boolean',
						description: 'Include untracked files',
					},
				},
			},
			pop: {
				type: 'object',
				description: 'Apply and remove a stash',
				properties: {
					index: {
						type: 'number',
						description: 'Stash index (default: 0)',
					},
				},
			},
			apply: {
				type: 'object',
				description: 'Apply a stash without removing it',
				properties: {
					index: {
						type: 'number',
						description: 'Stash index (default: 0)',
					},
				},
			},
			list: {
				type: 'boolean',
				description: 'List all stashes',
			},
			drop: {
				type: 'object',
				description: 'Remove a specific stash',
				properties: {
					index: {
						type: 'number',
						description: 'Stash index (default: 0)',
					},
				},
			},
			clear: {
				type: 'boolean',
				description: 'Remove ALL stashes (use with caution!)',
			},
		},
		required: [],
	}),
	// Approval varies by action
	needsApproval: (args: GitStashInput) => {
		const mode = getCurrentMode();

		// AUTO for list
		if (
			args.list ||
			(!args.push && !args.pop && !args.apply && !args.drop && !args.clear)
		) {
			return false;
		}

		// ALWAYS_APPROVE for drop and clear (permanent data loss)
		if (args.drop || args.clear) {
			return true;
		}

		// STANDARD for push, pop, apply
		return mode === 'normal';
	},
	execute: async (args, _options) => {
		return await executeGitStash(args);
	},
});

// ============================================================================
// Formatter
// ============================================================================

function GitStashFormatter({
	args,
	result,
}: {
	args: GitStashInput;
	result?: string;
}): React.ReactElement {
	const {colors} = useTheme();
	const [preview, setPreview] = React.useState<{
		stashCount: number;
		stashes: StashEntry[];
	} | null>(null);

	// Determine action
	const action = args.push
		? 'push'
		: args.pop
			? 'pop'
			: args.apply
				? 'apply'
				: args.drop
					? 'drop'
					: args.clear
						? 'clear'
						: 'list';

	// Load preview before execution
	React.useEffect(() => {
		if (!result) {
			(async () => {
				const stashCount = await getStashCount();
				const stashes = await getStashList();
				setPreview({stashCount, stashes});
			})().catch(() => {});
		}
	}, [result]);

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={colors.tool}>⚒ git_stash</Text>

			<Box>
				<Text color={colors.secondary}>Action: </Text>
				<Text color={colors.text}>{action}</Text>
			</Box>

			{action === 'clear' && (
				<Box>
					<Text color={colors.error}>
						⚠️ This will permanently delete all {preview?.stashCount || 0}{' '}
						stashes!
					</Text>
				</Box>
			)}

			{action === 'drop' && (
				<Box>
					<Text color={colors.warning}>
						⚠️ This will permanently delete stash@{'{'}
						{args.drop?.index ?? 0}
						{'}'}
					</Text>
				</Box>
			)}

			{action === 'push' && args.push?.message && (
				<Box>
					<Text color={colors.secondary}>Message: </Text>
					<Text color={colors.text}>{args.push.message}</Text>
				</Box>
			)}

			{(action === 'pop' || action === 'apply') &&
				preview &&
				preview.stashCount > 0 && (
					<Box>
						<Text color={colors.secondary}>Stash: </Text>
						<Text color={colors.text}>
							{preview.stashes[args.pop?.index ?? args.apply?.index ?? 0]
								?.message ||
								`stash@{${args.pop?.index ?? args.apply?.index ?? 0}}`}
						</Text>
					</Box>
				)}

			{action === 'list' && preview && (
				<Box>
					<Text color={colors.secondary}>Count: </Text>
					<Text color={colors.text}>{preview.stashCount} stashes</Text>
				</Box>
			)}

			{result?.includes('stashed successfully') && (
				<Box>
					<Text color={colors.success}>Changes stashed</Text>
				</Box>
			)}

			{result?.includes('Applied') && (
				<Box>
					<Text color={colors.success}>Stash applied</Text>
				</Box>
			)}

			{result?.includes('Dropped') && (
				<Box>
					<Text color={colors.success}>Stash dropped</Text>
				</Box>
			)}

			{result?.includes('Cleared all') && (
				<Box>
					<Text color={colors.success}>All stashes cleared</Text>
				</Box>
			)}

			{result?.includes('CONFLICT') && (
				<Box>
					<Text color={colors.error}>Merge conflicts detected!</Text>
				</Box>
			)}

			{result?.includes('Error:') && !result.includes('CONFLICT') && (
				<Box>
					<Text color={colors.error}>{result}</Text>
				</Box>
			)}
		</Box>
	);
}

const formatter = (
	args: GitStashInput,
	result?: string,
): React.ReactElement => {
	return <GitStashFormatter args={args} result={result} />;
};

// ============================================================================
// Export
// ============================================================================

export const gitStashTool: NanocoderToolExport = {
	name: 'git_stash' as const,
	tool: gitStashCoreTool,
	formatter,
};
