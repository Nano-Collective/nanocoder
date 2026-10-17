import {resolve} from 'node:path';
import test from 'ava';
import {
	bumpReadContentGeneration,
	clearReadTracker,
	forgetReadContent,
	forgetVisibilityReceipt,
	getLineNumbersForText,
	hasSeenFile,
	hasVisibleLines,
	invalidateAllVisibilityReceipts,
	markFileSeen,
	matchReadContent,
	recordVisibilityReceipt,
	rememberReadContent,
	runWithReadContentScope,
	clearReadContentScope,
} from './read-tracker.js';

test.beforeEach(() => {
	clearReadTracker();
});

test.serial('hasSeenFile is false for an unseen file', t => {
	t.false(hasSeenFile('/tmp/never-read.txt'));
});

test.serial('markFileSeen makes a file seen', t => {
	markFileSeen('/tmp/read-me.txt');
	t.true(hasSeenFile('/tmp/read-me.txt'));
});

test.serial('paths are normalized so relative and absolute match', t => {
	const abs = resolve('relative/path.txt');
	markFileSeen('relative/path.txt');
	t.true(hasSeenFile(abs));
});

test.serial('clearReadTracker forgets all seen files', t => {
	markFileSeen('/tmp/a.txt');
	markFileSeen('/tmp/b.txt');
	clearReadTracker();
	t.false(hasSeenFile('/tmp/a.txt'));
	t.false(hasSeenFile('/tmp/b.txt'));
});

test.serial('matchReadContent hits the same path and range', t => {
	const stats = {mtimeMs: 10, size: 4};
	rememberReadContent('/tmp/stub.txt', stats, 2);
	t.deepEqual(matchReadContent('/tmp/stub.txt', stats), {
		lineCount: 2,
		size: 4,
	});
});

test.serial('matchReadContent misses after generation bump', t => {
	const stats = {mtimeMs: 10, size: 4};
	rememberReadContent('/tmp/stub.txt', stats, 2);
	bumpReadContentGeneration();
	t.is(matchReadContent('/tmp/stub.txt', stats), undefined);
});

test.serial('matchReadContent misses after size change', t => {
	rememberReadContent('/tmp/stub.txt', {mtimeMs: 10, size: 4}, 2);
	t.is(matchReadContent('/tmp/stub.txt', {mtimeMs: 10, size: 8}), undefined);
});

test.serial('forgetReadContent drops every range for that path', t => {
	const stats = {mtimeMs: 10, size: 4};
	rememberReadContent('/tmp/stub.txt', stats, 2);
	rememberReadContent('/tmp/stub.txt', stats, 2, 1, 2);
	forgetReadContent('/tmp/stub.txt');
	t.is(matchReadContent('/tmp/stub.txt', stats), undefined);
	t.is(matchReadContent('/tmp/stub.txt', stats, 1, 2), undefined);
});

test.serial('clearReadTracker drops stub state too', t => {
	const stats = {mtimeMs: 10, size: 4};
	rememberReadContent('/tmp/stub.txt', stats, 2);
	clearReadTracker();
	t.is(matchReadContent('/tmp/stub.txt', stats), undefined);
});

test.serial('read content scopes do not leak across runWithReadContentScope', t => {
	const stats = {mtimeMs: 10, size: 4};
	rememberReadContent('/tmp/stub.txt', stats, 2);
	runWithReadContentScope('subagent', () => {
		t.is(matchReadContent('/tmp/stub.txt', stats), undefined);
		rememberReadContent('/tmp/stub.txt', stats, 2);
	});
	t.deepEqual(matchReadContent('/tmp/stub.txt', stats), {
		lineCount: 2,
		size: 4,
	});
});

test.serial('bumpReadContentGeneration does not clear the edit guard', t => {
	markFileSeen('/tmp/seen.txt');
	bumpReadContentGeneration();
	t.true(hasSeenFile('/tmp/seen.txt'));
});

test.serial('clearReadContentScope drops only that scope', t => {
	const stats = {mtimeMs: 10, size: 4};
	rememberReadContent('/tmp/main.txt', stats, 2);
	runWithReadContentScope('agent-1', () => {
		rememberReadContent('/tmp/sub.txt', stats, 2);
	});
	clearReadContentScope('agent-1');
	t.deepEqual(matchReadContent('/tmp/main.txt', stats), {
		lineCount: 2,
		size: 4,
	});
	runWithReadContentScope('agent-1', () => {
		t.is(matchReadContent('/tmp/sub.txt', stats), undefined);
	});
});

// ============================================================================
// Visibility Receipt Tests (Issue #1573)
// ============================================================================

test.serial('recordVisibilityReceipt records full file when no range given', t => {
	const stats = {mtimeMs: 100, size: 500};
	recordVisibilityReceipt('/tmp/full.txt', stats, undefined, undefined);

	const check = hasVisibleLines('/tmp/full.txt', stats, [1, 10, 50, 100]);
	t.true(check.visible);
});

test.serial('recordVisibilityReceipt records specific line range', t => {
	const stats = {mtimeMs: 100, size: 500};
	recordVisibilityReceipt('/tmp/range.txt', stats, 10, 20);

	const check = hasVisibleLines('/tmp/range.txt', stats, [15]);
	t.true(check.visible);
});

test.serial('hasVisibleLines blocks edit to unseen lines', t => {
	const stats = {mtimeMs: 100, size: 500};
	recordVisibilityReceipt('/tmp/partial.txt', stats, 10, 20);

	const check = hasVisibleLines('/tmp/partial.txt', stats, [25]);
	t.false(check.visible);
	t.regex(check.error!, /Line 25.*has not been read/);
});

test.serial('hasVisibleLines blocks edit when no receipt exists', t => {
	const stats = {mtimeMs: 100, size: 500};

	const check = hasVisibleLines('/tmp/never-read.txt', stats, [1]);
	t.false(check.visible);
	t.regex(check.error!, /have not read/);
});

test.serial('hasVisibleLines blocks edit after file changed externally', t => {
	const oldStats = {mtimeMs: 100, size: 500};
	const newStats = {mtimeMs: 200, size: 500};
	recordVisibilityReceipt('/tmp/changed.txt', oldStats, 1, 10);

	const check = hasVisibleLines('/tmp/changed.txt', newStats, [5]);
	t.false(check.visible);
	t.regex(check.error!, /modified externally/);
});

test.serial('hasVisibleLines blocks edit after context compaction', t => {
	const stats = {mtimeMs: 100, size: 500};
	recordVisibilityReceipt('/tmp/compact.txt', stats, 1, 10);

	bumpReadContentGeneration();

	const check = hasVisibleLines('/tmp/compact.txt', stats, [5]);
	t.false(check.visible);
	t.regex(check.error!, /invalidated by context compaction/);
});

test.serial('recordVisibilityReceipt merges multiple ranges', t => {
	const stats = {mtimeMs: 100, size: 500};
	recordVisibilityReceipt('/tmp/multi.txt', stats, 1, 10);
	recordVisibilityReceipt('/tmp/multi.txt', stats, 20, 30);

	const check1 = hasVisibleLines('/tmp/multi.txt', stats, [5]);
	t.true(check1.visible);

	const check2 = hasVisibleLines('/tmp/multi.txt', stats, [25]);
	t.true(check2.visible);

	const check3 = hasVisibleLines('/tmp/multi.txt', stats, [15]);
	t.false(check3.visible);
});

test.serial('recordVisibilityReceipt replaces receipt on file change', t => {
	const oldStats = {mtimeMs: 100, size: 500};
	const newStats = {mtimeMs: 200, size: 600};

	recordVisibilityReceipt('/tmp/replaced.txt', oldStats, 1, 10);
	recordVisibilityReceipt('/tmp/replaced.txt', newStats, 50, 60);

	// Old range should no longer be visible (file changed)
	const check1 = hasVisibleLines('/tmp/replaced.txt', newStats, [5]);
	t.false(check1.visible);

	// New range should be visible
	const check2 = hasVisibleLines('/tmp/replaced.txt', newStats, [55]);
	t.true(check2.visible);
});

test.serial('forgetVisibilityReceipt clears receipts for a file', t => {
	const stats = {mtimeMs: 100, size: 500};
	recordVisibilityReceipt('/tmp/forget.txt', stats, 1, 10);

	forgetVisibilityReceipt('/tmp/forget.txt');

	const check = hasVisibleLines('/tmp/forget.txt', stats, [5]);
	t.false(check.visible);
});

test.serial('invalidateAllVisibilityReceipts clears all receipts', t => {
	const stats = {mtimeMs: 100, size: 500};
	recordVisibilityReceipt('/tmp/file1.txt', stats, 1, 10);
	recordVisibilityReceipt('/tmp/file2.txt', stats, 1, 10);

	invalidateAllVisibilityReceipts();

	const check1 = hasVisibleLines('/tmp/file1.txt', stats, [5]);
	t.false(check1.visible);

	const check2 = hasVisibleLines('/tmp/file2.txt', stats, [5]);
	t.false(check2.visible);
});

test.serial('getLineNumbersForText finds single-line match', t => {
	const content = 'line1\nline2\nline3\n';
	const lines = getLineNumbersForText(content, 'line2');

	t.deepEqual(lines, [2]);
});

test.serial('getLineNumbersForText finds multi-line match', t => {
	const content = 'line1\nline2\nline3\nline4\n';
	const lines = getLineNumbersForText(content, 'line2\nline3');

	t.deepEqual(lines, [2, 3]);
});

test.serial('getLineNumbersForText returns empty for no match', t => {
	const content = 'line1\nline2\nline3\n';
	const lines = getLineNumbersForText(content, 'notfound');

	t.deepEqual(lines, []);
});

test.serial('visibility receipts respect scope boundaries', t => {
	const stats = {mtimeMs: 100, size: 500};

	recordVisibilityReceipt('/tmp/scoped.txt', stats, 1, 10);

	runWithReadContentScope('subagent', () => {
		// Subagent should not see parent's receipts
		const check = hasVisibleLines('/tmp/scoped.txt', stats, [5]);
		t.false(check.visible);

		// Record in subagent scope
		recordVisibilityReceipt('/tmp/scoped.txt', stats, 20, 30);
		const subCheck = hasVisibleLines('/tmp/scoped.txt', stats, [25]);
		t.true(subCheck.visible);
	});

	// Back in main scope, original receipt should still work
	const mainCheck = hasVisibleLines('/tmp/scoped.txt', stats, [5]);
	t.true(mainCheck.visible);

	// But subagent's receipt should not leak
	const noLeakCheck = hasVisibleLines('/tmp/scoped.txt', stats, [25]);
	t.false(noLeakCheck.visible);
});

test.serial('clearReadTracker clears visibility receipts', t => {
	const stats = {mtimeMs: 100, size: 500};
	recordVisibilityReceipt('/tmp/clear-test.txt', stats, 1, 10);

	clearReadTracker();

	const check = hasVisibleLines('/tmp/clear-test.txt', stats, [5]);
	t.false(check.visible);
});

test.serial('hasVisibleLines allows edit when all target lines are visible', t => {
	const stats = {mtimeMs: 100, size: 500};
	recordVisibilityReceipt('/tmp/multi-line.txt', stats, 1, 10);
	recordVisibilityReceipt('/tmp/multi-line.txt', stats, 20, 30);

	// All lines within visible ranges
	const check = hasVisibleLines('/tmp/multi-line.txt', stats, [5, 6, 7]);
	t.true(check.visible);
});

test.serial('hasVisibleLines blocks edit when any target line is invisible', t => {
	const stats = {mtimeMs: 100, size: 500};
	recordVisibilityReceipt('/tmp/partial-vis.txt', stats, 1, 10);

	// Mix of visible and invisible lines
	const check = hasVisibleLines('/tmp/partial-vis.txt', stats, [5, 15]);
	t.false(check.visible);
	t.regex(check.error!, /Line 15.*has not been read/);
});

test.serial('visibility receipts survive generation bump (use invalidateAllVisibilityReceipts)', t => {
	const stats = {mtimeMs: 100, size: 500};
	recordVisibilityReceipt('/tmp/survive.txt', stats, 1, 10);

	// Generation bump should invalidate via invalidateAllVisibilityReceipts
	// but receipts themselves check generation internally
	bumpReadContentGeneration();

	const check = hasVisibleLines('/tmp/survive.txt', stats, [5]);
	t.false(check.visible);
	t.regex(check.error!, /invalidated by context compaction/);
});
