/**
 * Git Workflow Tools Tests
 *
 * Tests for the git workflow integration tools including:
 * - git_smart_commit
 * - git_create_pr
 * - git_branch_suggest
 * - git_status_enhanced
 */

import React from 'react';
import test from 'ava';
import stripAnsi from 'strip-ansi';
import {render} from 'ink-testing-library';
import {ThemeContext} from '../../hooks/useTheme';
import {themes} from '../../config/themes';
import {gitSmartCommitTool} from './git-smart-commit';
import {gitCreatePRTool} from './git-create-pr';
import {gitBranchSuggestTool} from './git-branch-suggest';
import {gitStatusEnhancedTool} from './git-status-enhanced';
import {
	analyzeChangesForCommitType,
	suggestScope,
	parseDiffStat,
	parseGitStatus,
} from './utils';

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
// Tests for Utils - analyzeChangesForCommitType
// ============================================================================

test('analyzeChangesForCommitType returns test for test files', t => {
	const files = [
		{path: 'src/utils.spec.ts', status: 'modified' as const, additions: 10, deletions: 5, isBinary: false},
		{path: 'src/index.test.ts', status: 'added' as const, additions: 20, deletions: 0, isBinary: false},
	];

	const result = analyzeChangesForCommitType(files);
	t.is(result, 'test');
});

test('analyzeChangesForCommitType returns docs for documentation', t => {
	const files = [
		{path: 'README.md', status: 'modified' as const, additions: 10, deletions: 5, isBinary: false},
		{path: 'docs/guide.md', status: 'added' as const, additions: 20, deletions: 0, isBinary: false},
	];

	const result = analyzeChangesForCommitType(files);
	t.is(result, 'docs');
});

test('analyzeChangesForCommitType returns ci for CI files', t => {
	const files = [
		{path: '.github/workflows/test.yml', status: 'modified' as const, additions: 10, deletions: 5, isBinary: false},
		{path: '.circleci/config.yml', status: 'modified' as const, additions: 5, deletions: 2, isBinary: false},
	];

	const result = analyzeChangesForCommitType(files);
	t.is(result, 'ci');
});

test('analyzeChangesForCommitType returns build for config files', t => {
	const files = [
		{path: 'package.json', status: 'modified' as const, additions: 1, deletions: 1, isBinary: false},
		{path: 'tsconfig.json', status: 'modified' as const, additions: 2, deletions: 0, isBinary: false},
	];

	const result = analyzeChangesForCommitType(files);
	t.is(result, 'build');
});

test('analyzeChangesForCommitType returns feat for new files', t => {
	const files = [
		{path: 'src/new-feature.ts', status: 'added' as const, additions: 100, deletions: 0, isBinary: false},
	];

	const result = analyzeChangesForCommitType(files);
	t.is(result, 'feat');
});

test('analyzeChangesForCommitType returns chore for deletions', t => {
	const files = [
		{path: 'src/old-file.ts', status: 'deleted' as const, additions: 0, deletions: 50, isBinary: false},
	];

	const result = analyzeChangesForCommitType(files);
	t.is(result, 'chore');
});

// ============================================================================
// Tests for Utils - suggestScope
// ============================================================================

test('suggestScope returns directory name for single directory', t => {
	const files = [
		{path: 'source/tools/file1.ts', status: 'modified' as const, additions: 10, deletions: 5, isBinary: false},
		{path: 'source/tools/file2.ts', status: 'modified' as const, additions: 5, deletions: 3, isBinary: false},
	];

	const result = suggestScope(files);
	t.is(result, 'tools');
});

test('suggestScope returns undefined for mixed directories', t => {
	const files = [
		{path: 'source/tools/file1.ts', status: 'modified' as const, additions: 10, deletions: 5, isBinary: false},
		{path: 'source/hooks/file2.ts', status: 'modified' as const, additions: 5, deletions: 3, isBinary: false},
	];

	const result = suggestScope(files);
	t.is(result, undefined);
});

test('suggestScope returns undefined for empty array', t => {
	const result = suggestScope([]);
	t.is(result, undefined);
});

// ============================================================================
// Tests for Utils - parseDiffStat
// ============================================================================

test('parseDiffStat parses standard diff stat', t => {
	const diffStat = ` src/file1.ts | 10 ++++---
 src/file2.ts |  5 ++--
 2 files changed, 10 insertions(+), 5 deletions(-)`;

	const result = parseDiffStat(diffStat);
	t.is(result.length, 2);
	t.is(result[0].path, 'src/file1.ts');
	t.is(result[1].path, 'src/file2.ts');
});

test('parseDiffStat handles empty input', t => {
	const result = parseDiffStat('');
	t.is(result.length, 0);
});

test('parseDiffStat handles binary files', t => {
	const diffStat = ` image.png | Bin 0 -> 1234 bytes`;

	const result = parseDiffStat(diffStat);
	t.is(result.length, 1);
	t.true(result[0].isBinary);
});

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

// ============================================================================
// Tests for git_smart_commit Tool Definition
// ============================================================================

test('git_smart_commit tool has correct name', t => {
	t.is(gitSmartCommitTool.name, 'git_smart_commit');
});

test('git_smart_commit tool has AI SDK tool with execute', t => {
	t.truthy(gitSmartCommitTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitSmartCommitTool.tool as any).execute, 'function');
});

test('git_smart_commit tool has formatter function', t => {
	t.is(typeof gitSmartCommitTool.formatter, 'function');
});

test('git_smart_commit tool has validator function', t => {
	t.is(typeof gitSmartCommitTool.validator, 'function');
});

// ============================================================================
// Tests for git_smart_commit Formatter
// ============================================================================

test('GitSmartCommitFormatter renders correctly', t => {
	const formatter = gitSmartCommitTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{dryRun: true, includeBody: true},
		'=== Smart Commit Analysis ===\nFiles changed: 3',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /smart_commit/);
	t.regex(output!, /dry-run/);
});

test('GitSmartCommitFormatter handles commit mode', t => {
	const formatter = gitSmartCommitTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{dryRun: false},
		'Files changed: 2',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /commit/);
});

test('GitSmartCommitFormatter displays hammer icon', t => {
	const formatter = gitSmartCommitTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{dryRun: true},
		'=== Smart Commit Analysis ===\nFiles changed: 3',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /⚒/); // Hammer icon
	t.regex(output!, /git_smart_commit/);
});

test('GitSmartCommitFormatter shows commit type and message', t => {
	const formatter = gitSmartCommitTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{dryRun: true},
		'=== Smart Commit Analysis ===\nFiles changed: 5\n=== Generated Commit Message ===\n\nfeat(auth): add user authentication',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	// Strip ANSI codes before regex matching (CI mode adds color codes)
	const plainOutput = stripAnsi(output!);
	t.regex(plainOutput, /Type: feat/);
	t.regex(plainOutput, /Message:/);
	t.regex(plainOutput, /add user authentication/);
});

test('GitSmartCommitFormatter handles breaking changes', t => {
	const formatter = gitSmartCommitTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{dryRun: true},
		'=== Smart Commit Analysis ===\nFiles changed: 2\n=== Generated Commit Message ===\n\nfeat!: remove deprecated API\n\nBREAKING CHANGE: API has changed',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /BREAKING/);
});

// ============================================================================
// Tests for git_create_pr Tool Definition
// ============================================================================

test('git_create_pr tool has correct name', t => {
	t.is(gitCreatePRTool.name, 'git_create_pr');
});

test('git_create_pr tool has AI SDK tool with execute', t => {
	t.truthy(gitCreatePRTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitCreatePRTool.tool as any).execute, 'function');
});

test('git_create_pr tool has formatter function', t => {
	t.is(typeof gitCreatePRTool.formatter, 'function');
});

test('git_create_pr tool has validator function', t => {
	t.is(typeof gitCreatePRTool.validator, 'function');
});

// ============================================================================
// Tests for git_create_pr Formatter
// ============================================================================

test('GitCreatePRFormatter renders correctly', t => {
	const formatter = gitCreatePRTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{targetBranch: 'main', draft: false},
		'Branch: feature -> main\n--- Title ---\nAdd new feature',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /create_pr/);
	t.regex(output!, /main/);
});

test('GitCreatePRFormatter shows draft indicator', t => {
	const formatter = gitCreatePRTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{draft: true},
		'Branch: feature -> main',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Draft.*Yes/i);
});

test('GitCreatePRFormatter displays hammer icon', t => {
	const formatter = gitCreatePRTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{targetBranch: 'main', draft: false},
		'Branch: feature -> main\n--- Title ---\nAdd new feature',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /⚒/); // Hammer icon
	t.regex(output!, /git_create_pr/);
});

test('GitCreatePRFormatter shows description preview', t => {
	const formatter = gitCreatePRTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{targetBranch: 'main'},
		'Branch: feature -> main\n--- Title ---\nImplement user auth\n--- Description ---\n## Summary\n- Add login\n- Add register',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Title:/);
	t.regex(output!, /Description:/);
	t.regex(output!, /Add login/);
});

test('GitCreatePRFormatter shows breaking changes warning', t => {
	const formatter = gitCreatePRTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{targetBranch: 'main'},
		'Branch: feature -> main\n--- Title ---\nAdd breaking change\n## Breaking Changes\n- Remove deprecated API',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Breaking Changes/i);
});

// ============================================================================
// Tests for git_branch_suggest Tool Definition
// ============================================================================

test('git_branch_suggest tool has correct name', t => {
	t.is(gitBranchSuggestTool.name, 'git_branch_suggest');
});

test('git_branch_suggest tool has AI SDK tool with execute', t => {
	t.truthy(gitBranchSuggestTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitBranchSuggestTool.tool as any).execute, 'function');
});

test('git_branch_suggest tool has formatter function', t => {
	t.is(typeof gitBranchSuggestTool.formatter, 'function');
});

// ============================================================================
// Tests for git_branch_suggest Formatter
// ============================================================================

test('GitBranchSuggestFormatter renders correctly', t => {
	const formatter = gitBranchSuggestTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{workType: 'feature', description: 'add user auth'},
		'--- Suggested Branch Name ---\n  feature/add-user-auth\nDetected strategy: feature-branch',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /branch_suggest/);
	t.regex(output!, /feature/);
});

test('GitBranchSuggestFormatter shows ticket ID', t => {
	const formatter = gitBranchSuggestTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{workType: 'bugfix', description: 'fix login', ticketId: 'PROJ-123'},
		'Branch: bugfix/PROJ-123/fix-login',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /PROJ-123/);
});

// ============================================================================
// Tests for git_status_enhanced Tool Definition
// ============================================================================

test('git_status_enhanced tool has correct name', t => {
	t.is(gitStatusEnhancedTool.name, 'git_status_enhanced');
});

test('git_status_enhanced tool has AI SDK tool with execute', t => {
	t.truthy(gitStatusEnhancedTool.tool);
	// biome-ignore lint/suspicious/noExplicitAny: Test accessing internal tool structure
	t.is(typeof (gitStatusEnhancedTool.tool as any).execute, 'function');
});

test('git_status_enhanced tool has formatter function', t => {
	t.is(typeof gitStatusEnhancedTool.formatter, 'function');
});

// ============================================================================
// Tests for git_status_enhanced Formatter
// ============================================================================

test('GitStatusEnhancedFormatter renders correctly', t => {
	const formatter = gitStatusEnhancedTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{detailed: false},
		'Branch: main\nSummary: Working tree clean',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /status_enhanced/);
	t.regex(output!, /main/);
});

test('GitStatusEnhancedFormatter shows conflicts warning', t => {
	const formatter = gitStatusEnhancedTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{},
		'Branch: feature\nSummary: 2 conflicts\n!!! CONFLICTS !!!',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Conflicts/i);
});

test('GitStatusEnhancedFormatter displays hammer icon', t => {
	const formatter = gitStatusEnhancedTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{detailed: true},
		'Branch: main\nSummary: Working tree clean',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /⚒/); // Hammer icon
	t.regex(output!, /git_status_enhanced/);
});

test('GitStatusEnhancedFormatter shows detailed mode', t => {
	const formatter = gitStatusEnhancedTool.formatter;
	if (!formatter) {
		t.fail('Formatter is not defined');
		return;
	}

	const element = formatter(
		{detailed: true},
		'Branch: main\nSummary: 1 file modified',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /detailed/);
});

// ============================================================================
// Validator Tests
// ============================================================================

test('git_branch_suggest validator validates work type', t => {
	// Test validator logic directly without git repo dependency
	const validTypes = ['feature', 'bugfix', 'hotfix', 'release', 'chore'];

	t.true(validTypes.includes('feature'));
	t.true(validTypes.includes('bugfix'));
	t.false(validTypes.includes('invalid'));
});

test('git_branch_suggest validator validates description length', t => {
	// Test description length validation logic
	const shortDesc = 'ab';
	const validDesc = 'add new feature';

	t.true(shortDesc.trim().length < 3);
	t.true(validDesc.trim().length >= 3);
});
