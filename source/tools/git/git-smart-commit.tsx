/**
 * Git Smart Commit Tool
 *
 * Analyzes staged changes and generates conventional commit messages
 * following the Conventional Commits specification.
 */

import {Box, Text} from 'ink';
import React from 'react';
import ToolMessage from '@/components/tool-message';
import {getCurrentMode} from '@/context/mode-context';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import type {CommitType, GeneratedCommit, SmartCommitInput} from './types';
import {analyzeStagedChanges, execGit, isGitRepository} from './utils';

/**
 * Generate a conventional commit message from analysis
 */
function generateCommitMessage(
	analysis: Awaited<ReturnType<typeof analyzeStagedChanges>>,
	options: SmartCommitInput,
): GeneratedCommit {
	const {
		suggestedType,
		suggestedScope,
		files,
		isBreakingChange,
		breakingChangeReason,
	} = analysis;
	const type = suggestedType;
	const scope = options.customScope || suggestedScope;

	// Generate subject line
	const subject = generateSubject(type, files);

	// Generate body if requested
	let body: string | undefined;
	if (options.includeBody && files.length > 0) {
		body = generateBody(files);
	}

	// Generate footer for breaking changes
	let footer: string | undefined;
	if (isBreakingChange) {
		footer = `BREAKING CHANGE: ${breakingChangeReason || 'This commit introduces breaking changes'}`;
	}

	// Build full message
	const breakingIndicator = isBreakingChange ? '!' : '';
	const scopePart = scope ? `(${scope})` : '';
	const headerLine = `${type}${scopePart}${breakingIndicator}: ${subject}`;

	const parts = [headerLine];
	if (body) {
		parts.push('', body);
	}
	if (footer) {
		parts.push('', footer);
	}

	return {
		type,
		scope,
		subject,
		body,
		footer,
		isBreakingChange,
		fullMessage: parts.join('\n'),
	};
}

/**
 * Generate a subject line based on commit type and files
 */
function generateSubject(
	type: CommitType,
	files: Array<{path: string; status: string}>,
): string {
	// Extract meaningful file/component names
	const fileNames = files.map(f => {
		const parts = f.path.split('/');
		const fileName = parts[parts.length - 1];
		// Remove extension for cleaner names
		return fileName?.replace(/\.[^.]+$/, '') || '';
	});

	const uniqueNames = [...new Set(fileNames)].filter(Boolean).slice(0, 3);

	switch (type) {
		case 'feat':
			if (uniqueNames.length === 1) {
				return `add ${uniqueNames[0]} functionality`;
			}
			return `add new features to ${uniqueNames.join(', ')}`;

		case 'fix':
			if (uniqueNames.length === 1) {
				return `resolve issue in ${uniqueNames[0]}`;
			}
			return `fix issues in ${uniqueNames.join(', ')}`;

		case 'docs':
			if (uniqueNames.length === 1) {
				return `update ${uniqueNames[0]} documentation`;
			}
			return 'update documentation';

		case 'style':
			return 'improve code formatting and style';

		case 'refactor':
			if (uniqueNames.length === 1) {
				return `refactor ${uniqueNames[0]}`;
			}
			return `refactor ${uniqueNames.join(', ')}`;

		case 'perf':
			if (uniqueNames.length === 1) {
				return `improve ${uniqueNames[0]} performance`;
			}
			return 'improve performance';

		case 'test':
			if (uniqueNames.length === 1) {
				return `add tests for ${uniqueNames[0]}`;
			}
			return 'add and improve tests';

		case 'build':
			return 'update build configuration';

		case 'ci':
			return 'update CI/CD configuration';

		case 'chore':
			return 'perform maintenance tasks';

		case 'revert':
			return 'revert previous changes';

		default:
			return `update ${uniqueNames.join(', ') || 'files'}`;
	}
}

/**
 * Generate a commit body with file change details
 */
function generateBody(
	files: Array<{
		path: string;
		status: string;
		additions: number;
		deletions: number;
	}>,
): string {
	const lines: string[] = [];

	// Group by status
	const added = files.filter(f => f.status === 'added');
	const modified = files.filter(f => f.status === 'modified');
	const deleted = files.filter(f => f.status === 'deleted');
	const renamed = files.filter(f => f.status === 'renamed');

	if (added.length > 0) {
		lines.push(`Added: ${added.map(f => f.path).join(', ')}`);
	}
	if (modified.length > 0) {
		lines.push(`Modified: ${modified.map(f => f.path).join(', ')}`);
	}
	if (deleted.length > 0) {
		lines.push(`Deleted: ${deleted.map(f => f.path).join(', ')}`);
	}
	if (renamed.length > 0) {
		lines.push(`Renamed: ${renamed.map(f => f.path).join(', ')}`);
	}

	return lines.join('\n');
}

/**
 * Execute the git_smart_commit tool
 */
const executeGitSmartCommit = async (
	args: SmartCommitInput,
): Promise<string> => {
	// Check if we're in a git repository
	if (!(await isGitRepository())) {
		return 'Error: Not a git repository. Please run this command from within a git repository.';
	}

	// Analyze staged changes
	const analysis = await analyzeStagedChanges();

	if (analysis.totalFiles === 0) {
		return 'No staged changes found. Use `git add` to stage changes before generating a commit message.';
	}

	// Generate commit message
	const commit = generateCommitMessage(analysis, args);

	// Build response
	const responseLines: string[] = [];
	responseLines.push('=== Smart Commit Analysis ===');
	responseLines.push('');
	responseLines.push(`Files changed: ${analysis.totalFiles}`);
	responseLines.push(`Additions: +${analysis.totalAdditions}`);
	responseLines.push(`Deletions: -${analysis.totalDeletions}`);
	responseLines.push('');
	responseLines.push('Changed files:');
	for (const file of analysis.files.slice(0, 10)) {
		responseLines.push(`  ${file.status[0].toUpperCase()} ${file.path}`);
	}
	if (analysis.files.length > 10) {
		responseLines.push(`  ... and ${analysis.files.length - 10} more files`);
	}
	responseLines.push('');
	responseLines.push('=== Generated Commit Message ===');
	responseLines.push('');
	responseLines.push(commit.fullMessage);
	responseLines.push('');

	if (analysis.isBreakingChange) {
		responseLines.push('WARNING: This appears to be a breaking change!');
		if (analysis.breakingChangeReason) {
			responseLines.push(`Reason: ${analysis.breakingChangeReason}`);
		}
		responseLines.push('');
	}

	if (args.dryRun !== false) {
		// Default to dry run mode for safety (dryRun: true by default)
		responseLines.push('(Dry run - commit not created)');
		responseLines.push('');
		responseLines.push('To create this commit, run:');
		responseLines.push(
			`git commit -m "${commit.fullMessage.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
		);
	} else {
		// Actually create the commit
		try {
			await execGit(['commit', '-m', commit.fullMessage]);
			responseLines.push('Commit created successfully!');
		} catch (error) {
			responseLines.push(
				`Error creating commit: ${error instanceof Error ? error.message : 'Unknown error'}`,
			);
		}
	}

	return responseLines.join('\n');
};

// AI SDK tool definition with execute function
const gitSmartCommitCoreTool = tool({
	description:
		'Analyze staged git changes and generate a conventional commit message. Optionally creates the commit.',
	inputSchema: jsonSchema<SmartCommitInput>({
		type: 'object',
		properties: {
			dryRun: {
				type: 'boolean',
				description:
					'If true, only shows the generated commit message without creating the commit. Default: true',
			},
			includeBody: {
				type: 'boolean',
				description:
					'If true, includes a detailed body in the commit message. Default: true',
			},
			customScope: {
				type: 'string',
				description:
					'Optional custom scope to use instead of the auto-detected one (e.g., "auth", "api", "ui")',
			},
		},
		required: [],
	}),
	// Requires approval when actually creating commits (dryRun=false)
	needsApproval: (args: SmartCommitInput) => {
		const mode = getCurrentMode();
		// Only need approval when creating commit (dryRun explicitly false) and not in auto-accept mode
		return args.dryRun === false && mode !== 'auto-accept';
	},
	execute: async (args, _options) => {
		return await executeGitSmartCommit(args);
	},
});

// Formatter component
const GitSmartCommitFormatter = React.memo(
	({args, result}: {args: SmartCommitInput; result?: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext is required');
		}
		const {colors} = themeContext;

		// Parse result for display
		let filesChanged = 0;
		let commitType = '';
		let commitMessage = '';
		let isBreaking = false;

		if (result) {
			const filesMatch = result.match(/Files changed: (\d+)/);
			if (filesMatch) filesChanged = parseInt(filesMatch[1], 10);

			// Extract commit type from the generated message
			const typeMatch = result.match(
				/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)/m,
			);
			if (typeMatch) commitType = typeMatch[1];

			// Extract the full commit message (between === Generated Commit Message === and the next section)
			const messageMatch = result.match(
				/=== Generated Commit Message ===\n\n([\s\S]*?)(?:\n\n(?:WARNING:|$$Dry run|\(Dry run|To create|Commit created)|$)/,
			);
			if (messageMatch) {
				commitMessage = messageMatch[1].trim();
			}

			isBreaking =
				result.includes('BREAKING CHANGE') ||
				result.includes('breaking change');
		}

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>git_smart_commit</Text>

				<Box>
					<Text color={colors.secondary}>Mode: </Text>
					<Text color={colors.primary}>
						{args.dryRun !== false ? 'dry-run' : 'commit'}
					</Text>
				</Box>

				{result && (
					<>
						<Box>
							<Text color={colors.secondary}>Files: </Text>
							<Text color={colors.white}>{filesChanged}</Text>
						</Box>

						{commitType && (
							<Box>
								<Text color={colors.secondary}>Type: </Text>
								<Text color={colors.primary}>{commitType}</Text>
								{isBreaking && <Text color={colors.error}> (BREAKING)</Text>}
							</Box>
						)}

						{commitMessage && (
							<Box flexDirection="column" marginTop={1}>
								<Text color={colors.secondary}>Message:</Text>
								<Box marginLeft={2}>
									<Text color={colors.white}>{commitMessage}</Text>
								</Box>
							</Box>
						)}
					</>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const formatter = (
	args: SmartCommitInput,
	result?: string,
): React.ReactElement => {
	return <GitSmartCommitFormatter args={args} result={result} />;
};

const validator = async (
	_args: SmartCommitInput,
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
export const gitSmartCommitTool: NanocoderToolExport = {
	name: 'git_smart_commit' as const,
	tool: gitSmartCommitCoreTool,
	formatter,
	validator,
};
