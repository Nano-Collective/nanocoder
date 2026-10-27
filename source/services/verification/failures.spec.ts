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

// ---------------------------------------------------------------------------
// Nested failure trees
//
// jest and vitest mark every *level* of the tree, so a `describe` block and the
// case inside it are both marked. Both match a convention, so without a
// container rule one broken test is counted as two - and the extra entry is a
// name no fix can be written from.
// ---------------------------------------------------------------------------

test('failuresOf: a describe block is not a failure alongside its case', t => {
	// The regression: this is jest's real shape for a single broken test, and
	// it counted as two.
	const output = [
		'FAIL  src/a.test.ts',
		'  ● Arithmetic',
		'    ● adds two numbers',
		'',
		'      expect(received).toBe(expected)',
		'',
		'Test Suites: 1 failed, 1 passed, 2 total',
		'Tests:       1 failed, 3 passed, 4 total',
	].join('\n');

	t.deepEqual(failuresOf(output), [
		{key: 'adds two numbers', line: '● adds two numbers'},
	]);
});

test('failuresOf: sibling cases under one describe are all kept', t => {
	// The guard on the test above. A container rule that dropped the whole
	// subtree instead of the container would silently hide real failures, which
	// is worse than the inflation it fixes.
	t.deepEqual(
		failuresOf(
			[
				'  ● Arithmetic',
				'    ● adds two numbers',
				'    ● subtracts two numbers',
			].join('\n'),
		).map(f => f.key),
		['adds two numbers', 'subtracts two numbers'],
	);
});

test('failuresOf: a deeper leaf does not swallow a later shallower sibling', t => {
	// Nesting is read in document order. `Outer` is a container because
	// something after it is deeper; `Flat` is a leaf because nothing after it is.
	t.deepEqual(
		failuresOf(['  ● Outer', '      ● deep leaf', '  ● Flat'].join('\n')).map(
			f => f.key,
		),
		['deep leaf', 'Flat'],
	);
});

test('failuresOf: indentation outside a tree convention is not nesting', t => {
	// The guard on all of the above. go test indents subtests under their
	// parent, but its `--- FAIL:` convention marks exactly one line each, so
	// treating indentation as a container signal there would delete real
	// failures from the report.
	t.deepEqual(
		failuresOf(
			[
				'--- FAIL: TestAlpha (0.00s)',
				'    --- FAIL: TestAlpha/sub (0.00s)',
				'    --- FAIL: TestAlpha/other (0.00s)',
			].join('\n'),
		).map(f => f.key),
		['TestAlpha', 'TestAlpha/other', 'TestAlpha/sub'],
	);
});

test('failuresOf: a lone marked line is a leaf, not a container', t => {
	t.deepEqual(failuresOf('● only one'), [
		{key: 'only one', line: '● only one'},
	]);
});

test('failuresOf: a section banner is not a failure in its own right', t => {
	// pytest prints `=================== FAILURES ===================` and
	// underlines each test with `____ test_add ____`. Both match the failure
	// hint only because the word is in them; extracted, they become phantom
	// entries that inflate every count and every diff.
	t.deepEqual(
		failuresOf(
			'=================== FAILURES ===================\n____ test_add ____\nFAILED tests/test_a.py::test_add',
		),
		[{key: 'tests/test_a.py::test_add', line: 'FAILED tests/test_a.py::test_add'}],
	);
});

// ---------------------------------------------------------------------------
// Two rows, one test
//
// jest and vitest report a failing case twice, at two granularities: once in
// the summary tree (`✕ case`) and once in the detail tree with its full suite
// path (`● Suite › case`). The keys differ, so de-duplication by key does not
// catch it and every broken test is counted twice.
// ---------------------------------------------------------------------------

test('failuresOf: a case reported in both trees is one failure', t => {
	// Verbatim shape of a real jest run with one broken test.
	const output = [
		' FAIL  src/math.test.ts',
		'  Arithmetic',
		'    ✓ adds two numbers (1 ms)',
		'    ✕ subtracts two numbers (3 ms)',
		'',
		'  ● Arithmetic › subtracts two numbers',
		'',
		'    expect(received).toBe(expected)',
		'',
		'Tests:       1 failed, 1 passed, 2 total',
	].join('\n');

	t.deepEqual(failuresOf(output), [
		{
			key: 'Arithmetic › subtracts two numbers',
			line: '● Arithmetic › subtracts two numbers',
		},
	]);
});

test('failuresOf: the joined-path key survives the fold, the bare one does not', t => {
	// The longer key is the identity worth keeping: it names the suite as well
	// as the case, so the model is told where to look.
	t.deepEqual(
		failuresOf(
			['  ✕ case', '  ● Outer › Inner › case', 'Tests: 1 failed, 1 total'].join(
				'\n',
			),
		).map(f => f.key),
		['Outer › Inner › case'],
	);
});

test('failuresOf: folding one tree does not touch a runner with one hierarchy', t => {
	// The guard on both of the above. `TestAlpha/sub` is a single convention
	// reporting a single failure — the path *is* the test's name, not a
	// container joined to a case — so folding on `/` would delete it.
	t.deepEqual(
		failuresOf(
			['--- FAIL: TestAlpha (0.00s)', '    --- FAIL: TestAlpha/sub (0.00s)'].join(
				'\n',
			),
		).map(f => f.key),
		['TestAlpha', 'TestAlpha/sub'],
	);
});

test('failuresOf: two cases in one suite are both kept', t => {
	t.deepEqual(
		failuresOf(
			[
				'  ✕ subtracts two numbers',
				'  ✕ divides evenly',
				'  ● Arithmetic › subtracts two numbers',
				'  ● Arithmetic › divides evenly',
			].join('\n'),
		).map(f => f.key),
		['Arithmetic › divides evenly', 'Arithmetic › subtracts two numbers'],
	);
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
