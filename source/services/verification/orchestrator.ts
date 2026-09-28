/**
 * Drives one post-edit verification pass over a single user turn.
 *
 * `verifier.ts` decides *what* to do with a result and `runner.ts` knows *how* to
 * produce one. Neither knows the shape of a turn, so this is where the three
 * concerns that only make sense across time are handled:
 *
 *  1. **The baseline is taken before the first edit, not after it.** Everything
 *     the decision core reports as "introduced by your changes" is measured
 *     against this. Capturing it after the edit would report every pre-existing
 *     failure as new, and the model would rewrite unrelated code chasing it.
 *     `ensureBaseline` is therefore called from the *pre-tool* hook and
 *     `afterEdits` from the post-tool one.
 *
 *  2. **Superseded messages are removed, not appended.** Each retry asks the
 *     model to fix the same check again. Left in history, N attempts mean N
 *     copies of the same output, and the context that pays for it is the one
 *     being drained. Callers rebuild their message list through
 *     {@link stripVerificationMessages} so only the newest survives.
 *
 *  3. **Only one run is in flight at a time.** A second concurrent run would
 *     double the cost and interleave two outputs the model then has to
 *     disentangle. The guard is in-process: it covers a `/verify` racing an
 *     automatic pass and any future parallel caller, but it is deliberately
 *     *not* a claim about other nanocoder processes pointed at the same
 *     repository.
 *
 * Nothing here throws. A verification feature that can break a session is worse
 * than no verification feature, so every failure becomes a reported outcome.
 */

import {formatFeedback, formatStop} from './feedback.js';
import {runVerificationCommand, type VerificationRunResult} from './runner.js';
import {
	createVerificationState,
	decideNextAction,
	hasBaseline,
	recordBaseline,
	type VerificationDecision,
	type VerificationState,
} from './verifier.js';

/** Opening words of the synthetic message injected into the conversation. */
export const VERIFICATION_MESSAGE_PREFIX =
	'The verification command failed after your edits.';

export interface VerificationSettings {
	/** argv, already normalised by the config loader. */
	command: string[];
	timeoutMs: number;
	maxOutputBytes: number;
	/** Results to judge, counting the first. `1` never retries. */
	maxAttempts: number;
	cwd: string;
}

export type VerificationOutcome =
	/** The check passed. */
	| {action: 'passed'; result: VerificationRunResult; attempts: number}
	/** The model should be asked to fix this. `text` is the message to inject. */
	| {
			action: 'feedback';
			text: string;
			decision: Extract<VerificationDecision, {action: 'feedback'}>;
			result: VerificationRunResult;
	  }
	/** The loop is over. `text` is for the user, not the model. */
	| {
			action: 'stopped';
			text: string;
			reason: string;
			decision: Extract<VerificationDecision, {action: 'stop'}>;
			result: VerificationRunResult;
	  }
	/** Nothing ran, and that is correct. */
	| {action: 'skipped'; reason: 'not-configured' | 'disabled' | 'busy'}
	/** The run threw rather than returning a result. */
	| {action: 'error'; message: string};

// One in-flight run per process. Deliberately a plain counter rather than a
// promise chain: the guard exists to answer "is a run already happening", and a
// queue would be the wrong answer - a queued run would execute *after* the one
// that superseded it and report stale results as current.
let inFlight = 0;

/** Test-only: reset the process-wide guard. */
export function resetVerificationLock(): void {
	inFlight = 0;
}

/** The single seam through which the orchestrator runs anything. */
export type VerificationRunner = (
	settings: VerificationSettings,
	signal?: AbortSignal,
) => Promise<VerificationRunResult>;

const defaultRunner: VerificationRunner = async (settings, signal) => {
	const [command, ...args] = settings.command;
	return await runVerificationCommand({
		command: {command, args, display: settings.command.join(' ')},
		cwd: settings.cwd,
		timeoutMs: settings.timeoutMs,
		maxOutputBytes: settings.maxOutputBytes,
		...(signal ? {signal} : {}),
	});
};

async function runGuarded(
	run: VerificationRunner,
	settings: VerificationSettings,
	signal?: AbortSignal,
): Promise<VerificationRunResult> {
	inFlight++;
	try {
		return await run(settings, signal);
	} finally {
		inFlight--;
	}
}

export class VerificationOrchestrator {
	private state: VerificationState = createVerificationState();
	private readonly settings: VerificationSettings;
	/** Latched once the check has run for this turn, whatever the outcome. */
	private settled = false;
	/**
	 * Separate from `hasBaseline(state)` on purpose. A baseline run that threw
	 * leaves `state.baseline` null, and without its own latch every subsequent
	 * edit would pay for another run of a command already known to be broken.
	 */
	private baselineAttempted = false;
	private readonly run: VerificationRunner;

	constructor(
		settings: VerificationSettings,
		run: VerificationRunner = defaultRunner,
	) {
		this.settings = settings;
		this.run = run;
	}

	/**
	 * Run the check *before* the first edit, to learn the repository's starting
	 * state.
	 *
	 * Idempotent and cheap to call on every mutating tool: only the first call
	 * runs anything. Returns `null` when a baseline already exists, when the
	 * feature is off, or when the run failed - a missing baseline degrades the
	 * feedback wording, it does not break the session.
	 */
	async ensureBaseline(
		signal?: AbortSignal,
	): Promise<VerificationRunResult | null> {
		if (hasBaseline(this.state)) return null;
		// A baseline captured after a partial fix reports every pre-existing
		// failure as new, so it is set exactly once and never replaced.
		if (this.baselineAttempted) return null;

		this.baselineAttempted = true;
		try {
			const result = await runGuarded(this.run, this.settings, signal);
			this.state = recordBaseline(this.state, result);
			return result;
		} catch {
			// Unreachable through the runner, which never rejects. Present so a
			// future change to it cannot take the pre-edit path down with it.
			return null;
		}
	}

	/**
	 * Run the check after the edits and decide what happens next.
	 *
	 * Called once per post-edit turn. `settled` makes the second and later
	 * attempts no-ops, which is what bounds the loop: the caller re-enters the
	 * conversation after every `feedback`, and each of those turns must not
	 * spend another run.
	 */
	async afterEdits(signal?: AbortSignal): Promise<VerificationOutcome> {
		if (this.settled) return {action: 'skipped', reason: 'not-configured'};
		this.settled = true;

		if (inFlight > 0) return {action: 'skipped', reason: 'busy'};

		let result: VerificationRunResult;
		try {
			result = await runGuarded(this.run, this.settings, signal);
		} catch (error) {
			return {
				action: 'error',
				message: error instanceof Error ? error.message : String(error),
			};
		}

		const {decision, state} = decideNextAction(this.state, result, {
			maxAttempts: this.settings.maxAttempts,
		});
		this.state = state;

		if (decision.action === 'done') {
			return {action: 'passed', result, attempts: decision.attempts};
		}

		if (decision.action === 'stop') {
			return {
				action: 'stopped',
				text: formatStop(decision),
				reason: decision.reason,
				decision,
				result,
			};
		}

		return {
			action: 'feedback',
			text: formatFeedback(decision, result.output),
			decision,
			result,
		};
	}

	/** Discard the baseline after out-of-band mutation. */
	invalidateBaseline(): void {
		this.state = createVerificationState();
		this.baselineAttempted = false;
	}

	/** Exposed for tests and for the `/verify` summary. */
	get attempts(): number {
		return this.state.attempts;
	}

	get hasBaselineRun(): boolean {
		return hasBaseline(this.state);
	}
}

/**
 * True for the synthetic message this feature injects.
 *
 * Mirrors `isAutoDiagnosticsMessage`: anything that scans history for "what did
 * the user actually ask" has to be able to skip these, and the safest way to
 * stay recognisable across rewordings is a fixed opening.
 */
export function isVerificationMessage(message: {
	role: string;
	content: string;
}): boolean {
	return (
		message.role === 'user' &&
		message.content.startsWith(VERIFICATION_MESSAGE_PREFIX)
	);
}

/**
 * Drop superseded verification messages.
 *
 * Called before injecting a new one. Without it every retry appends another
 * copy of the same failure output to the history the model is about to read,
 * and the context budget is spent re-reading text it was already given.
 */
export function stripVerificationMessages<
	T extends {
		role: string;
		content: string;
	},
>(messages: T[]): T[] {
	const kept = messages.filter(message => !isVerificationMessage(message));
	return kept.length === messages.length ? messages : kept;
}

/**
 * The user-facing message to inject, paired with its result for display.
 *
 * Sent as `role: 'user'` so the model treats it as an instruction. That choice
 * is provider-safe - a synthetic assistant turn with tool calls and no
 * matching tool results is rejected by most providers, and a synthetic user
 * turn is not.
 */
export function buildVerificationMessage(text: string): {
	role: 'user';
	content: string;
} {
	return {
		role: 'user',
		content: `${VERIFICATION_MESSAGE_PREFIX} ${text}`,
	};
}
