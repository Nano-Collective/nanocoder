/**
 * Git Tools Tests
 *
 * Tests for the git tools including:
 * - git_status
 * - git_diff
 * - git_log
 * - git_add
 * - git_commit
 * - git_push
 * - git_pull
 * - git_branch
 * - git_stash
 * - git_reset
 * - git_pr
 */

import React from 'react';
import test from 'ava';
import {render} from 'ink-testing-library';
import {ThemeContext} from '../../hooks/useTheme';
import {themes} from '../../config/themes';
import {gitStatusTool} from './git-status';
import {gitDiffTool} from './git-diff';
import {gitLogTool} from './git-log';
import {gitAddTool} from './git-add';
import {gitCommitTool} from './git-commit';
import {gitPushTool} from './git-push';
import {gitPullTool} from './git-pull';
import {gitBranchTool} from './git-branch';
import {gitStashTool} from './git-stash';
import {gitResetTool} from './git-reset';
import {gitPrTool} from './git-pr';
import {parseGitStatus, isGitAvailable, isGhAvailable} from './utils';

// ============================================================================
// Test Helpers
// ============================================================================

console.log(`\ngit-tools.spec.tsx – React ${React.version}`);

// Create a mock theme provider for tests
function TestThemeProvider({children}: {children: React.ReactNode}) {
	const themeContextValue = {
		currentTheme: 'tokyo-night' as const,
		colors: themes['tokyo-night'].colors,
		setCurrentTheme: () => {},
	};

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{children}
		</ThemeContext.Provider>
	);
}

// ============================================================================
// Tests for Utils - parseGitStatus
// ============================================================================

test('parseGitStatus parses staged files', t => {
	const statusOutput = `M  src/file1.ts
A  src/file2.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.staged.length, 2);
	t.is(result.staged[0].status, 'modified');
	t.is(result.staged[1].status, 'added');
});

test('parseGitStatus parses unstaged files', t => {
	const statusOutput = ` M src/file1.ts
 D src/file2.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.unstaged.length, 2);
	t.is(result.unstaged[0].status, 'modified');
	t.is(result.unstaged[1].status, 'deleted');
});

test('parseGitStatus parses untracked files', t => {
	const statusOutput = `?? new-file.ts
?? another-file.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.untracked.length, 2);
	t.true(result.untracked.includes('new-file.ts'));
});

test('parseGitStatus handles empty input', t => {
	const result = parseGitStatus('');
	t.is(result.staged.length, 0);
	t.is(result.unstaged.length, 0);
	t.is(result.untracked.length, 0);
});

test('parseGitStatus detects conflicts', t => {
	const statusOutput = `UU conflicted-file.ts
AA both-added.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.conflicts.length, 2);
});

// ============================================================================
// Tests for Availability Checks
// ============================================================================

test('isGitAvailable returns boolean', t => {
	const result = isGitAvailable();
	t.is(typeof result, 'boolean');
});

test('isGhAvailable returns boolean', t => {
	const result = isGhAvailable();
	t.is(typeof result, 'boolean');
});

// ============================================================================
// Tests for git_status Tool Definition
// ============================================================================

test('git_status tool has correct name', t => {
	t.is(gitStatusTool.name, 'git_status');
});

test('git_status tool has AI SDK tool with execute', t => {
	t.truthy(gitStatusTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitStatusTool.tool as any).execute, 'function');
});

test('git_status tool has formatter function', t => {
	t.is(typeof gitStatusTool.formatter, 'function');
});

test('git_status formatter renders correctly', t => {
	const formatter = gitStatusTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{},
		'Branch: main\nUpstream: origin/main\nWorking tree clean',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_status/);
});

// ============================================================================
// Tests for git_diff Tool Definition
// ============================================================================

test('git_diff tool has correct name', t => {
	t.is(gitDiffTool.name, 'git_diff');
});

test('git_diff tool has AI SDK tool with execute', t => {
	t.truthy(gitDiffTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitDiffTool.tool as any).execute, 'function');
});

test('git_diff tool has formatter function', t => {
	t.is(typeof gitDiffTool.formatter, 'function');
});

test('git_diff formatter renders correctly', t => {
	const formatter = gitDiffTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{staged: true},
		'diff --git a/file.ts b/file.ts',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_diff/);
});

// ============================================================================
// Tests for git_log Tool Definition
// ============================================================================

test('git_log tool has correct name', t => {
	t.is(gitLogTool.name, 'git_log');
});

test('git_log tool has AI SDK tool with execute', t => {
	t.truthy(gitLogTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitLogTool.tool as any).execute, 'function');
});

test('git_log tool has formatter function', t => {
	t.is(typeof gitLogTool.formatter, 'function');
});

test('git_log formatter renders correctly', t => {
	const formatter = gitLogTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{count: 5},
		'Showing 5 commit(s) on main:',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_log/);
});

// ============================================================================
// Tests for git_add Tool Definition
// ============================================================================

test('git_add tool has correct name', t => {
	t.is(gitAddTool.name, 'git_add');
});

test('git_add tool has AI SDK tool with execute', t => {
	t.truthy(gitAddTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitAddTool.tool as any).execute, 'function');
});

test('git_add tool has formatter function', t => {
	t.is(typeof gitAddTool.formatter, 'function');
});

test('git_add formatter renders correctly', t => {
	const formatter = gitAddTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{all: true},
		'Staged 3 file(s)',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_add/);
});

// ============================================================================
// Tests for git_commit Tool Definition
// ============================================================================

test('git_commit tool has correct name', t => {
	t.is(gitCommitTool.name, 'git_commit');
});

test('git_commit tool has AI SDK tool with execute', t => {
	t.truthy(gitCommitTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitCommitTool.tool as any).execute, 'function');
});

test('git_commit tool has formatter function', t => {
	t.is(typeof gitCommitTool.formatter, 'function');
});

test('git_commit tool has validator function', t => {
	t.is(typeof gitCommitTool.validator, 'function');
});

test('git_commit formatter renders correctly', t => {
	const formatter = gitCommitTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{message: 'feat: add new feature'},
		'Commit created: abc1234',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_commit/);
	t.regex(output!, /feat: add new feature/);
});

// ============================================================================
// Tests for git_push Tool Definition
// ============================================================================

test('git_push tool has correct name', t => {
	t.is(gitPushTool.name, 'git_push');
});

test('git_push tool has AI SDK tool with execute', t => {
	t.truthy(gitPushTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitPushTool.tool as any).execute, 'function');
});

test('git_push tool has formatter function', t => {
	t.is(typeof gitPushTool.formatter, 'function');
});

test('git_push tool has validator function', t => {
	t.is(typeof gitPushTool.validator, 'function');
});

test('git_push formatter shows force warning', t => {
	const formatter = gitPushTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{force: true},
		'',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /FORCE PUSH/i);
});

// ============================================================================
// Tests for git_pull Tool Definition
// ============================================================================

test('git_pull tool has correct name', t => {
	t.is(gitPullTool.name, 'git_pull');
});

test('git_pull tool has AI SDK tool with execute', t => {
	t.truthy(gitPullTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitPullTool.tool as any).execute, 'function');
});

test('git_pull tool has formatter function', t => {
	t.is(typeof gitPullTool.formatter, 'function');
});

test('git_pull formatter renders correctly', t => {
	const formatter = gitPullTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{rebase: true},
		'Pulled from origin/main',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_pull/);
});

// ============================================================================
// Tests for git_branch Tool Definition
// ============================================================================

test('git_branch tool has correct name', t => {
	t.is(gitBranchTool.name, 'git_branch');
});

test('git_branch tool has AI SDK tool with execute', t => {
	t.truthy(gitBranchTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitBranchTool.tool as any).execute, 'function');
});

test('git_branch tool has formatter function', t => {
	t.is(typeof gitBranchTool.formatter, 'function');
});

test('git_branch formatter shows force delete warning', t => {
	const formatter = gitBranchTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{delete: 'feature-branch', force: true},
		'',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /FORCE DELETE/i);
});

// ============================================================================
// Tests for git_stash Tool Definition
// ============================================================================

test('git_stash tool has correct name', t => {
	t.is(gitStashTool.name, 'git_stash');
});

test('git_stash tool has AI SDK tool with execute', t => {
	t.truthy(gitStashTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitStashTool.tool as any).execute, 'function');
});

test('git_stash tool has formatter function', t => {
	t.is(typeof gitStashTool.formatter, 'function');
});

test('git_stash formatter shows clear warning', t => {
	const formatter = gitStashTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{clear: true},
		'',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /permanently delete/i);
});

// ============================================================================
// Tests for git_reset Tool Definition
// ============================================================================

test('git_reset tool has correct name', t => {
	t.is(gitResetTool.name, 'git_reset');
});

test('git_reset tool has AI SDK tool with execute', t => {
	t.truthy(gitResetTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitResetTool.tool as any).execute, 'function');
});

test('git_reset tool has formatter function', t => {
	t.is(typeof gitResetTool.formatter, 'function');
});

test('git_reset formatter shows hard reset warning', t => {
	const formatter = gitResetTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{mode: 'hard'},
		'',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /WARNING/i);
	t.regex(output!, /permanently discard/i);
});

// ============================================================================
// Tests for git_pr Tool Definition
// ============================================================================

test('git_pr tool has correct name', t => {
	t.is(gitPrTool.name, 'git_pr');
});

test('git_pr tool has AI SDK tool with execute', t => {
	t.truthy(gitPrTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitPrTool.tool as any).execute, 'function');
});

test('git_pr tool has formatter function', t => {
	t.is(typeof gitPrTool.formatter, 'function');
});

test('git_pr formatter renders create action correctly', t => {
	const formatter = gitPrTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{create: {title: 'Add new feature', draft: true}},
		'',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /git_pr/);
	t.regex(output!, /create/i);
	t.regex(output!, /Add new feature/);
});
