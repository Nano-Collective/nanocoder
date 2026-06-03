/**
 * Git Tools
 *
 * Provides git operations for the coding agent.
 * Tools are conditionally registered based on git/gh availability.
 *
 * Scope is intentionally narrow: the read-only inspectors (status/diff/log)
 * plus the staging/commit/PR flow that benefits from structured output and
 * approval gating. Rarer operations (push, pull, branch, stash, reset) are
 * left to execute_bash to keep the tool surface small.
 */

import type {NanocoderToolExport} from '@/types/core';

import {gitAddTool} from './git-add';
import {gitCommitTool} from './git-commit';
import {gitDiffTool} from './git-diff';
import {gitLogTool} from './git-log';
import {gitPrTool} from './git-pr';
import {gitStatusTool} from './git-status';
import {isGhAvailable, isGitAvailable, isInsideGitRepo} from './utils';

/**
 * Get all available git tools based on system capabilities.
 * Returns empty array if git is not installed.
 */
export function getGitTools(): NanocoderToolExport[] {
	// No git or not in a git repo, no git tools
	if (!isGitAvailable() || !isInsideGitRepo()) {
		return [];
	}

	// Core git tools (always available if git is installed)
	const tools: NanocoderToolExport[] = [
		gitStatusTool,
		gitDiffTool,
		gitLogTool,
		gitAddTool,
		gitCommitTool,
	];

	// PR tool requires gh CLI
	if (isGhAvailable()) {
		tools.push(gitPrTool);
	}

	return tools;
}
