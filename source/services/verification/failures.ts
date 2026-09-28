/**
 * Pulling individual failures out of a test run, so two runs can be compared.
 *
 * Why not just diff the raw output: the output is for humans and models, the
 * comparison is for control flow. "Did the last fix change anything?" and "what
 * should the model be told?" both need the *set of broken tests*, which the
 * output never states directly.
 *
 * A failure needs a stable identity for that. Diffing whole lines would report
 * a test as resolved and a new one introduced whenever an assertion message
 * changes - so the model is told it fixed something it did not, and is sent to
 * chase a "new" failure that is really the same test. {@link Failure.key}
 * exists to make that impossible: the key is the test's name, and the full
 * line is kept alongside purely for display.
 *
 * The extractors are a heuristic over several runners' conventions, ordered
 * most-specific first, with a normalised-line fallback so an unrecognised
 * runner still produces usable identities rather than nothing. Getting this
 * wrong degrades the feedback; it cannot corrupt the stop rules, which use the
 * whole-run signature from `output.ts` instead.
 */

import {normalizeForSignature} from './output.js';

export interface Failure {
	/** Stable identity, used for comparison. Never shown to a model. */
	key: string;
	/** One human-readable line, used for feedback. Capped in length. */
	line: string;
}

export interface FailureDiff {
	/** Failing now, was not failing in the baseline. The actionable set. */
	introduced: Failure[];
	/** Failing in the baseline, no longer failing. */
	resolved: Failure[];
	/** Failing in both. */
	persisting: Failure[];
}

/** Above this a line stops being a label and starts being a paragraph. */
const MAX_LINE_LENGTH = 240;

/** Enough to identify a failure and say what it complained about. */
const MAX_FAILURES = 200;

/**
 * A line that reports a failure, most specific convention first.
 *
 * Each pattern exposes one capture group holding the test's identity. Order is
 * load-bearing: the pytest summary form (`FAILED path::name`) would otherwise
 * swallow the junit form, and the bare `FAIL` form would swallow both.
 */
const FAILURE_PATTERNS: RegExp[] = [
	// pytest verbose: `FAILED tests/test_x.py::test_y - AssertionError: ...`
	/^FAILED\s+(\S+)/,
	// pytest -q: `tests/test_x.py::test_y FAILED`
	/^(\S+\.py::\S+)\s+FAILED/,
	// pytest node id appearing anywhere, e.g. `ERROR tests/test_x.py::test_y`
	/(?:FAILED|ERROR)\s+(\S+\.py::\S+)/,
	// go test: `--- FAIL: TestName (0.00s)` / `    --- FAIL: Test/sub`
	/^\s*---\s+FAIL:\s+(\S+)/,
	// cargo: `test module::test_name ... FAILED` / `---- module::name stdout ----`
	/^test\s+(\S+::\S+)\s+\.\.\.\s+FAILED/,
	// jest/vitest tree: `● Suite › case` (also `● case`)
	/^●\s+(.+?)\s*$/,
	// jest/vitest summary: `FAIL src/a.test.ts > suite > case`
	/^FAIL\s+\S+\s+>\s+(.+?)\s*$/,
	// tap: `not ok 7 - description`
	/^not ok\s+\d+\s*-\s*(.+?)\s*$/,
	// dotnet test: `Failed TestName [12 ms]` / `Failed! - Failed: 1, ...`
	/^Failed\s+([\w.]+)/,
	// junit5 / gradle: `testName FAILED` and `testName > something FAILED`
	/^([\w$]+(?:\s*>\s*[\w$]+)*)\s+FAILED/,
	// generic check marks, used by many runners for the per-test row
	/^[✕✗×]\s+(.+?)\s*$/u,
];

/**
 * Words that mark a line as reporting a problem, for the fallback path.
 *
 * Case-insensitive, because a compiler diagnostic is normally lowercase
 * (`error TS2304: Cannot find name 'x'`) and a build that never compiles is one
 * of the most common reasons a run fails at all - before a single test has
 * executed.
 */
const FAILURE_HINT = /\b(?:fail(?:ed|ure|ures)?|error|exception|panic|assert)/i;

/**
 * Lines that mention failure words but are summaries, not failures.
 *
 * Checked before the hint, because the alternative is a green run reporting
 * failures: a passing suite prints `0 failed` and `12 passed`, and a failing one
 * prints `1 failed, 1 total`. Left unfiltered, the summary is extracted as a
 * second failure named after itself, which inflates every count and adds a
 * phantom entry to every diff.
 *
 * Applied only on the fallback path. A line a known convention claims
 * explicitly - `FAILED tests/test_x.py::test_y` - is taken at its word; this
 * guard exists to catch the *unrecognised* remainder, not to second-guess the
 * conventions.
 */
const SUMMARY_LINE =
	/\b\d+\s+(?:passed|failed|failures?|pending|skipped|todo|total|errors?)\b|\btests?\s*:|^\s*(?:OK|PASS|FAIL)\b/i;

/**
 * True when a line looks like it reports a failure rather than narrating.
 */
function looksLikeFailure(line: string): boolean {
	if (SUMMARY_LINE.test(line)) return false;
	return FAILURE_HINT.test(line) || /^[●✕✗×]/.test(line);
}

function truncate(line: string): string {
	return line.length <= MAX_LINE_LENGTH
		? line
		: `${line.slice(0, MAX_LINE_LENGTH - 1)}…`;
}

/**
 * The identity for a failure line, or `null` if no convention matched.
 *
 * Normalising the whole line is the fallback because it is stable enough to
 * compare runs by - it is exactly what `signatureOf` does - even though it
 * shifts if the message text changes. A wrong-but-consistent key is better than
 * a missing one, because a missing key makes the failure invisible to the diff.
 */
function keyOf(line: string): string | null {
	for (const pattern of FAILURE_PATTERNS) {
		const match = pattern.exec(line);
		if (match?.[1]) return normalizeForSignature(match[1]).trim();
	}
	return looksLikeFailure(line) ? normalizeForSignature(line).trim() : null;
}

/**
 * Extract the failures from one run, de-duplicated by key and ordered.
 *
 * Deterministic ordering is required, not cosmetic: the result is compared
 * between runs and rendered into a prompt, so a runner that changes its own
 * output order between runs must not appear to have made progress.
 */
export function failuresOf(output: string): Failure[] {
	const found = new Map<string, Failure>();

	for (const raw of output.split(/\r?\n/)) {
		const line = raw.trim();
		if (line === '') continue;

		const key = keyOf(line);
		if (key === null || key === '') continue;

		// First occurrence wins: runners print the tree node before the
		// detailed report, and the tree node is the more useful one-line label.
		if (!found.has(key)) {
			found.set(key, {key, line: truncate(line)});
		}
	}

	return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Compare a run against the baseline taken before the first edit.
 *
 * `introduced` is the only set the model is asked to act on. `resolved` and
 * `persisting` exist so the prompt can say "these were already broken" rather
 * than presenting pre-existing breakage as the model's own doing.
 */
export function diffFailures(
	baseline: readonly Failure[],
	current: readonly Failure[],
): FailureDiff {
	const baselineKeys = new Set(baseline.map(failure => failure.key));
	const currentKeys = new Set(current.map(failure => failure.key));

	return {
		introduced: current
			.filter(failure => !baselineKeys.has(failure.key))
			.slice(0, MAX_FAILURES),
		resolved: baseline
			.filter(failure => !currentKeys.has(failure.key))
			.slice(0, MAX_FAILURES),
		persisting: current
			.filter(failure => baselineKeys.has(failure.key))
			.slice(0, MAX_FAILURES),
	};
}
