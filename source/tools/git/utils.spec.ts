/**
 * Git Utils Tests
 */

import {execSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	parseGitStatus,
	isGitAvailable,
	isGhAvailable,
	getCurrentBranchSync,
	getDefaultBranchSync,
	getGitStatusSummarySync,
} from './utils';

// ============================================================================
// Test Helpers
// ============================================================================

console.log('\nutils.spec.ts – Git Utilities');

// ============================================================================
// Availability Check Tests
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
// parseGitStatus Tests
// ============================================================================

test('parseGitStatus parses staged modified files', t => {
	const statusOutput = `M  src/file1.ts
A  src/file2.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.staged.length, 2);
	t.is(result.staged[0]?.status, 'modified');
	t.is(result.staged[0]?.path, 'src/file1.ts');
	t.is(result.staged[1]?.status, 'added');
	t.is(result.staged[1]?.path, 'src/file2.ts');
});

test('parseGitStatus parses staged deleted files', t => {
	const statusOutput = `D  deleted-file.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.staged.length, 1);
	t.is(result.staged[0]?.status, 'deleted');
	t.is(result.staged[0]?.path, 'deleted-file.ts');
});

test('parseGitStatus parses staged renamed files', t => {
	const statusOutput = `R  old-name.ts -> new-name.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.staged.length, 1);
	t.is(result.staged[0]?.status, 'renamed');
});

test('parseGitStatus parses unstaged modified files', t => {
	const statusOutput = ` M src/file1.ts
 D src/file2.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.unstaged.length, 2);
	t.is(result.unstaged[0]?.status, 'modified');
	t.is(result.unstaged[1]?.status, 'deleted');
});

test('parseGitStatus parses untracked files', t => {
	const statusOutput = `?? new-file.ts
?? another-file.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.untracked.length, 2);
	t.true(result.untracked.includes('new-file.ts'));
	t.true(result.untracked.includes('another-file.ts'));
});

test('parseGitStatus handles empty input', t => {
	const result = parseGitStatus('');
	t.is(result.staged.length, 0);
	t.is(result.unstaged.length, 0);
	t.is(result.untracked.length, 0);
	t.is(result.conflicts.length, 0);
});

test('parseGitStatus detects conflicts - UU', t => {
	const statusOutput = `UU conflicted-file.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.conflicts.length, 1);
	t.is(result.conflicts[0], 'conflicted-file.ts');
});

test('parseGitStatus detects conflicts - AA', t => {
	const statusOutput = `AA both-added.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.conflicts.length, 1);
	t.is(result.conflicts[0], 'both-added.ts');
});

test('parseGitStatus detects conflicts - DD', t => {
	const statusOutput = `DD both-deleted.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.conflicts.length, 1);
});

test('parseGitStatus handles mixed status', t => {
	const statusOutput = `M  staged-modified.ts
 M unstaged-modified.ts
?? untracked.ts
UU conflict.ts`;

	const result = parseGitStatus(statusOutput);
	t.is(result.staged.length, 1);
	t.is(result.unstaged.length, 1);
	t.is(result.untracked.length, 1);
	t.is(result.conflicts.length, 1);
});

test('parseGitStatus handles files with spaces', t => {
	const statusOutput = `M  "file with spaces.ts"`;

	const result = parseGitStatus(statusOutput);
	t.is(result.staged.length, 1);
});

test('parseGitStatus handles both staged and unstaged changes on same file', t => {
	const statusOutput = `MM both-changes.ts`;

	const result = parseGitStatus(statusOutput);
	// File appears in both staged and unstaged
	t.is(result.staged.length, 1);
	t.is(result.unstaged.length, 1);
});

test('parseGitStatus ignores empty lines', t => {
	const statusOutput = `M  file1.ts

 M file2.ts

`;

	const result = parseGitStatus(statusOutput);
	t.is(result.staged.length, 1);
	t.is(result.unstaged.length, 1);
});

// ============================================================================
// Synchronous Branch Helper Tests
// ============================================================================

/**
 * Run an arbitrary function with `process.cwd()` temporarily changed.
 * Restores the previous cwd in a finally block so tests stay isolated.
 */
function withCwd<T>(dir: string, fn: () => T): T {
	const original = process.cwd();
	process.chdir(dir);
	try {
		return fn();
	} finally {
		process.chdir(original);
	}
}

test.serial('getCurrentBranchSync returns null when not in a git repo', t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-test-'));
	try {
		const result = withCwd(dir, () => getCurrentBranchSync());
		t.is(result, null);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial(
	'getCurrentBranchSync reads branch from .git/HEAD on a feature branch',
	t => {
		const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-test-'));
		try {
			mkdirSync(join(dir, '.git'));
			writeFileSync(
				join(dir, '.git', 'HEAD'),
				'ref: refs/heads/fix/read-file-empty\n',
			);
			const result = withCwd(dir, () => getCurrentBranchSync());
			t.deepEqual(result, {branch: 'fix/read-file-empty', detached: false});
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'getCurrentBranchSync reports detached HEAD when HEAD is a bare SHA',
	t => {
		const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-test-'));
		try {
			mkdirSync(join(dir, '.git'));
			writeFileSync(
				join(dir, '.git', 'HEAD'),
				'1234567890abcdef1234567890abcdef12345678\n',
			);
			const result = withCwd(dir, () => getCurrentBranchSync());
			t.truthy(result);
			t.true(result?.detached);
			t.is(result?.branch.length, 7);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'getDefaultBranchSync resolves origin/HEAD symbolic ref when present',
	t => {
		const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-test-'));
		try {
			mkdirSync(join(dir, '.git', 'refs', 'remotes', 'origin'), {
				recursive: true,
			});
			writeFileSync(
				join(dir, '.git', 'refs', 'remotes', 'origin', 'HEAD'),
				'ref: refs/remotes/origin/main\n',
			);
			const result = withCwd(dir, () => getDefaultBranchSync());
			t.is(result, 'main');
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'getDefaultBranchSync falls back to refs/heads/main when no origin HEAD',
	t => {
		const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-test-'));
		try {
			mkdirSync(join(dir, '.git', 'refs', 'heads'), {recursive: true});
			writeFileSync(join(dir, '.git', 'refs', 'heads', 'main'), 'deadbeef\n');
			const result = withCwd(dir, () => getDefaultBranchSync());
			t.is(result, 'main');
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'getGitStatusSummarySync returns null outside of a git repo',
	t => {
		const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-test-'));
		try {
			const result = withCwd(dir, () => getGitStatusSummarySync());
			t.is(result, null);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'getGitStatusSummarySync reports a real repo on the default branch',
	t => {
		if (!isGitAvailable()) {
			t.pass('git not available; skipping');
			return;
		}
		const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-test-'));
		try {
			execSync('git init -q -b main', {cwd: dir});
			execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m init', {
				cwd: dir,
			});
			const result = withCwd(dir, () => getGitStatusSummarySync());
			t.truthy(result);
			t.is(result?.branch, 'main');
			t.false(result?.detached);
			t.true(result?.isDefault);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'getGitStatusSummarySync reports a feature branch as non-default',
	t => {
		if (!isGitAvailable()) {
			t.pass('git not available; skipping');
			return;
		}
		const dir = mkdtempSync(join(tmpdir(), 'nanocoder-git-test-'));
		try {
			execSync('git init -q -b main', {cwd: dir});
			execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m init', {
				cwd: dir,
			});
			execSync('git checkout -q -b feature/x', {cwd: dir});
			const result = withCwd(dir, () => getGitStatusSummarySync());
			t.truthy(result);
			t.is(result?.branch, 'feature/x');
			t.false(result?.isDefault);
			t.false(result?.detached);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	},
);
