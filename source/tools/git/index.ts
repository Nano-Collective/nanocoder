/**
 * Git Tools
 *
 * Provides git operations for the coding agent.
 * Tools are conditionally registered based on git/gh availability.
 */

import type {NanocoderToolExport} from '@/types/core';

import {gitAddTool} from './git-add';
import {gitBranchTool} from './git-branch';
import {gitCommitTool} from './git-commit';
import {gitDiffTool} from './git-diff';
import {gitLogTool} from './git-log';
import {gitPrTool} from './git-pr';
import {gitPullTool} from './git-pull';
import {gitPushTool} from './git-push';
import {gitResetTool} from './git-reset';
import {gitStashTool} from './git-stash';
import {gitStatusTool} from './git-status';
import {isGhAvailable, isGitAvailable} from './utils';

/**
 * Get all available git tools based on system capabilities.
 * Returns empty array if git is not installed.
 */
export function getGitTools(): NanocoderToolExport[] {
	// No git, no git tools
	if (!isGitAvailable()) {
		return [];
	}

	// Core git tools (always available if git is installed)
	const tools: NanocoderToolExport[] = [
		gitStatusTool,
		gitDiffTool,
		gitLogTool,
		gitAddTool,
		gitCommitTool,
		gitPushTool,
		gitPullTool,
		gitBranchTool,
		gitStashTool,
		gitResetTool,
	];

	// PR tool requires gh CLI
	if (isGhAvailable()) {
		tools.push(gitPrTool);
	}

	return tools;
}
