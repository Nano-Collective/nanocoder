import {randomBytes} from 'node:crypto';

/**
 * Process-wide React key generator.
 *
 * Produces keys of the form `{sessionId}-{prefix}-{counter}`. The counter
 * increments synchronously on every call, so rapid successive `generateKey()`
 * invocations never collide (unlike `Date.now()`-based keys, which can within
 * the same millisecond).
 *
 * The session ID is generated lazily on first use and can be rebased once
 * — e.g. when a persisted session is resumed — via `setKeyGeneratorSessionId`.
 * Rebasing preserves the counter so already-rendered keys remain unique
 * relative to subsequent ones.
 */

let sessionId: string | null = null;
let counter = 0;

function ensureSessionId(): string {
	if (sessionId === null) {
		sessionId = randomBytes(4).toString('hex');
	}
	return sessionId;
}

export function generateKey(prefix: string): string {
	counter += 1;
	return `${ensureSessionId()}-${prefix}-${counter}`;
}

export function getKeyGeneratorSessionId(): string {
	return ensureSessionId();
}

/**
 * Rebase the session ID prefix used by future `generateKey()` calls. Intended
 * for app startup wiring (sharing the ID with `SessionTracker`) and `/resume`.
 * The counter is intentionally not reset so future keys can't collide with
 * keys already in the React tree.
 */
export function setKeyGeneratorSessionId(id: string): void {
	sessionId = id;
}

/** Test-only: reset both the session ID and the counter. */
export function resetKeyGeneratorForTests(): void {
	sessionId = null;
	counter = 0;
}
