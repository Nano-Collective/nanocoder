/**
 * Whether the current `nanocoder run` ended on an unrecoverable error.
 *
 * Run mode used to decide its exit code by looking for an `error`-role
 * message in the conversation, but nothing ever produces one, so every run
 * exited 0 - including a model server that could not be reached and a model
 * stopped by a retry cap - and CI could not tell a failed run from a finished
 * one. The code paths that end a turn on a failure record it here instead,
 * and the run-mode exit check reads it. A process runs at most one `run`
 * prompt, so a module-level flag is enough; interactive sessions set it too
 * but never read it.
 */
let failure: string | null = null;

/** Record that the run failed. The first reason wins. */
export function markRunFailed(reason: string): void {
	failure ??= reason;
}

/** The recorded failure, or null when the run has not failed. */
export function getRunFailure(): string | null {
	return failure;
}

/** Test seam. */
export function resetRunFailure(): void {
	failure = null;
}
