/**
 * Git Branch Suggest Tool
 *
 * Provides intelligent branch naming suggestions and workflow
 * strategy recommendations based on project context.
 */

import {Box, Text} from 'ink';
import React from 'react';
import ToolMessage from '@/components/tool-message';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import type {BranchSuggestInput, WorkflowStrategy} from './types';
import {
	execGit,
	getCurrentBranch,
	getDefaultBranch,
	isGitRepository,
} from './utils';

/**
 * Normalize description for branch name
 */
function normalizeForBranchName(description: string): string {
	return description
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, '') // Remove special characters
		.replace(/\s+/g, '-') // Replace spaces with hyphens
		.replace(/-+/g, '-') // Remove duplicate hyphens
		.replace(/^-|-$/g, '') // Trim hyphens from ends
		.substring(0, 50); // Limit length
}

/**
 * Generate branch name based on work type and description
 */
function generateBranchName(
	workType: BranchSuggestInput['workType'],
	description: string,
	ticketId?: string,
): string {
	const normalizedDesc = normalizeForBranchName(description);

	// Validate normalized description isn't empty (could happen with special-char-only input)
	if (!normalizedDesc && !ticketId) {
		throw new Error(
			'Description must contain at least some alphanumeric characters',
		);
	}

	// Map work types to conventional prefixes
	const prefixMap: Record<BranchSuggestInput['workType'], string> = {
		feature: 'feature',
		bugfix: 'bugfix',
		hotfix: 'hotfix',
		release: 'release',
		chore: 'chore',
	};

	const prefix = prefixMap[workType];

	// Build branch name
	const parts: string[] = [prefix];

	if (ticketId) {
		parts.push(ticketId.toUpperCase());
	}

	if (normalizedDesc) {
		parts.push(normalizedDesc);
	}

	return parts.join('/');
}

/**
 * Generate alternative branch name formats
 */
function generateAlternatives(
	workType: BranchSuggestInput['workType'],
	description: string,
	ticketId?: string,
): string[] {
	const normalizedDesc = normalizeForBranchName(description);
	const alternatives: string[] = [];

	// If normalized description is empty, use a fallback
	const descPart = normalizedDesc || 'update';

	// Alternative 1: Short form with ticket first
	if (ticketId) {
		alternatives.push(`${ticketId.toLowerCase()}-${descPart}`);
	}

	// Alternative 2: Kebab-case without prefix (only if we have content)
	if (normalizedDesc) {
		alternatives.push(normalizedDesc);
	}

	// Alternative 3: Username prefix (common pattern)
	alternatives.push(`user/${workType}/${descPart}`);

	// Alternative 4: Date-based
	const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
	alternatives.push(`${workType}/${date}-${descPart.substring(0, 20)}`);

	return alternatives.filter(Boolean).slice(0, 4);
}

/**
 * Analyze repository to suggest workflow strategy
 */
async function analyzeWorkflowStrategy(): Promise<{
	strategy: WorkflowStrategy;
	rationale: string;
}> {
	try {
		// Get list of branches
		const branchList = await execGit(['branch', '-a']);
		const branches = branchList
			.split('\n')
			.map(b => b.trim().replace(/^\*?\s*/, ''));

		// Check for common patterns
		const hasDevelop =
			branches.some(b => b.includes('develop')) ||
			branches.some(b => b.includes('dev'));
		const hasReleaseBranches = branches.some(b => b.includes('release/'));
		const hasHotfixBranches = branches.some(b => b.includes('hotfix/'));
		const hasFeatureBranches = branches.some(b => b.includes('feature/'));

		// Check commit frequency (recent commits on main)
		let recentCommits = 0;
		try {
			const log = await execGit([
				'log',
				'--oneline',
				'--since=1 week ago',
				'-n',
				'50',
			]);
			recentCommits = log.split('\n').filter(l => l.trim()).length;
		} catch {
			// May fail on new repos
		}

		// Determine strategy
		if (hasDevelop && hasReleaseBranches) {
			return {
				strategy: 'gitflow',
				rationale:
					'Repository uses develop branch and release branches, suggesting GitFlow workflow',
			};
		}

		if (hasReleaseBranches && !hasDevelop) {
			return {
				strategy: 'release-flow',
				rationale:
					'Repository uses release branches without develop, suggesting Release Flow',
			};
		}

		if (recentCommits > 30) {
			return {
				strategy: 'trunk-based',
				rationale:
					'High commit frequency suggests trunk-based development might be suitable',
			};
		}

		if (hasFeatureBranches || hasHotfixBranches) {
			return {
				strategy: 'feature-branch',
				rationale:
					'Repository uses feature/hotfix branches, following feature branch workflow',
			};
		}

		// Default to feature-branch
		return {
			strategy: 'feature-branch',
			rationale:
				'Default recommendation: Feature Branch workflow suits most projects',
		};
	} catch {
		return {
			strategy: 'feature-branch',
			rationale:
				'Unable to analyze repository; recommending Feature Branch workflow',
		};
	}
}

/**
 * Get workflow strategy description
 */
function getWorkflowDescription(strategy: WorkflowStrategy): string {
	const descriptions: Record<WorkflowStrategy, string> = {
		'feature-branch': `
Feature Branch Workflow:
- Create feature branches from main/master
- Merge via pull requests after review
- Simple and suitable for most teams
- Best for: Small to medium teams, web applications
`,
		gitflow: `
GitFlow Workflow:
- main: production-ready code
- develop: integration branch
- feature/*: new features
- release/*: release preparation
- hotfix/*: urgent production fixes
- Best for: Scheduled releases, larger teams
`,
		'trunk-based': `
Trunk-Based Development:
- Short-lived feature branches (< 2 days)
- Frequent merges to main
- Feature flags for incomplete work
- Continuous integration required
- Best for: Experienced teams, continuous deployment
`,
		'release-flow': `
Release Flow (GitHub Flow variant):
- main: always deployable
- feature branches for all work
- release/* for release stabilization
- Deploy from main or release branches
- Best for: Web services, SaaS products
`,
	};

	return descriptions[strategy] || descriptions['feature-branch'];
}

/**
 * Execute the git_branch_suggest tool
 */
const executeGitBranchSuggest = async (
	args: BranchSuggestInput,
): Promise<string> => {
	// Check if we're in a git repository
	if (!(await isGitRepository())) {
		return 'Error: Not a git repository. Please run this command from within a git repository.';
	}

	const currentBranch = await getCurrentBranch();
	const defaultBranch = await getDefaultBranch();

	// Analyze workflow
	const {strategy, rationale} = await analyzeWorkflowStrategy();

	// Generate suggestions
	const suggestedName = generateBranchName(
		args.workType,
		args.description,
		args.ticketId,
	);
	const alternatives = generateAlternatives(
		args.workType,
		args.description,
		args.ticketId,
	);

	// Check if branch already exists
	let branchExists = false;
	try {
		await execGit(['rev-parse', '--verify', suggestedName]);
		branchExists = true;
	} catch {
		branchExists = false;
	}

	// Build response
	const responseLines: string[] = [];
	responseLines.push('=== Branch Suggestion ===');
	responseLines.push('');
	responseLines.push(`Current branch: ${currentBranch}`);
	responseLines.push(`Default branch: ${defaultBranch}`);
	responseLines.push(`Work type: ${args.workType}`);
	if (args.ticketId) {
		responseLines.push(`Ticket ID: ${args.ticketId}`);
	}
	responseLines.push('');
	responseLines.push('--- Suggested Branch Name ---');
	responseLines.push(
		`  ${suggestedName}${branchExists ? ' (already exists!)' : ''}`,
	);
	responseLines.push('');
	responseLines.push('--- Alternatives ---');
	for (const alt of alternatives) {
		responseLines.push(`  - ${alt}`);
	}
	responseLines.push('');
	responseLines.push('--- Workflow Analysis ---');
	responseLines.push(`Detected strategy: ${strategy}`);
	responseLines.push(`Rationale: ${rationale}`);
	responseLines.push('');
	responseLines.push(getWorkflowDescription(strategy));
	responseLines.push('');
	responseLines.push('--- Commands ---');
	responseLines.push('');
	responseLines.push(`# Create and switch to the new branch:`);
	responseLines.push(`git checkout -b ${suggestedName}`);
	responseLines.push('');
	responseLines.push(`# Or using the newer git switch:`);
	responseLines.push(`git switch -c ${suggestedName}`);

	return responseLines.join('\n');
};

// AI SDK tool definition with execute function
const gitBranchSuggestCoreTool = tool({
	description:
		'Suggest branch names based on work type and provide workflow strategy recommendations.',
	inputSchema: jsonSchema<BranchSuggestInput>({
		type: 'object',
		properties: {
			workType: {
				type: 'string',
				enum: ['feature', 'bugfix', 'hotfix', 'release', 'chore'],
				description:
					'Type of work: feature (new functionality), bugfix (non-urgent fix), hotfix (urgent fix), release (release prep), chore (maintenance)',
			},
			description: {
				type: 'string',
				description:
					'Brief description of the work (e.g., "add user authentication", "fix login button")',
			},
			ticketId: {
				type: 'string',
				description: 'Optional ticket/issue ID (e.g., "PROJ-123", "GH-456")',
			},
		},
		required: ['workType', 'description'],
	}),
	execute: async (args, _options) => {
		return await executeGitBranchSuggest(args);
	},
});

// Formatter component
const GitBranchSuggestFormatter = React.memo(
	({args, result}: {args: BranchSuggestInput; result?: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext is required');
		}
		const {colors} = themeContext;

		// Parse result for display
		let suggestedBranch = '';
		let workflow = '';

		if (result) {
			const branchMatch = result.match(
				/--- Suggested Branch Name ---\n\s+(\S+)/,
			);
			if (branchMatch) suggestedBranch = branchMatch[1];

			const workflowMatch = result.match(/Detected strategy: (\S+)/);
			if (workflowMatch) workflow = workflowMatch[1];
		}

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>git_branch_suggest</Text>

				<Box>
					<Text color={colors.secondary}>Type: </Text>
					<Text color={colors.primary}>{args.workType}</Text>
				</Box>

				{args.ticketId && (
					<Box>
						<Text color={colors.secondary}>Ticket: </Text>
						<Text color={colors.white}>{args.ticketId}</Text>
					</Box>
				)}

				{suggestedBranch && (
					<Box>
						<Text color={colors.secondary}>Branch: </Text>
						<Text color={colors.white}>{suggestedBranch}</Text>
					</Box>
				)}

				{workflow && (
					<Box>
						<Text color={colors.secondary}>Workflow: </Text>
						<Text color={colors.white}>{workflow}</Text>
					</Box>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const formatter = (
	args: BranchSuggestInput,
	result?: string,
): React.ReactElement => {
	return <GitBranchSuggestFormatter args={args} result={result} />;
};

const validator = async (
	args: BranchSuggestInput,
): Promise<{valid: true} | {valid: false; error: string}> => {
	// Check if in git repository
	if (!(await isGitRepository())) {
		return {
			valid: false,
			error: 'git Not in a git repository',
		};
	}

	// Validate work type
	const validTypes = ['feature', 'bugfix', 'hotfix', 'release', 'chore'];
	if (!validTypes.includes(args.workType)) {
		return {
			valid: false,
			error: `git Invalid work type. Must be one of: ${validTypes.join(', ')}`,
		};
	}

	// Validate description
	if (!args.description || args.description.trim().length < 3) {
		return {
			valid: false,
			error: 'git Description must be at least 3 characters',
		};
	}

	return {valid: true};
};

// Export the tool using NanocoderToolExport pattern
export const gitBranchSuggestTool: NanocoderToolExport = {
	name: 'git_branch_suggest' as const,
	tool: gitBranchSuggestCoreTool,
	formatter,
	validator,
};
