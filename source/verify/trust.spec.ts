/**
 * Trust Level Tests
 */

import test from 'ava';
import {getAllowedToolNames, isActionAllowed} from './trust';

console.log('\ntrust.spec.ts – Trust Levels');

// ============================================================================
// comment-only: the write-access boundary the issue calls out explicitly
// ============================================================================

test('comment-only denies write_file', t => {
	t.false(isActionAllowed('comment-only', 'write_file'));
});

test('comment-only denies string_replace', t => {
	t.false(isActionAllowed('comment-only', 'string_replace'));
});

test('comment-only denies execute_bash', t => {
	t.false(isActionAllowed('comment-only', 'execute_bash'));
});

test('comment-only denies git_add and git_commit', t => {
	t.false(isActionAllowed('comment-only', 'git_add'));
	t.false(isActionAllowed('comment-only', 'git_commit'));
});

test('comment-only allows read/investigate tools', t => {
	t.true(isActionAllowed('comment-only', 'read_file'));
	t.true(isActionAllowed('comment-only', 'find_files'));
	t.true(isActionAllowed('comment-only', 'search_file_contents'));
	t.true(isActionAllowed('comment-only', 'list_directory'));
	t.true(isActionAllowed('comment-only', 'git_status'));
	t.true(isActionAllowed('comment-only', 'git_diff'));
	t.true(isActionAllowed('comment-only', 'git_log'));
	t.true(isActionAllowed('comment-only', 'lsp_get_diagnostics'));
	t.true(isActionAllowed('comment-only', 'web_search'));
	t.true(isActionAllowed('comment-only', 'fetch_url'));
});

test('comment-only allows git_pr read/comment/review actions but not create', t => {
	t.true(isActionAllowed('comment-only', 'git_pr', 'view'));
	t.true(isActionAllowed('comment-only', 'git_pr', 'list'));
	t.true(isActionAllowed('comment-only', 'git_pr', 'diff'));
	t.true(isActionAllowed('comment-only', 'git_pr', 'comment'));
	t.true(isActionAllowed('comment-only', 'git_pr', 'review'));
	t.true(isActionAllowed('comment-only', 'git_pr', 'checks'));
	t.true(isActionAllowed('comment-only', 'git_pr', 'logs'));
	t.false(isActionAllowed('comment-only', 'git_pr', 'create'));
});

test('comment-only requires an explicit action for git_pr', t => {
	t.false(isActionAllowed('comment-only', 'git_pr'));
});

test('comment-only denies unknown tools', t => {
	t.false(isActionAllowed('comment-only', 'some_unknown_tool'));
});

// ============================================================================
// auto-fix
// ============================================================================

test('auto-fix allows file mutation and local commit', t => {
	t.true(isActionAllowed('auto-fix', 'write_file'));
	t.true(isActionAllowed('auto-fix', 'string_replace'));
	t.true(isActionAllowed('auto-fix', 'git_add'));
	t.true(isActionAllowed('auto-fix', 'git_commit'));
	t.true(isActionAllowed('auto-fix', 'execute_bash'));
});

test('auto-fix allows git_pr create (to open a draft PR)', t => {
	t.true(isActionAllowed('auto-fix', 'git_pr', 'create'));
});

test('auto-fix still allows every comment-only tool', t => {
	for (const tool of getAllowedToolNames('comment-only')) {
		if (tool === 'git_pr') continue; // action set differs on purpose
		t.true(isActionAllowed('auto-fix', tool));
	}
});

// ============================================================================
// full-commit
// ============================================================================

test('full-commit allows everything auto-fix allows', t => {
	t.true(isActionAllowed('full-commit', 'write_file'));
	t.true(isActionAllowed('full-commit', 'execute_bash'));
	t.true(isActionAllowed('full-commit', 'git_pr', 'create'));
});

// ============================================================================
// getAllowedToolNames
// ============================================================================

test('getAllowedToolNames returns a strictly increasing surface across levels', t => {
	const commentOnly = new Set(getAllowedToolNames('comment-only'));
	const autoFix = new Set(getAllowedToolNames('auto-fix'));
	const fullCommit = new Set(getAllowedToolNames('full-commit'));

	for (const tool of commentOnly) {
		t.true(autoFix.has(tool));
	}
	for (const tool of autoFix) {
		t.true(fullCommit.has(tool));
	}
	t.true(autoFix.has('write_file'));
	t.false(commentOnly.has('write_file'));
});

test('getAllowedToolNames includes git_pr exactly once per level', t => {
	for (const level of ['comment-only', 'auto-fix', 'full-commit'] as const) {
		const names = getAllowedToolNames(level);
		t.is(names.filter(n => n === 'git_pr').length, 1);
	}
});
