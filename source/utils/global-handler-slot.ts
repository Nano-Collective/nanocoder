/**
 * A module-level singleton handler slot wired up by App.tsx and invoked from
 * deep in the tool / subagent layers (mirrors message-queue.tsx). The UI sets
 * one handler; callers `signal()` and await the user's response. When no
 * handler is registered, `signal()` resolves to a caller-supplied fallback.
 */
export interface GlobalHandlerSlot<TInput, TResult> {
	/**
	 * Wire up the handler. Returns a disposer that restores whatever handler
	 * was installed before, for callers whose handler is only valid for a
	 * bounded scope. Callers that own the slot for the process lifetime, such
	 * as the Ink UI, can ignore it.
	 */
	set(handler: GlobalHandler<TInput, TResult>): () => void;
	/**
	 * Called from the tool/executor; resolves with the user's response.
	 *
	 * Pass the turn's `AbortSignal` when there is one. Without it the caller
	 * is parked until a human answers and nothing else can free it: a turn
	 * cancelled while a request is queued leaves its caller awaiting forever,
	 * which is how a batch of subagents awaited with `Promise.allSettled`
	 * could never settle. On abort the promise resolves with the same safe
	 * `fallback` used when no handler is installed at all — for both approval
	 * slots that is "denied", so cancelling can never approve anything.
	 */
	signal(input: TInput, abortSignal?: AbortSignal): Promise<TResult>;
}

export type GlobalHandler<TInput, TResult> = (
	input: TInput,
	abortSignal?: AbortSignal,
) => Promise<TResult>;

export function createGlobalHandlerSlot<TInput, TResult>(
	fallback: (input: TInput) => TResult,
): GlobalHandlerSlot<TInput, TResult> {
	let handler: GlobalHandler<TInput, TResult> | null = null;

	return {
		set(next) {
			const previous = handler;
			handler = next;
			return () => {
				// Only step back if nobody replaced us in the meantime, so a
				// later owner is not clobbered by an earlier one's teardown.
				if (handler === next) {
					handler = previous;
				}
			};
		},
		async signal(input, abortSignal) {
			if (!handler) {
				return fallback(input);
			}
			// Already cancelled before we even queued: do not put a prompt on
			// screen on behalf of a turn that is already over.
			if (abortSignal?.aborted) {
				return fallback(input);
			}
			return handler(input, abortSignal);
		},
	};
}
