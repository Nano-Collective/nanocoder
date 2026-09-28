import test from 'ava';
import {formatFeedback, formatStop} from './feedback.js';
import type {VerificationRunResult, VerificationStatus} from './runner.js';
import {
	createVerificationState,
	decideNextAction,
	hasBaseline,
	recordBaseline,
	type VerificationDecision,
} from './verifier.js';

function result(
	status: VerificationStatus,
	output = '',
	extra: Partial<VerificationRunResult> = {},
): VerificationRunResult {
	return {
		status,
		exitCode: status === 'passed' ? 0 : 1,
		signal: null,
		durationMs: 100,
		output,
		truncated: false,
		...extra,
	};
}

/** A run reporting exactly `names` as failing, plus a realistic summary line. */
function fails(names: readonly string[]): VerificationRunResult {
	return result(
		'failed',
		`${names.map(name => `● ${name}`).join('\n')}\n` +
			`Tests: ${names.length} failed, ${names.length} total`,
	);
}

const passes = () => result('passed', 'Tests: 3 passed, 3 total');

/** Judge a sequence of results, threading state through as a caller would. */
function judge(
	results: VerificationRunResult[],
	{
		maxAttempts = 3,
		baseline = null as VerificationRunResult | null,
	} = {},
): VerificationDecision[] {
	let state = createVerificationState();
	if (baseline) state = recordBaseline(state, baseline);

	const decisions: VerificationDecision[] = [];
	for (const item of results) {
		const outcome = decideNextAction(state, item, {maxAttempts});
		state = outcome.state;
		decisions.push(outcome.decision);
	}
	return decisions;
}

function feedback(
	decision: VerificationDecision,
): Extract<VerificationDecision, {action: 'feedback'}> {
	if (decision.action !== 'feedback') {
		throw new Error(`expected feedback, got ${decision.action}`);
	}
	return decision;
}

function stop(
	decision: VerificationDecision,
): Extract<VerificationDecision, {action: 'stop'}> {
	if (decision.action !== 'stop') {
		throw new Error(`expected stop, got ${decision.action}`);
	}
	return decision;
}

// ============================================================================
// Terminal statuses
// ============================================================================

test('a pass is done, first time', t => {
	const [decision] = judge([passes()]);
	t.is(decision.action, 'done');
	t.is(decision.action === 'done' ? decision.attempts : -1, 1);
});

test('a pass after a failure is done', t => {
	const decisions = judge([fails(['alpha']), passes()]);
	t.is(decisions[0].action, 'feedback');
	t.is(decisions[1].action, 'done');
});

test('a missing command is never retried', t => {
	// The expensive mistake: a typo re-reads "not found" and re-bills the model
	// on every attempt, producing identical output the whole way.
	const decisions = judge([
		result('unavailable', '', {spawnError: 'nope: not found'}),
		fails(['alpha']),
		fails(['alpha']),
	]);
	t.is(stop(decisions[0]).reason, 'command-unavailable');
	t.is(stop(decisions[0]).detail, 'nope: not found');
	t.is(decisions[1].action, 'feedback', 'a later real result is judged normally');
	t.is(
		stop(decisions[2]).reason,
		'no-progress',
		'the two real runs are compared with each other, not with the dead one',
	);
});

test('a timeout is not retried', t => {
	// There is no failure output to act on, and a model handed a truncated run
	// invents fixes for failures it never saw.
	t.is(stop(judge([result('timeout', 'partial')])[0]).reason, 'timed-out');
});

test('an abort is not overridden', t => {
	t.is(stop(judge([result('aborted')])[0]).reason, 'aborted');
});

test('a failure reporting no test stops rather than guessing', t => {
	// A script that exits non-zero silently: no actionable set exists, so asking
	// the model to fix an unnamed failure is guesswork.
	const decision = judge([result('failed', 'process exited with code 1')])[0];
	t.is(stop(decision).reason, 'no-failures-reported');
});

// ============================================================================
// The attempt budget
// ============================================================================

test('maxAttempts counts results, not retries', t => {
	// 3 means one verification plus two fixes. Each step swaps one failure for
	// another, so it always resolves something and only the budget can stop it.
	const decisions = judge([fails(['a']), fails(['b']), fails(['c'])], {
		maxAttempts: 3,
	});
	t.is(decisions[0].action, 'feedback');
	t.is(decisions[1].action, 'feedback');
	t.is(stop(decisions[2]).reason, 'attempts-exhausted');
});

test('maxAttempts of 1 reports without retrying', t => {
	t.is(stop(judge([fails(['a'])], {maxAttempts: 1})[0]).reason, 'attempts-exhausted');
});

test('attemptsRemaining counts down', t => {
	const decisions = judge([fails(['a']), fails(['b'])], {maxAttempts: 3});
	t.is(feedback(decisions[0]).attemptsRemaining, 2);
	t.is(feedback(decisions[1]).attemptsRemaining, 1);
});

test('the attempt count is honest about runs paid for', t => {
	t.is(stop(judge([fails(['a']), fails(['a'])], {maxAttempts: 5})[1]).attempts, 2);
});

// ============================================================================
// No-progress
// ============================================================================

test('an identical failure set stops immediately', t => {
	// Checked before the budget, so a model repeating itself costs one extra run
	// rather than the whole allowance.
	t.is(
		stop(judge([fails(['alpha']), fails(['alpha'])], {maxAttempts: 5})[1]).reason,
		'no-progress',
	);
});

test('incidental variation does not count as progress', t => {
	// Durations, totals, and line ordering change between runs of identical
	// code. If they counted as progress the no-progress rule could never fire
	// and every loop would burn its full budget.
	const first = result('failed', '● alpha\nTests: 1 failed, 1 total in 0.842s');
	const second = result('failed', 'Tests: 1 failed, 1 total in 1.9s\n● alpha');
	t.is(stop(judge([first, second], {maxAttempts: 5})[1]).reason, 'no-progress');
});

test('the first attempt cannot be no-progress', t => {
	// Its signature can equal the baseline's for a pre-existing failure, and
	// stopping there would kill every run before it began.
	const [decision] = judge([fails(['alpha'])], {
		baseline: fails(['alpha']),
		maxAttempts: 5,
	});
	t.is(decision.action, 'feedback');
});

test('a real change is progress', t => {
	t.is(judge([fails(['a']), fails(['b'])], {maxAttempts: 5})[1].action, 'feedback');
});

// ============================================================================
// Regression
// ============================================================================

test('breaking something while fixing nothing stops the loop', t => {
	// Pure additive breakage: the previous failure is still there and a new one
	// joined it, so the change is strictly worse.
	const decision = judge([fails(['alpha', 'beta']), fails(['alpha', 'beta', 'gamma'])], {
		maxAttempts: 5,
	})[1];
	t.is(stop(decision).reason, 'regression');
	t.regex(decision.detail ?? '', /making things worse/);
});

test('swapping one failure for another is a chain, not a regression', t => {
	// Resolving one while introducing one is the model working through a real
	// dependency (a lazy import, an ordering constraint). Stopping here would
	// abandon genuine progress.
	t.is(judge([fails(['alpha']), fails(['beta'])], {maxAttempts: 5})[1].action, 'feedback');
});

test('fixing one and breaking another is still progress', t => {
	t.is(
		judge([fails(['alpha', 'beta'])], {maxAttempts: 5})[0].action,
		'feedback',
		'sanity: the first attempt is always safe',
	);
	t.is(
		judge([fails(['alpha', 'beta']), fails(['beta', 'gamma'])], {maxAttempts: 5})[1]
			.action,
		'feedback',
	);
});

test('the first attempt is never a regression', t => {
	// Against a clean baseline every failure is new. Treating that as a
	// regression would end every run before it began.
	const [decision] = judge([fails(['alpha', 'beta'])], {
		baseline: passes(),
		maxAttempts: 5,
	});
	t.is(decision.action, 'feedback');
});

// ============================================================================
// Baseline
// ============================================================================

test('the first baseline wins and cannot be replaced', t => {
	// Replacing it with a half-fixed run reports every pre-existing failure as
	// newly introduced, which is the failure mode the baseline exists to stop.
	let state = createVerificationState();
	state = recordBaseline(state, passes());
	const first = state;
	state = recordBaseline(state, fails(['alpha']));

	t.is(state.baseline, first.baseline, 'the original result object is kept');
	t.true(hasBaseline(state));
});

test('a later recordBaseline call is free and harmless', t => {
	const withBaseline = recordBaseline(createVerificationState(), passes());
	t.is(recordBaseline(withBaseline, fails(['alpha'])), withBaseline);
});

test('a pre-existing failure is not presented as introduced', t => {
	// The single most important feedback property. Without it the model is told
	// to fix a test that was red before it started, and rewrites unrelated code.
	const feedbackDecision = feedback(
		judge([fails(['alpha'])], {baseline: fails(['alpha']), maxAttempts: 5})[0],
	);
	t.is(feedbackDecision.diff.introduced.length, 0);
	t.is(feedbackDecision.diff.persisting.length, 1);
});

test('only the new failure is presented as introduced', t => {
	const decision = feedback(
		judge([fails(['alpha', 'beta'])], {
			baseline: fails(['alpha']),
			maxAttempts: 5,
		})[0],
	);
	t.deepEqual(
		decision.diff.introduced.map(f => f.key),
		['beta'],
	);
	t.deepEqual(
		decision.diff.persisting.map(f => f.key),
		['alpha'],
	);
});

test('with no baseline everything is shown, not "nothing introduced"', t => {
	// An empty diff reads as "there is nothing to fix", which would end the
	// loop silently - the worst available interpretation.
	const decision = feedback(judge([fails(['alpha', 'beta'])], {maxAttempts: 5})[0]);
	t.false(decision.hasBaseline);
	t.is(decision.diff.introduced.length, 2);
});

test('a fixed pre-existing failure is acknowledged', t => {
	// Without this the model is never told its fix worked, and the reward for
	// the behaviour we want is missing.
	const decision = feedback(
		judge([fails(['beta'])], {baseline: fails(['alpha']), maxAttempts: 5})[0],
	);
	t.is(decision.diff.resolved.length, 1);
});

// ============================================================================
// Feedback text
// ============================================================================

test('labels pre-existing failures as not the model`s doing', t => {
	const text = formatFeedback(
		feedback(
			judge([fails(['alpha', 'beta'])], {
				baseline: fails(['alpha']),
				maxAttempts: 3,
			})[0],
		),
		'raw output',
	);
	t.regex(text, /were introduced by your changes/);
	t.regex(text, /not yours to fix/);
	t.regex(text, /attempt 1 of 3/);
	t.regex(text, /2 more attempt/);
});

test('the first attempt is not accused of breaking anything', t => {
	// There is no previous attempt to have broken things relative to, so
	// reporting regressions here would open every prompt with a false accusation.
	const text = formatFeedback(
		feedback(judge([fails(['alpha', 'beta'])], {maxAttempts: 3})[0]),
		'out',
	);
	t.notRegex(text, /also broke/);
});

test('says so when nothing was introduced', t => {
	const text = formatFeedback(
		feedback(
			judge([fails(['alpha'])], {baseline: fails(['alpha']), maxAttempts: 5})[0],
		),
		'raw output',
	);
	t.regex(text, /No new failures were introduced/);
	t.notRegex(text, /were introduced by your changes/);
});

test('includes the output verbatim', t => {
	// The extracted lines are a heuristic for orientation; the fix is written
	// from the real stack trace.
	const text = formatFeedback(
		feedback(judge([fails(['alpha'])], {maxAttempts: 5})[0]),
		'the raw stack trace',
	);
	t.regex(text, /```\nthe raw stack trace\n```/);
});

test('warns when the last change broke something', t => {
	const decisions = judge([fails(['alpha', 'beta']), fails(['beta', 'gamma'])], {
		maxAttempts: 3,
	});
	t.is(decisions[1].action, 'feedback');
	t.regex(formatFeedback(feedback(decisions[1]), 'out'), /also broke a test/);
});

test('the final allowed attempt is called the last one', t => {
	// A model told only "tests are failing" keeps trying; one told it has no
	// retry left makes that attempt count.
	const text = formatFeedback(
		feedback(judge([fails(['a']), fails(['b'])], {maxAttempts: 3})[1]),
		'out',
	);
	t.regex(text, /This is your last attempt/);
});

test('every stop reason has an explanation', t => {
	for (const reason of [
		'attempts-exhausted',
		'no-progress',
		'regression',
		'no-failures-reported',
		'command-unavailable',
		'timed-out',
		'aborted',
	] as const) {
		t.true(
			formatStop({action: 'stop', reason, attempts: 1}).length > 10,
			`${reason} needs an explanation`,
		);
	}
});

test('a stop detail is appended, not swallowed', t => {
	const text = formatStop({
		action: 'stop',
		reason: 'command-unavailable',
		attempts: 1,
		detail: 'npx: not found',
	});
	t.regex(text, /npx: not found/);
});
