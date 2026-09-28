/**
 * Rendering a loop decision into text.
 *
 * Separate from `verifier.ts` so the decision logic stays a testable pure
 * function of inputs, with no opinions about prose. The formatting rules that
 * matter are here, and each one exists because its absence actively misleads:
 *
 *  - Pre-existing failures are labelled as pre-existing. Presented as new, the
 *    model rewrites unrelated code to "fix" tests that were red before it
 *    started.
 *  - The attempt count is always stated. A model told "tests are failing" with
 *    no remaining-allowance will keep trying; one told it has one attempt left
 *    will make that attempt count.
 *  - The output is included verbatim. The extracted failure lines are a
 *    heuristic and are for orientation; the real stack trace is what a correct
 *    fix is written from.
 */

import type {Failure} from './failures.js';
import type {StopReason, VerificationDecision} from './verifier.js';

/** Beyond this the list stops guiding and starts crowding out the output. */
const MAX_LISTED = 20;

const STOP_EXPLANATIONS: Record<StopReason, string> = {
	'attempts-exhausted':
		'The verification command is still failing and the retry limit was reached.',
	'no-progress':
		'The verification command is still failing, and the last fix did not change the failure output.',
	regression:
		'The verification command is failing worse than before, so the loop stopped rather than spending more attempts.',
	'no-failures-reported':
		'The verification command failed without reporting a test failure.',
	'command-unavailable':
		'The verification command could not be run, so its result is not evidence about the change.',
	'timed-out': 'The verification command did not finish in time.',
	aborted: 'The verification command was cancelled.',
};

/**
 * The text handed to the model when the loop asks for another fix.
 *
 * Returns `null` for every other decision, so a caller can pass the result
 * straight through: only a `feedback` decision produces prompt text.
 */
export function formatFeedback(
	decision: Extract<VerificationDecision, {action: 'feedback'}>,
	output: string,
): string {
	const {diff, attempts, attemptsRemaining, hasBaseline, regressed} = decision;

	const parts: string[] = [
		`The verification command failed (attempt ${attempts} of ` +
			`${attempts + attemptsRemaining}).`,
	];

	if (regressed.length > 0) {
		parts.push(
			`Your last change also broke ${
				regressed.length === 1 ? 'a test' : `${regressed.length} tests`
			} that ${regressed.length === 1 ? 'was' : 'were'} passing.`,
		);
	}

	// "Nothing was introduced" is only reassuring next to the pre-existing
	// list, so both are emitted together or neither.
	if (hasBaseline) {
		if (diff.introduced.length === 0) {
			parts.push(
				`No new failures were introduced; the ${
					diff.persisting.length
				} failure(s) below were already failing before you made any changes.`,
			);
		} else {
			parts.push(
				`${diff.introduced.length} failure(s) were introduced by your changes:`,
			);
			parts.push(...formatList(diff.introduced));
			if (diff.persisting.length > 0) {
				parts.push(
					`These ${diff.persisting.length} failure(s) were already failing before ` +
						'you started and are not yours to fix:',
				);
				parts.push(...formatList(diff.persisting, '  - '));
			}
		}
		if (diff.resolved.length > 0) {
			parts.push(
				`You fixed ${diff.resolved.length} pre-existing failure(s). Keep them fixed.`,
			);
		}
	} else {
		parts.push('Failing:');
		parts.push(...formatList(diff.introduced));
	}

	parts.push(
		attemptsRemaining <= 1
			? 'This is your last attempt at fixing this.'
			: `You have ${attemptsRemaining} more attempt(s) after this one.`,
	);

	parts.push('Verification output:');
	parts.push('```');
	parts.push(output);
	parts.push('```');

	return parts.join('\n');
}

/** A one-line explanation of a stop, for the user rather than the model. */
export function formatStop(
	decision: Extract<VerificationDecision, {action: 'stop'}>,
): string {
	const explanation = STOP_EXPLANATIONS[decision.reason];
	return decision.detail ? `${explanation} (${decision.detail})` : explanation;
}

function formatList(failures: readonly Failure[], bullet = '- '): string[] {
	const shown = failures
		.slice(0, MAX_LISTED)
		.map(failure => `${bullet}${failure.line}`);
	if (failures.length > MAX_LISTED) {
		shown.push(`${bullet}... and ${failures.length - MAX_LISTED} more`);
	}
	return shown;
}
