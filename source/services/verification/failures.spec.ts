import test from 'ava';
import {diffFailures, failuresOf} from './failures.js';

// ============================================================================
// Failure identity
// ============================================================================

/**
 * A failing test must keep its identity when the assertion message changes.
 * Without that, a diff reports every reworded failure as one resolved plus one
 * introduced, and the model is told it fixed something it did not touch.
 */
test('failuresOf: identity survives a changed assertion message', t => {
	const before = failuresOf(
		'FAILED tests/test_a.py::test_one - AssertionError: expected 1 to be 2',
	);
	const after = failuresOf(
		'FAILED tests/test_a.py::test_one - AssertionError: expected 3 to be 4',
	);
	t.is(before.length, 1);
	t.is(after.length, 1);
	t.is(before[0].key, after[0].key);
	t.not(before[0].line, after[0].line, 'the display line should still differ');
});

test('failuresOf: recognises common runner conventions', t => {
	const cases: Array<[string, string]> = [
		['pytest', 'FAILED tests/test_a.py::test_one - AssertionError: nope'],
		['pytest -q', 'tests/test_a.py::test_one FAILED'],
		['go', '--- FAIL: TestAlpha (0.00s)'],
		['cargo', 'test module::case_name ... FAILED'],
		['jest tree', '● Suite › does the thing'],
		['jest summary', 'FAIL src/a.test.ts > Suite > does the thing'],
		['tap', 'not ok 7 - some description'],
		['dotnet', 'Failed Namespace.Class.Method [12 ms]'],
		['gradle', 'com.example.FooTest > bar FAILED'],
		['vitest row', '× does the thing'],
	];
	for (const [runner, line] of cases) {
		const found = failuresOf(line);
		t.is(found.length, 1, `${runner}: expected one failure from ${line}`);
	}
});

test('failuresOf: a compiler diagnostic counts as a failure', t => {
	// A build that never compiles is one of the most common failures, and
	// TypeScript spells it lowercase. Missing this means a broken build is
	// reported as "failed with no test failures".
	const found = failuresOf("error TS2304: Cannot find name 'foo'.");
	t.is(found.length, 1);
	t.regex(found[0].line, /TS2304/);
});

test('failuresOf: an unrecognised convention still yields a usable identity', t => {
	const found = failuresOf('checkmate: the widget count assertion did not hold');
	t.is(found.length, 1);
	t.truthy(found[0].key);
});

test('failuresOf: passing output yields no failures', t => {
	t.deepEqual(failuresOf('Tests: 12 passed, 12 total\nOK\n'), []);
});

test('failuresOf: ignores narration that merely mentions failing', t => {
	// A passing run says "0 failed". Reading that as a failure would make every
	// green run look broken.
	t.deepEqual(
		failuresOf('Tests: 12 passed, 0 failed, 12 total\nAll good.'),
		[],
	);
});

test('failuresOf: de-duplicates repeated reports of the same failure', t => {
	// Runners print a tree node and then a detailed section for the same test.
	const output = [
		'● Suite › does the thing',
		'',
		'● Suite › does the thing',
		'',
		'  expect(received).toBe(expected)',
	].join('\n');
	const found = failuresOf(output);
	t.is(found.length, 1);
	t.regex(found[0].line, /^● Suite › does the thing/);
});

test('failuresOf: ordering is stable across runs', t => {
	// Parallel runners interleave their output differently every time. If the
	// order leaked through, the no-progress rule could never fire.
	const one = '● a\n● b\n● c';
	const two = '● c\n● a\n● b';
	t.deepEqual(
		failuresOf(one).map(f => f.key),
		failuresOf(two).map(f => f.key),
	);
});

test('failuresOf: durations in failure lines do not change identity', t => {
	// The captured group is the test name, so the surrounding duration is
	// already excluded from the key.
	const found = failuresOf('--- FAIL: TestAlpha (0.00s)');
	t.is(found[0].key, 'TestAlpha');
	t.regex(found[0].line, /\(0\.00s\)/, 'the display line keeps the detail');
});

test('failuresOf: a count summary is not a failure in its own right', t => {
	// `Tests: 1 failed, 1 total` mentions failing, but it summarises the tests
	// already captured. Counting it as a failure inflates every count and adds
	// a phantom entry to every diff.
	t.deepEqual(failuresOf('● alpha\nTests: 1 failed, 1 total'), [
		{key: 'alpha', line: '● alpha'},
	]);
});

test('failuresOf: a passing summary is not a failure', t => {
	// Guards the case a case-insensitive hint would otherwise break: `0 failed`
	// and `12 passed` both contain failure words, and a green run must never
	// report one.
	for (const line of [
		'Tests: 12 passed, 0 failed, 12 total',
		'0 passed, 0 failed',
		'OK',
		'PASS',
		'0 errors, 0 warnings',
		'3 tests, 1 failure',
	]) {
		t.deepEqual(failuresOf(line), [], `${line} must yield no failures`);
	}
});

test('failuresOf: an explicitly-marked failure survives the summary guard', t => {
	// The guard only applies to the fallback path. A line a known convention
	// claims explicitly is taken at its word, even if it also looks like a
	// summary.
	t.is(failuresOf('FAILED tests/test_a.py::test_one').length, 1);
});

// ============================================================================
// Diffing
// ============================================================================

test('diffFailures: separates introduced, resolved, and persisting', t => {
	const baseline = failuresOf('● alpha\n● beta\n● gamma');
	const current = failuresOf('● alpha\n● delta');
	const diff = diffFailures(baseline, current);

	t.deepEqual(
		diff.introduced.map(f => f.key),
		['delta'],
	);
	t.deepEqual(
		diff.resolved.map(f => f.key),
		['beta', 'gamma'],
	);
	t.deepEqual(
		diff.persisting.map(f => f.key),
		['alpha'],
	);
});

test('diffFailures: a clean run resolves everything', t => {
	const diff = diffFailures(failuresOf('● alpha'), []);
	t.is(diff.introduced.length, 0);
	t.is(diff.resolved.length, 1);
	t.is(diff.persisting.length, 0);
});

test('diffFailures: an empty baseline means everything is introduced', t => {
	const diff = diffFailures([], failuresOf('● alpha\n● beta'));
	t.is(diff.introduced.length, 2);
	t.is(diff.resolved.length, 0);
});
