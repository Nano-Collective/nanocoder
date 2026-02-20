/**
 * Git Reset Tool
 *
 * Reset/undo operations: soft, mixed, hard.
 */

import {Box, Text} from 'ink';
import React from 'react';

import {getCurrentMode} from '@/context/mode-context';
import {useTheme} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {
	type CommitInfo,
	execGit,
	getCommits,
	getDiffStats,
	parseGitStatus,
} from './utils';

// ============================================================================
// Types
// ============================================================================

interface GitResetInput {
	mode: 'soft' | 'mixed' | 'hard';
	target?: string;
	file?: string;
}

// ============================================================================
// Preview
// ============================================================================

async function getResetPreview(args: GitResetInput): Promise<{
	commitsAffected: CommitInfo[];
	filesAffected: number;
	additions: number;
	deletions: number;
}> {
	const target = args.target || 'HEAD';

	// If resetting to HEAD, no commits affected
	if (target === 'HEAD' && !args.file) {
		// Just show currently staged changes
		const statusOutput = await execGit(['status', '--porcelain']);
		const {staged, unstaged} = parseGitStatus(statusOutput);

		const stagedStats = await getDiffStats(true);
		let additions = 0;
		let deletions = 0;
		for (const [, stats] of stagedStats) {
			additions += stats.additions;
			deletions += stats.deletions;
		}

		return {
			commitsAffected: [],
			filesAffected: staged.length + unstaged.length,
			additions,
			deletions,
		};
	}

	// Get commits between target and HEAD
	try {
		const commits = await getCommits({range: `${target}..HEAD`});

		// Get diff stats between target and HEAD
		const diffOutput = await execGit(['diff', '--numstat', target, 'HEAD']);
		let additions = 0;
		let deletions = 0;
		let filesAffected = 0;

		for (const line of diffOutput.split('\n')) {
			if (!line.trim()) continue;
			const parts = line.split('\t');
			if (parts.length >= 3) {
				additions += parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
				deletions += parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
				filesAffected++;
			}
		}

		return {commitsAffected: commits, filesAffected, additions, deletions};
	} catch {
		return {commitsAffected: [], filesAffected: 0, additions: 0, deletions: 0};
	}
}

// ============================================================================
// Execution
// ============================================================================

const executeGitReset = async (args: GitResetInput): Promise<string> => {
	try {
		const target = args.target || 'HEAD';

		// File-specific reset (ignores mode)
		if (args.file) {
			await execGit(['checkout', target, '--', args.file]);
			return `Reset '${args.file}' to ${target}`;
		}

		// Get preview for output
		const preview = await getResetPreview(args);

		// Build git command
		const gitArgs: string[] = ['reset', `--${args.mode}`, target];

		await execGit(gitArgs);

		const lines: string[] = [];
		lines.push(`Reset to ${target} (${args.mode})`);
		lines.push('');

		switch (args.mode) {
			case 'soft':
				lines.push('Changes kept in staging area.');
				break;
			case 'mixed':
				lines.push('Changes moved to working tree (unstaged).');
				break;
			case 'hard':
				lines.push('All changes discarded.');
				break;
		}

		if (preview.commitsAffected.length > 0) {
			lines.push('');
			lines.push(`Commits affected: ${preview.commitsAffected.length}`);
			for (const commit of preview.commitsAffected.slice(0, 5)) {
				lines.push(`  ${commit.shortHash} ${commit.subject}`);
			}
			if (preview.commitsAffected.length > 5) {
				lines.push(`  ... and ${preview.commitsAffected.length - 5} more`);
			}
		}

		if (preview.filesAffected > 0) {
			lines.push('');
			lines.push(
				`Files affected: ${preview.filesAffected} (+${preview.additions}, -${preview.deletions})`,
			);
		}

		return lines.join('\n');
	} catch (error) {
		return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
	}
};

// ============================================================================
// Tool Definition
// ============================================================================

const gitResetCoreTool = tool({
	description:
		'Reset repository state. soft=keep staged, mixed=unstage changes, hard=discard all changes (DANGEROUS).',
	inputSchema: jsonSchema<GitResetInput>({
		type: 'object',
		properties: {
			mode: {
				type: 'string',
				enum: ['soft', 'mixed', 'hard'],
				description:
					'Reset mode: soft (keep staged), mixed (unstage), hard (discard all)',
			},
			target: {
				type: 'string',
				description:
					'Target commit/ref to reset to (default: HEAD). Examples: HEAD~1, main, abc1234',
			},
			file: {
				type: 'string',
				description: 'Reset a specific file only (uses checkout)',
			},
		},
		required: ['mode'],
	}),
	// Approval varies by mode
	needsApproval: (args: GitResetInput) => {
		const mode = getCurrentMode();

		// ALWAYS_APPROVE for hard reset (permanent data loss)
		if (args.mode === 'hard') {
			return true;
		}

		// STANDARD for soft and mixed
		return mode === 'normal';
	},
	execute: async (args, _options) => {
		return await executeGitReset(args);
	},
});

// ============================================================================
// Formatter
// ============================================================================

function GitResetFormatter({
	args,
	result,
}: {
	args: GitResetInput;
	result?: string;
}): React.ReactElement {
	const {colors} = useTheme();
	const [preview, setPreview] = React.useState<{
		commitsAffected: CommitInfo[];
		filesAffected: number;
		additions: number;
		deletions: number;
	} | null>(null);

	// Load preview before execution
	React.useEffect(() => {
		if (!result) {
			getResetPreview(args)
				.then(setPreview)
				.catch(() => {});
		}
	}, [args, result]);

	const target = args.target || 'HEAD';

	// Mode descriptions
	const modeDescriptions = {
		soft: 'Keep changes staged',
		mixed: 'Unstage changes, keep in working tree',
		hard: 'Discard all changes permanently',
	};

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={colors.tool}>⚒ git_reset</Text>

			{args.mode === 'hard' && (
				<Box>
					<Text color={colors.error}>
						This will permanently discard uncommitted work!
					</Text>
				</Box>
			)}

			<Box>
				<Text color={colors.secondary}>Mode: </Text>
				<Text color={args.mode === 'hard' ? colors.error : colors.text}>
					{args.mode}
				</Text>
				<Text color={colors.secondary}> - {modeDescriptions[args.mode]}</Text>
			</Box>

			<Box>
				<Text color={colors.secondary}>Target: </Text>
				<Text color={colors.primary}>{target}</Text>
			</Box>

			{args.file && (
				<Box>
					<Text color={colors.secondary}>File: </Text>
					<Text color={colors.text}>{args.file}</Text>
				</Box>
			)}

			{preview && !args.file && (
				<>
					{preview.commitsAffected.length > 0 && (
						<Box>
							<Text color={colors.secondary}>Commits affected: </Text>
							<Text color={colors.warning}>
								{preview.commitsAffected.length}
							</Text>
						</Box>
					)}

					{preview.filesAffected > 0 && (
						<Box>
							<Text color={colors.secondary}>Files affected: </Text>
							<Text color={colors.text}>{preview.filesAffected} </Text>
							<Text color={colors.success}>(+{preview.additions}</Text>
							<Text color={colors.text}>, </Text>
							<Text color={colors.error}>-{preview.deletions}</Text>
							<Text color={colors.text}>)</Text>
						</Box>
					)}
				</>
			)}

			{result?.includes('Reset to') && (
				<Box marginTop={1}>
					<Text color={colors.success}>✓ Reset completed</Text>
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
	args: GitResetInput,
	result?: string,
): React.ReactElement => {
	return <GitResetFormatter args={args} result={result} />;
};

// ============================================================================
// Export
// ============================================================================

export const gitResetTool: NanocoderToolExport = {
	name: 'git_reset' as const,
	tool: gitResetCoreTool,
	formatter,
};
