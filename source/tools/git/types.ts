/**
 * Git Workflow Integration Types
 *
 * TypeScript interfaces for the advanced git workflow tools
 */

/**
 * Conventional commit type categories
 */
export type CommitType =
	| 'feat' // New feature
	| 'fix' // Bug fix
	| 'docs' // Documentation only changes
	| 'style' // Changes that don't affect code meaning (formatting)
	| 'refactor' // Code change that neither fixes a bug nor adds a feature
	| 'perf' // Performance improvement
	| 'test' // Adding missing tests or correcting existing tests
	| 'build' // Changes to build system or external dependencies
	| 'ci' // Changes to CI configuration files and scripts
	| 'chore' // Other changes that don't modify src or test files
	| 'revert'; // Reverts a previous commit

/**
 * File change status from git
 */
export type FileChangeStatus =
	| 'added'
	| 'modified'
	| 'deleted'
	| 'renamed'
	| 'copied';

/**
 * Represents a single file change in a git diff
 */
export interface FileChange {
	path: string;
	status: FileChangeStatus;
	oldPath?: string; // For renames
	additions: number;
	deletions: number;
	isBinary: boolean;
}

/**
 * Analysis result from parsing git diff
 */
export interface DiffAnalysis {
	files: FileChange[];
	totalAdditions: number;
	totalDeletions: number;
	totalFiles: number;
	suggestedType: CommitType;
	suggestedScope?: string;
	isBreakingChange: boolean;
	breakingChangeReason?: string;
}

/**
 * Generated commit message structure
 */
export interface GeneratedCommit {
	type: CommitType;
	scope?: string;
	subject: string;
	body?: string;
	footer?: string;
	isBreakingChange: boolean;
	fullMessage: string;
}

/**
 * Branch workflow strategies
 */
export type WorkflowStrategy =
	| 'feature-branch'
	| 'gitflow'
	| 'trunk-based'
	| 'release-flow';

/**
 * PR template structure
 */
export interface PRTemplate {
	title: string;
	summary: string;
	changes: string[];
	testPlan: string[];
	breakingChanges?: string[];
	suggestedReviewers?: string[];
	labels?: string[];
}

/**
 * Enhanced git status result
 */
export interface EnhancedStatus {
	branch: string;
	upstream?: string;
	ahead: number;
	behind: number;
	staged: FileChange[];
	unstaged: FileChange[];
	untracked: string[];
	hasConflicts: boolean;
	conflicts: string[];
	summary: string;
}

/**
 * Git tool input types for tool definitions
 */
export interface SmartCommitInput {
	dryRun?: boolean;
	includeBody?: boolean;
	customScope?: string;
}

export interface CreatePRInput {
	targetBranch?: string;
	draft?: boolean;
	includeSummary?: boolean;
}

export interface BranchSuggestInput {
	workType: 'feature' | 'bugfix' | 'hotfix' | 'release' | 'chore';
	description: string;
	ticketId?: string;
}

export interface EnhancedStatusInput {
	detailed?: boolean;
	showStash?: boolean;
}
