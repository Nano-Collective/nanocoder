/**
 * Git Workflow Tools
 *
 * Advanced git workflow integration for nanocoder.
 * Provides intelligent version control operations including:
 * - Smart commit message generation
 * - PR template creation
 * - Branch naming suggestions
 * - Enhanced status reporting
 */

export {gitBranchSuggestTool} from './git-branch-suggest';
export {gitCreatePRTool} from './git-create-pr';
export {gitSmartCommitTool} from './git-smart-commit';
export {gitStatusEnhancedTool} from './git-status-enhanced';

// Re-export types for external use
export type {
	BranchSuggestInput,
	CommitType,
	CreatePRInput,
	DiffAnalysis,
	EnhancedStatus,
	EnhancedStatusInput,
	FileChange,
	FileChangeStatus,
	GeneratedCommit,
	PRTemplate,
	SmartCommitInput,
	WorkflowStrategy,
} from './types';
