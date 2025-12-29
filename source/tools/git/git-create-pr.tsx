/**
 * Git Create PR Tool
 *
 * Generates pull request templates with auto-generated descriptions,
 * test plans, and reviewer suggestions based on commit history.
 */

import {Box, Text} from 'ink';
import React from 'react';
import ToolMessage from '@/components/tool-message';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import type {CreatePRInput, PRTemplate} from './types';
import {
	execGit,
	getCommitsBetween,
	getCurrentBranch,
	getDefaultBranch,
	getSuggestedReviewers,
	isGitRepository,
} from './utils';

/**
 * Categorize commits by type
 */
function categorizeCommits(
	commits: Array<{hash: string; subject: string; body: string}>,
): Map<string, string[]> {
	const categories = new Map<string, string[]>();

	for (const commit of commits) {
		const subject = commit.subject;

		// Parse conventional commit format
		const match = subject.match(
			/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+?\))?(!)?:\s*(.+)/,
		);

		let category: string;
		let description: string;

		if (match) {
			category = match[1];
			description = match[4] || subject;
		} else {
			// Non-conventional commit
			category = 'other';
			description = subject;
		}

		if (!categories.has(category)) {
			categories.set(category, []);
		}
		categories.get(category)?.push(description);
	}

	return categories;
}

/**
 * Generate PR title from commits
 */
function generatePRTitle(
	commits: Array<{hash: string; subject: string; body: string}>,
	branch: string,
): string {
	if (commits.length === 0) {
		// Use branch name as fallback
		const branchParts = branch.split('/');
		const branchName = branchParts[branchParts.length - 1];
		return (
			branchName
				?.replace(/-/g, ' ')
				.replace(/_/g, ' ')
				.replace(/^\w/, c => c.toUpperCase()) || 'Update'
		);
	}

	if (commits.length === 1) {
		return commits[0].subject;
	}

	// Multiple commits - summarize
	const categories = categorizeCommits(commits);

	// Priority order for title
	const titlePriority = ['feat', 'fix', 'refactor', 'perf', 'other'];

	for (const category of titlePriority) {
		const items = categories.get(category);
		if (items && items.length > 0) {
			if (items.length === 1) {
				return items[0];
			}
			// Summarize multiple items
			const prefix =
				category === 'feat' ? 'Add' : category === 'fix' ? 'Fix' : 'Update';
			return `${prefix} ${items.length} ${category === 'feat' ? 'features' : 'changes'}`;
		}
	}

	return commits[0].subject;
}

/**
 * Generate PR summary from categorized commits
 */
function generateSummary(categories: Map<string, string[]>): string[] {
	const summary: string[] = [];

	const categoryLabels: Record<string, string> = {
		feat: 'New Features',
		fix: 'Bug Fixes',
		docs: 'Documentation',
		style: 'Style Changes',
		refactor: 'Code Refactoring',
		perf: 'Performance Improvements',
		test: 'Test Updates',
		build: 'Build Changes',
		ci: 'CI/CD Updates',
		chore: 'Maintenance',
		other: 'Other Changes',
	};

	for (const [category, items] of categories) {
		const label = categoryLabels[category] || 'Changes';
		summary.push(`**${label}:**`);
		for (const item of items) {
			summary.push(`- ${item}`);
		}
		summary.push('');
	}

	return summary;
}

/**
 * Generate test plan suggestions
 */
function generateTestPlan(
	categories: Map<string, string[]>,
	changedFiles: string[],
): string[] {
	const testPlan: string[] = [];

	// Check if there are new features
	if (categories.has('feat')) {
		testPlan.push('- [ ] Verify new functionality works as expected');
		testPlan.push('- [ ] Check for edge cases and error handling');
	}

	// Check if there are bug fixes
	if (categories.has('fix')) {
		testPlan.push('- [ ] Verify the bug is fixed');
		testPlan.push('- [ ] Ensure no regression in related functionality');
	}

	// Check for UI changes
	const hasUIChanges = changedFiles.some(
		f =>
			f.includes('component') ||
			f.endsWith('.tsx') ||
			f.endsWith('.css') ||
			f.endsWith('.scss'),
	);
	if (hasUIChanges) {
		testPlan.push('- [ ] Visual inspection of UI changes');
		testPlan.push('- [ ] Test responsive behavior');
	}

	// Check for API changes
	const hasAPIChanges = changedFiles.some(
		f => f.includes('api') || f.includes('route') || f.includes('endpoint'),
	);
	if (hasAPIChanges) {
		testPlan.push('- [ ] Test API endpoints');
		testPlan.push('- [ ] Verify request/response format');
	}

	// Generic tests
	testPlan.push('- [ ] Run existing test suite');
	testPlan.push('- [ ] Build succeeds without errors');

	return testPlan;
}

/**
 * Detect breaking changes from commits
 */
function detectBreakingChanges(
	commits: Array<{hash: string; subject: string; body: string}>,
): string[] {
	const breakingChanges: string[] = [];

	for (const commit of commits) {
		// Check for breaking change indicator
		if (commit.subject.includes('!:')) {
			const match = commit.subject.match(/!:\s*(.+)/);
			if (match) {
				breakingChanges.push(match[1]);
			}
		}

		// Check body for BREAKING CHANGE
		if (commit.body.includes('BREAKING CHANGE')) {
			const match = commit.body.match(/BREAKING CHANGE:\s*(.+)/);
			if (match) {
				breakingChanges.push(match[1]);
			}
		}
	}

	return breakingChanges;
}

/**
 * Generate suggested labels based on changes
 */
function suggestLabels(categories: Map<string, string[]>): string[] {
	const labels: string[] = [];

	if (categories.has('feat')) labels.push('enhancement');
	if (categories.has('fix')) labels.push('bug');
	if (categories.has('docs')) labels.push('documentation');
	if (categories.has('perf')) labels.push('performance');
	if (categories.has('test')) labels.push('testing');

	return labels;
}

/**
 * Generate the full PR template
 */
async function generatePRTemplate(
	targetBranch: string,
	includeSummary: boolean,
): Promise<PRTemplate> {
	const currentBranch = await getCurrentBranch();
	const commits = await getCommitsBetween(targetBranch);

	// Get changed files from diff
	let changedFiles: string[] = [];
	try {
		const diffFiles = await execGit([
			'diff',
			'--name-only',
			`${targetBranch}...HEAD`,
		]);
		changedFiles = diffFiles.split('\n').filter(f => f.trim());
	} catch {
		// May fail if target branch doesn't exist locally
	}

	const categories = categorizeCommits(commits);
	const title = generatePRTitle(commits, currentBranch);
	const summary = includeSummary ? generateSummary(categories) : [];
	const testPlan = generateTestPlan(categories, changedFiles);
	const breakingChanges = detectBreakingChanges(commits);
	const suggestedReviewers = await getSuggestedReviewers(
		changedFiles.map(f => ({
			path: f,
			status: 'modified' as const,
			additions: 0,
			deletions: 0,
			isBinary: false,
		})),
	);
	const labels = suggestLabels(categories);

	return {
		title,
		summary: summary.join('\n'),
		changes: Array.from(categories.entries()).flatMap(([cat, items]) =>
			items.map(item => `${cat}: ${item}`),
		),
		testPlan,
		breakingChanges: breakingChanges.length > 0 ? breakingChanges : undefined,
		suggestedReviewers:
			suggestedReviewers.length > 0 ? suggestedReviewers : undefined,
		labels: labels.length > 0 ? labels : undefined,
	};
}

/**
 * Execute the git_create_pr tool
 */
const executeGitCreatePR = async (args: CreatePRInput): Promise<string> => {
	// Check if we're in a git repository
	if (!(await isGitRepository())) {
		return 'Error: Not a git repository. Please run this command from within a git repository.';
	}

	const currentBranch = await getCurrentBranch();

	// Determine target branch
	let targetBranch = args.targetBranch;
	if (!targetBranch) {
		targetBranch = await getDefaultBranch();
	}

	// Check if on target branch
	if (currentBranch === targetBranch) {
		return `Error: Currently on ${targetBranch}. Please switch to a feature branch before creating a PR.`;
	}

	// Generate PR template
	const template = await generatePRTemplate(
		targetBranch,
		args.includeSummary !== false,
	);

	// Build response
	const responseLines: string[] = [];
	responseLines.push('=== Pull Request Template ===');
	responseLines.push('');
	responseLines.push(`Branch: ${currentBranch} -> ${targetBranch}`);
	responseLines.push(`Draft: ${args.draft ? 'Yes' : 'No'}`);
	responseLines.push('');
	responseLines.push('--- Title ---');
	responseLines.push(template.title);
	responseLines.push('');
	responseLines.push('--- Description ---');
	responseLines.push('## Summary');
	if (template.summary) {
		responseLines.push(template.summary);
	} else {
		responseLines.push('<!-- Add a summary of changes -->');
	}
	responseLines.push('');
	responseLines.push('## Test Plan');
	for (const item of template.testPlan) {
		responseLines.push(item);
	}
	responseLines.push('');

	if (template.breakingChanges && template.breakingChanges.length > 0) {
		responseLines.push('## Breaking Changes');
		for (const change of template.breakingChanges) {
			responseLines.push(`- ${change}`);
		}
		responseLines.push('');
	}

	if (template.suggestedReviewers && template.suggestedReviewers.length > 0) {
		responseLines.push('--- Suggested Reviewers ---');
		for (const reviewer of template.suggestedReviewers) {
			responseLines.push(`  - ${reviewer}`);
		}
		responseLines.push('');
	}

	if (template.labels && template.labels.length > 0) {
		responseLines.push('--- Suggested Labels ---');
		responseLines.push(`  ${template.labels.join(', ')}`);
		responseLines.push('');
	}

	responseLines.push('--- Commands ---');
	responseLines.push('');
	responseLines.push('To create this PR using GitHub CLI:');
	const draftFlag = args.draft ? ' --draft' : '';
	responseLines.push(
		`gh pr create --title "${template.title}" --body "..." --base ${targetBranch}${draftFlag}`,
	);
	responseLines.push('');
	responseLines.push(
		'Or copy the template above and create the PR manually on GitHub.',
	);

	return responseLines.join('\n');
};

// AI SDK tool definition with execute function
const gitCreatePRCoreTool = tool({
	description:
		'Generate a pull request template with auto-generated description, test plan, and reviewer suggestions based on commit history.',
	inputSchema: jsonSchema<CreatePRInput>({
		type: 'object',
		properties: {
			targetBranch: {
				type: 'string',
				description:
					'The target branch for the PR (e.g., "main", "develop"). Defaults to the default branch.',
			},
			draft: {
				type: 'boolean',
				description: 'Whether to create the PR as a draft. Default: false',
			},
			includeSummary: {
				type: 'boolean',
				description:
					'Whether to include a detailed summary of changes. Default: true',
			},
		},
		required: [],
	}),
	execute: async (args, _options) => {
		return await executeGitCreatePR(args);
	},
});

// Formatter component
const GitCreatePRFormatter = React.memo(
	({args, result}: {args: CreatePRInput; result?: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext is required');
		}
		const {colors} = themeContext;

		// Parse result for display
		let title = '';
		let description = '';
		let targetBranch = args.targetBranch || 'main';
		let hasBreakingChanges = false;

		if (result) {
			const titleMatch = result.match(/--- Title ---\n(.+)/);
			if (titleMatch) title = titleMatch[1];

			// Extract description (between --- Description --- and the end or next section)
			const descMatch = result.match(
				/--- Description ---\n([\s\S]*?)(?:\n---|\n\nTo create|$)/,
			);
			if (descMatch) {
				// Get first few lines of description for preview
				const descLines = descMatch[1].trim().split('\n').slice(0, 5);
				description = descLines.join('\n');
				if (descMatch[1].trim().split('\n').length > 5) {
					description += '\n...';
				}
			}

			const branchMatch = result.match(/Branch: .+ -> (.+)/);
			if (branchMatch) targetBranch = branchMatch[1];

			hasBreakingChanges = result.includes('Breaking Changes');
		}

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>git_create_pr</Text>

				<Box>
					<Text color={colors.secondary}>Target: </Text>
					<Text color={colors.primary}>{targetBranch}</Text>
				</Box>

				{args.draft && (
					<Box>
						<Text color={colors.secondary}>Draft: </Text>
						<Text color={colors.white}>Yes</Text>
					</Box>
				)}

				{title && (
					<Box>
						<Text color={colors.secondary}>Title: </Text>
						<Text color={colors.white}>
							{title.length > 40 ? title.substring(0, 40) + '...' : title}
						</Text>
					</Box>
				)}

				{description && (
					<Box flexDirection="column" marginTop={1}>
						<Text color={colors.secondary}>Description:</Text>
						<Box marginLeft={2}>
							<Text color={colors.white}>{description}</Text>
						</Box>
					</Box>
				)}

				{hasBreakingChanges && (
					<Box>
						<Text color={colors.error}>Contains breaking changes!</Text>
					</Box>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const formatter = (
	args: CreatePRInput,
	result?: string,
): React.ReactElement => {
	return <GitCreatePRFormatter args={args} result={result} />;
};

const validator = async (
	args: CreatePRInput,
): Promise<{valid: true} | {valid: false; error: string}> => {
	// Check if in git repository
	if (!(await isGitRepository())) {
		return {
			valid: false,
			error: 'git Not in a git repository',
		};
	}

	// Check if not on default branch
	const currentBranch = await getCurrentBranch();
	const defaultBranch = await getDefaultBranch();
	const targetBranch = args.targetBranch || defaultBranch;

	if (currentBranch === targetBranch) {
		return {
			valid: false,
			error: `git Currently on ${targetBranch}. Switch to a feature branch first.`,
		};
	}

	return {valid: true};
};

// Export the tool using NanocoderToolExport pattern
export const gitCreatePRTool: NanocoderToolExport = {
	name: 'git_create_pr' as const,
	tool: gitCreatePRCoreTool,
	formatter,
	validator,
};
