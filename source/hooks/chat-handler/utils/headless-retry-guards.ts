import type {RetryLimitsConfig} from '@/types/config';
import type {ToolCall} from '@/types/core';
import {computeToolCallSignature} from './tool-signature';

// Sent after a turn the provider truncated at its output-token limit. The
// partial reply is already in the history above this, so the model can see
// where it was cut off. The explicit steer away from re-explaining exists
// because the commonest way to spend a whole output budget without finishing
// is narrating analysis that was only ever meant to end in a tool call.
export const TRUNCATED_TURN_INSTRUCTION =
	'Your previous reply was cut off at the output-token limit before it ' +
	'finished. Continue from exactly where it stopped. Do not repeat or ' +
	'summarise what you already wrote, and keep any remaining explanation ' +
	'brief. If the task requires a tool call to be complete, make that call ' +
	'now rather than describing what it would do.';

/** Sent after a turn with no text and no tool calls. */
export const EMPTY_TURN_NUDGE = 'Please continue with the task.';

/** The correction sent back after a malformed text tool call. */
export function malformedToolCallNudge(
	error: string,
	examples: string,
): string {
	return `Your previous response contained a malformed tool call. ${error}\n\n${examples}\n\nPlease try again using the correct format.`;
}

/** What a guard decided about one failing turn. */
export type RetryGuardVerdict =
	| {action: 'retry'; attempt: number}
	| {action: 'stop'; message: string};

/**
 * The `nanocoder.retries` caps for a loop with nobody to ask (`--plain`, ACP):
 * consecutive identical tool calls, consecutive empty turns, malformed
 * tool-call retries and truncated-turn continuations. Each kind of failing
 * turn counts its own streak and resets the others; hitting a cap stops the
 * run with the message to show, where the interactive loop would ask.
 */
export function createHeadlessRetryGuards(limits: RetryLimitsConfig) {
	const {
		maxRepeatedToolCalls,
		maxEmptyTurns,
		maxMalformedRetries,
		maxTruncatedTurns,
	} = limits;
	let emptyTurnCount = 0;
	let malformedRetryCount = 0;
	let truncatedTurnCount = 0;
	let lastToolSignature = '';
	let repeatedToolCallCount = 0;
	// The whole consecutive-repeat streak, which a granted window does not
	// reset, so a message about it reports the true count.
	let repeatedToolCallTotal = 0;

	const resetToolStreak = () => {
		lastToolSignature = '';
		repeatedToolCallCount = 0;
		repeatedToolCallTotal = 0;
	};

	return {
		/**
		 * Count a turn's tool calls against the repeated-call streak. Returns the
		 * stop message when the cap is hit, null otherwise. Call it for turns
		 * with rejected (unknown) calls too: a model stuck re-emitting the same
		 * nonexistent tool is looping just as surely.
		 */
		toolCalls(turnToolCalls: ToolCall[]): string | null {
			const signature = computeToolCallSignature(turnToolCalls);
			const isRepeat = Boolean(signature) && signature === lastToolSignature;
			const repeated = isRepeat ? repeatedToolCallCount + 1 : 1;
			repeatedToolCallTotal = isRepeat ? repeatedToolCallTotal + 1 : 1;
			if (repeated >= maxRepeatedToolCalls) {
				return `Model repeated the same tool call ${repeated} times in a row without making progress — stopping to avoid a loop (nanocoder.retries.maxRepeatedToolCalls = ${maxRepeatedToolCalls}).`;
			}
			lastToolSignature = signature;
			repeatedToolCallCount = repeated;
			emptyTurnCount = 0;
			malformedRetryCount = 0;
			return null;
		},

		/** Consecutive identical tool-call turns so far, across granted windows. */
		repeatedToolCallTotal(): number {
			return repeatedToolCallTotal;
		},

		/**
		 * Someone chose to let a repeated call through at the cap (the
		 * interactive prompt). The streak's window starts again, so the next
		 * `maxRepeatedToolCalls` identical calls are allowed before asking again;
		 * the total keeps counting.
		 */
		grantRepeatWindow(): void {
			repeatedToolCallCount = 0;
			emptyTurnCount = 0;
			malformedRetryCount = 0;
		},

		/** Start every streak again, as after a compaction or a fresh nudge. */
		reset(): void {
			emptyTurnCount = 0;
			malformedRetryCount = 0;
			truncatedTurnCount = 0;
			resetToolStreak();
		},

		/** A turn whose text tool calls could not be parsed. */
		malformed(): RetryGuardVerdict {
			if (malformedRetryCount >= maxMalformedRetries) {
				return {
					action: 'stop',
					message: `Model produced malformed tool calls ${maxMalformedRetries + 1} time${maxMalformedRetries === 0 ? '' : 's'} in a row and cannot self-correct — stopping (nanocoder.retries.maxMalformedRetries = ${maxMalformedRetries}).`,
				};
			}
			malformedRetryCount += 1;
			emptyTurnCount = 0;
			resetToolStreak();
			return {action: 'retry', attempt: malformedRetryCount};
		},

		/** A turn with no text and no tool calls. */
		empty(): RetryGuardVerdict {
			if (emptyTurnCount >= maxEmptyTurns) {
				const attempts = maxEmptyTurns + 1;
				return {
					action: 'stop',
					message: `Model produced no output after ${attempts} attempt${attempts === 1 ? '' : 's'} — stopping (nanocoder.retries.maxEmptyTurns = ${maxEmptyTurns}).`,
				};
			}
			emptyTurnCount += 1;
			malformedRetryCount = 0;
			resetToolStreak();
			return {action: 'retry', attempt: emptyTurnCount};
		},

		/**
		 * A text-only turn the provider cut off at its output-token limit. The
		 * stop message says the run gives up continuing; the fragment is then
		 * the answer.
		 */
		truncated(): RetryGuardVerdict {
			if (truncatedTurnCount < maxTruncatedTurns) {
				truncatedTurnCount += 1;
				emptyTurnCount = 0;
				malformedRetryCount = 0;
				resetToolStreak();
				return {action: 'retry', attempt: truncatedTurnCount};
			}
			return {
				action: 'stop',
				message: `response truncated at the output limit after ${maxTruncatedTurns} continuation${maxTruncatedTurns === 1 ? '' : 's'} — stopping`,
			};
		},
	};
}
