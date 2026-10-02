/**
 * The auto-fix loop's brain: given a verification result, decide whether to ask
 * the model to fix it, stop, or call it done.
 *
 * This is deliberately a pure state machine with no I/O. Everything that could
 * make a loop misbehave - unbounded retries, a feedback loop where the model
 * cannot see progress, a broken command re-run at full cost - is decided here
 * where it can be tested exhaustively. The caller only runs commands and
 * forwards text.
 *
 * Two different comparisons are used, for two different jobs, and conflating
 * them is the main way this kind of loop goes wrong:
 *
 *  - **Baseline diff** (against the run before the first edit) shapes the
 *    *feedback*. Without it the model is asked to fix tests that were already
 *    red before it touched anything, and will rewrite unrelated code to
 *    "fix" them.
 *  - **Attempt-to-attempt comparison** drives the *stop rules*. Only a
 *    whole-run fingerprint can answer "did the last fix change anything?",
 *    and a diff tuned for feedback is the wrong instrument for that: it
 *    normalises away exactly the incidental variation a no-progress check has
 *    to see through.
 */

import {diffFailures, type Failure, failuresOf} from './failures.js';
import {signatureOf} from './output.js';
import type {VerificationRunResult} from './runner.js';

/**
 * Why the loop stopped. Every value is something a user can act on, so a bare
 * boolean would discard the one piece of information that explains a
 * surprising end to a run. A passing run is not here: it ends the loop
 * successfully, which is a different decision rather than a failed one.
 */
export type StopReason =
	| 'attempts-exhausted'
	| 'no-progress'
	| 'regression'
	| 'no-failures-reported'
	| 'command-unavailable'
	| 'timed-out'
	| 'aborted';

export interface FailureDelta {
	/** Failing now and not in the baseline. The actionable set. */
	introduced: Failure[];
	/** Failing in the baseline and no longer failing. */
	resolved: Failure[];
	/** Failing in both. */
	persisting: Failure[];
}

export type VerificationDecision =
	| {action: 'done'; status: 'passed'; attempts: number}
	| {
			action: 'feedback';
			attempts: number;
			attemptsRemaining: number;
			diff: FailureDelta;
			/** False when no pre-edit baseline was taken; the diff is then empty. */
			hasBaseline: boolean;
			/**
			 * Failures this attempt added that the previous attempt did not have.
			 * Not a stop reason on its own - reported so the model knows it broke
			 * something, and so the caller can see the loop making things worse.
			 */
			regressed: Failure[];
	  }
	| {action: 'stop'; reason: StopReason; attempts: number; detail?: string};

export interface VerificationState {
	/**
	 * Result of the run taken before the first edit, or `null` until one is.
	 * Set once and never replaced - see {@link recordBaseline}.
	 */
	baseline: VerificationRunResult | null;
	/** How many results have been judged. `0` before the first. */
	attempts: number;
	/** Signature of the previously judged result, for the no-progress check. */
	previousSignature: string | null;
	/** Failures of the previously judged result, for the regression check. */
	previousFailures: readonly Failure[];
}

export interface DecideOptions {
	/**
	 * Maximum results to judge, including the first. `1` therefore means "run it
	 * and report, never retry" - the safe default for a feature that is new.
	 */
	maxAttempts: number;
}

export function createVerificationState(): VerificationState {
	return {
		baseline: null,
		attempts: 0,
		previousSignature: null,
		previousFailures: [],
	};
}

/**
 * Record the pre-edit run.
 *
 * First write wins, permanently. A later call cannot overwrite the baseline
 * because the moment it is replaced is the moment the loop loses the ability to
 * tell its own damage from the repository's starting state - a baseline
 * captured after a partial fix reports every pre-existing failure as new.
 *
 * Returns the same object when a baseline is already set, so calling this on
 * every edit is free and harmless.
 */
export function recordBaseline(
	state: VerificationState,
	result: VerificationRunResult,
): VerificationState {
	if (state.baseline !== null) return state;
	return {...state, baseline: result};
}

export function hasBaseline(state: VerificationState): boolean {
	return state.baseline !== null;
}

/**
 * Judge one result and advance the state.
 *
 * `maxAttempts` counts judged results, not retries after the first, so
 * `maxAttempts: 3` permits one verification plus two fixes: the first result
 * lands on `attempts === 1` with `maxAttempts - 1` fixes remaining.
 */
export function decideNextAction(
	state: VerificationState,
	result: VerificationRunResult,
	options: DecideOptions,
): {decision: VerificationDecision; state: VerificationState} {
	const attempts = state.attempts + 1;
	const currentFailures = failuresOf(result.output);
	const signature = signatureOf(result.output);

	// Statuses that are not about the code. None becomes more fixable by being
	// repeated, and each has to be explained rather than retried:
	//
	//  - `unavailable` is nearly always a typo or a missing tool. Retrying
	//    re-reads the same "not found" and re-bills the model for it.
	//  - `timeout` says the run did not finish, so there is no failure output to
	//    act on. A model handed a truncated run tends to invent fixes for
	//    failures it never saw.
	//  - `aborted` is the user changing their mind; answering that by starting
	//    another run is the worst available response.
	//
	// The attempt is still counted - a run was paid for - but the comparison
	// point is deliberately left untouched. A run that produced no evidence
	// about the code is not something the next run can be measured against, and
	// treating it as a baseline makes the next genuine failure look like a
	// regression on its very first appearance.
	if (result.status !== 'passed' && result.status !== 'failed') {
		return {
			decision: stopForUnfixable(result, attempts),
			state: {...state, attempts},
		};
	}

	// The judgement is recorded even when the loop stops, so the attempt count
	// a user is shown matches the number of runs actually paid for.
	const advanced: VerificationState = {
		...state,
		attempts,
		previousSignature: signature,
		previousFailures: currentFailures,
	};

	if (result.status === 'passed') {
		return {
			decision: {action: 'done', status: 'passed', attempts},
			state: advanced,
		};
	}

	// A failed run reporting no extractable failure. Overwhelmingly a compile or
	// configuration error: the suite never reached a test. There is nothing to
	// diff against the baseline, so there is no actionable set, and asking the
	// model to fix an unnamed failure is guesswork. Report and stop.
	if (currentFailures.length === 0) {
		return {
			decision: {
				action: 'stop',
				reason: 'no-failures-reported',
				attempts,
				detail:
					'The verification command failed without reporting any test failure. ' +
					'The output is most likely a compile or configuration error.',
			},
			state: advanced,
		};
	}

	// Nothing to compare against on the first attempt, so it can be neither a
	// stall nor a regression. Deriving both from one flag keeps the two rules
	// from drifting apart.
	const isFirstAttempt = state.previousSignature === null;

	// No-progress: the previous edit changed nothing observable. Checked before
	// the attempt budget so a model repeating itself is stopped immediately
	// rather than after the full allowance. On the first attempt there is no
	// previous signature, which also stops the common case of a pre-existing
	// failure - whose signature may well equal the baseline's - from being
	// misread as a loop that has stalled.
	if (!isFirstAttempt && state.previousSignature === signature) {
		return {
			decision: {
				action: 'stop',
				reason: 'no-progress',
				attempts,
				detail:
					'The last fix left the failure output unchanged. Repeating the same ' +
					'fix is unlikely to help.',
			},
			state: advanced,
		};
	}

	// Empty on the first attempt. Without that, every failure reads as newly
	// introduced by the model's last change and the prompt opens by accusing it
	// of breaking tests it never had a chance to run.
	const regressed = isFirstAttempt
		? []
		: introducedBy(currentFailures, state.previousFailures);

	// Regression is only a stop when it is *pure* breakage: new failures
	// appeared and nothing was fixed. A run that both resolves one failure and
	// introduces another is chasing a genuine chain - a lazily-imported module,
	// an ordering dependency - and stopping it would abandon real progress.
	//
	// Compared against the previous attempt, never the baseline: on the first
	// attempt every failure is new relative to a clean baseline, and treating
	// that as a regression would end every run before it began.
	if (regressed.length > 0) {
		const resolvedSinceLast = introducedBy(
			state.previousFailures,
			currentFailures,
		);
		if (resolvedSinceLast.length === 0) {
			return {
				decision: {
					action: 'stop',
					reason: 'regression',
					attempts,
					detail:
						`The last fix introduced ${regressed.length} new failure(s) and ` +
						'fixed none, so the change is making things worse.',
				},
				state: advanced,
			};
		}
	}

	if (attempts >= options.maxAttempts) {
		return {
			decision: {action: 'stop', reason: 'attempts-exhausted', attempts},
			state: advanced,
		};
	}

	// With no baseline there is nothing to diff against, so the model is shown
	// the current failures in full rather than an empty "nothing introduced",
	// which it would read as "there is nothing to fix".
	const diff =
		state.baseline === null
			? {introduced: currentFailures, resolved: [], persisting: []}
			: diffFailures(failuresOf(state.baseline.output), currentFailures);

	return {
		decision: {
			action: 'feedback',
			attempts,
			attemptsRemaining: options.maxAttempts - attempts,
			diff,
			hasBaseline: state.baseline !== null,
			regressed,
		},
		state: advanced,
	};
}

function stopForUnfixable(
	result: VerificationRunResult,
	attempts: number,
): VerificationDecision {
	switch (result.status) {
		case 'unavailable':
			return {
				action: 'stop',
				reason: 'command-unavailable',
				attempts,
				detail: result.spawnError,
			};
		case 'timeout':
			return {
				action: 'stop',
				reason: 'timed-out',
				attempts,
				detail: `The verification command did not finish in time.`,
			};
		default:
			return {action: 'stop', reason: 'aborted', attempts};
	}
}

function introducedBy(
	candidate: readonly Failure[],
	reference: readonly Failure[],
): Failure[] {
	const keys = new Set(reference.map(failure => failure.key));
	return candidate.filter(failure => !keys.has(failure.key));
}
