/**
 * A module-level singleton handler slot wired up by App.tsx and invoked from
 * deep in the tool / subagent layers (mirrors message-queue.tsx). The UI sets
 * one handler; callers `signal()` and await the user's response. When no
 * handler is registered, `signal()` resolves to a caller-supplied fallback.
 */
export interface GlobalHandlerSlot<TInput, TResult> {
	/** Called once from App.tsx to wire up the UI handler. */
	set(handler: (input: TInput) => Promise<TResult>): void;
	/** Called from the tool/executor; resolves with the user's response. */
	signal(input: TInput): Promise<TResult>;
}

export function createGlobalHandlerSlot<TInput, TResult>(
	fallback: (input: TInput) => TResult,
): GlobalHandlerSlot<TInput, TResult> {
	let handler: ((input: TInput) => Promise<TResult>) | null = null;

	return {
		set(next) {
			handler = next;
		},
		async signal(input) {
			if (!handler) {
				return fallback(input);
			}
			return handler(input);
		},
	};
}
