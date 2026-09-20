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
	set(handler: (input: TInput) => Promise<TResult>): () => void;
	/** Called from the tool/executor; resolves with the user's response. */
	signal(input: TInput): Promise<TResult>;
}

export function createGlobalHandlerSlot<TInput, TResult>(
	fallback: (input: TInput) => TResult,
): GlobalHandlerSlot<TInput, TResult> {
	let handler: ((input: TInput) => Promise<TResult>) | null = null;

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
		async signal(input) {
			if (!handler) {
				return fallback(input);
			}
			return handler(input);
		},
	};
}
