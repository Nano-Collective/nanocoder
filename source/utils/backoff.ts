/**
 * Minimal exponential backoff. No jitter, no timers — just tracks an attempt
 * counter and returns the delay the caller should wait before its next
 * retry. Pure and dependency-free so it's trivially unit-testable; callers
 * own their own `setTimeout`/scheduling.
 */

export interface BackoffOptions {
	/** Delay before the first retry, in ms. */
	baseMs: number;
	/** Upper bound on the returned delay, in ms. */
	maxMs: number;
	/** Multiplier applied per attempt. Defaults to 2. */
	factor?: number;
}

export class ExponentialBackoff {
	private attempt = 0;

	constructor(private readonly opts: BackoffOptions) {}

	/**
	 * Returns the delay (ms) to wait before the next retry, then advances the
	 * attempt counter. The first call returns `baseMs`.
	 */
	next(): number {
		const delay = Math.min(
			this.opts.baseMs * (this.opts.factor ?? 2) ** this.attempt,
			this.opts.maxMs,
		);
		this.attempt++;
		return delay;
	}

	/** Reset the attempt counter — call this after a successful operation. */
	reset(): void {
		this.attempt = 0;
	}
}
