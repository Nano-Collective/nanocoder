/**
 * Git Utils Tests
 */

import test from 'ava';
import {parseGitStatus, isGitAvailable, isGhAvailable} from './utils';

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
