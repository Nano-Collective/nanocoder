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
 * jest/vitest failure tree: `● Suite › case`, indented once per `describe`
 * level. Named so {@link NESTED_PATTERNS} can reference it by identity rather
 * than by position, which a reordered list would silently invalidate.
 */
const TREE_BULLET = /^●\s+(.+?)\s*$/;

/**
 * The per-test row several runners use, likewise indented by nesting depth.
 */
const TEST_MARK = /^[✕✗×]\s+(.+?)\s*$/u;

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
	TREE_BULLET,
	// jest/vitest summary: `FAIL src/a.test.ts > suite > case`
	/^FAIL\s+\S+\s+>\s+(.+?)\s*$/,
	// tap: `not ok 7 - description`
	/^not ok\s+\d+\s*-\s*(.+?)\s*$/,
	// dotnet test: `Failed TestName [12 ms]` / `Failed! - Failed: 1, ...`
	/^Failed\s+([\w.]+)/,
	// junit5 / gradle: `testName FAILED` and `testName > something FAILED`
	/^([\w$]+(?:\s*>\s*[\w$]+)*)\s+FAILED/,
	// generic check marks, used by many runners for the per-test row
	TEST_MARK,
];

/**
 * The subset whose hierarchy is carried by indentation.
 *
 * jest and vitest print one marker per *level* of the failure tree, so a
 * `describe` block and the case inside it are both marked. The other
 * conventions each mark exactly one line, and their indentation is layout noise
 * — treating a go test case nested under `--- FAIL:` as a container would drop
 * real failures. Membership is by pattern identity rather than by index, so
 * reordering {@link FAILURE_PATTERNS} cannot silently reclassify a convention.
 */
const NESTED_PATTERNS: readonly RegExp[] = [TREE_BULLET, TEST_MARK];

/** A failure as extracted, with the indentation its convention was found at. */
interface Candidate {
	failure: Failure;
	/** Leading whitespace width of the line the failure was extracted from. */
	indent: number;
	/** True when the convention carries its hierarchy in `indent`. */
	nested: boolean;
}

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
 * Section banners, which name a group of failures without being one.
 *
 * `=================== FAILURES ===================` and pytest's
 * `____ test_add ____` underline match the failure hint purely because the word
 * is in them. Extracted, they become phantom entries: they inflate every count
 * the model and the user are shown ("3 failures" for one broken test) and add a
 * line to the diff that never means anything.
 */
const SECTION_BANNER = /^[=_\-*~#]{3,}\s*\S|\S\s*[=_\-*~#]{3,}\s*$/;

/**
 * True when a line looks like it reports a failure rather than narrating.
 */
function looksLikeFailure(line: string): boolean {
	if (SUMMARY_LINE.test(line)) return false;
	if (SECTION_BANNER.test(line)) return false;
	return FAILURE_HINT.test(line) || /^[●✕✗×]/.test(line);
}

function truncate(line: string): string {
	return line.length <= MAX_LINE_LENGTH
		? line
		: `${line.slice(0, MAX_LINE_LENGTH - 1)}…`;
}

/**
 * Numbers that move between two runs of the *same* failure.
 *
 * Applied only to the fallback key. `normalizeForSignature` keeps bare digits on
 * purpose, because for the whole-output "did anything change" signature a moved
 * number really is a changed result. A failure *key* is different: it is an
 * identity that has to survive a re-run, and a test's own values are the least
 * stable part of its output. `assert 3 == 4` becoming `assert 5 == 4` is the
 * same test moving forward, not a new failure plus a resolved one.
 *
 * Without this, one edited assertion reports twice — once as introduced, once
 * as resolved — and the model is told it broke a test that was passing while
 * also being congratulated for fixing one it did not.
 */
const VOLATILE_NUMBER = /\b\d+(?:\.\d+)?\b/g;

/**
 * The identity for a failure line, or `null` if no convention matched.
 *
 * Normalising the whole line is the fallback because it is stable enough to
 * compare runs by *provided its volatile parts are removed* — see
 * {@link VOLATILE_NUMBER}. A wrong-but-consistent key is better than a missing
 * one, because a missing key makes the failure invisible to the diff; a key
 * that shifts between runs is worse than both, because it fabricates a
 * resolved/introduced pair out of a single failure.
 *
 * `nested` reports whether the line came from one of the per-line marker
 * conventions, whose hierarchy is expressed by indentation rather than by the
 * text. {@link dropTreeAncestors} needs that distinction.
 */
function keyOf(line: string): {key: string; nested: boolean} | null {
	for (const pattern of FAILURE_PATTERNS) {
		const match = pattern.exec(line);
		if (match?.[1]) {
			return {
				key: normalizeForSignature(match[1]).trim(),
				nested: NESTED_PATTERNS.includes(pattern),
			};
		}
	}
	if (!looksLikeFailure(line)) return null;
	return {
		key: normalizeForSignature(line).replace(VOLATILE_NUMBER, '<n>').trim(),
		nested: false,
	};
}

/**
 * Drop the container nodes of a nested failure tree.
 *
 * jest prints one bullet per *level*, not per failure:
 *
 * ```
 *   ● Arithmetic
 *     ● adds two numbers
 * ```
 *
 * Both bullets match {@link FAILURE_PATTERNS}, so a single broken test is
 * extracted as two failures. That is not cosmetic: the count is what the user
 * is shown and what the model is told to act on, and a `describe` name is not
 * something a fix can be written from. It also contradicts this module's own
 * contract that a key identifies a failure — a container is not one.
 *
 * Nesting is expressed by indentation, so a bullet is a container exactly when
 * a *later* bullet is indented deeper than it is. Document order matters: a
 * deep bullet followed by a shallower one is two siblings' worth of leaves, not
 * a parent and a child. A leaf at any depth is always kept, and a convention
 * that carries no indentation is never touched.
 */
function dropTreeAncestors(found: Map<string, Candidate>): Failure[] {
	const entries = [...found.values()];

	return entries
		.filter((candidate, index) => {
			if (!candidate.nested) return true;
			return !entries
				.slice(index + 1)
				.some(later => later.nested && later.indent > candidate.indent);
		})
		.map(candidate => candidate.failure);
}

/**
 * Extract the failures from one run, de-duplicated by key and ordered.
 *
 * Deterministic ordering is required, not cosmetic: the result is compared
 * between runs and rendered into a prompt, so a runner that changes its own
 * output order between runs must not appear to have made progress.
 */
export function failuresOf(output: string): Failure[] {
	const found = new Map<string, Candidate>();

	for (const raw of output.split(/\r?\n/)) {
		const indent = raw.length - raw.trimStart().length;
		const line = raw.trim();
		if (line === '') continue;

		const matched = keyOf(line);
		if (matched === null || matched.key === '') continue;

		const existing = found.get(matched.key);
		if (!existing) {
			// First occurrence wins for the *label*: runners print the tree node
			// before the detailed report, and the tree node is the more useful
			// one-line summary. Indentation takes the deepest sighting, so a name
			// printed both flat and nested is still judged by its deepest form.
			found.set(matched.key, {
				failure: {key: matched.key, line: truncate(line)},
				indent: matched.nested ? indent : 0,
				nested: matched.nested,
			});
			continue;
		}
		if (matched.nested && indent > existing.indent) {
			existing.indent = indent;
			existing.nested = true;
		}
	}

	return dropTreeAncestors(found).sort((a, b) => a.key.localeCompare(b.key));
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
