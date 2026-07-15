import type {Session, SessionManager} from './session-manager';
import {sessionManager} from './session-manager';

export type ResolveSessionFailureReason = 'not-found' | 'empty';

export type ResolveSessionResult =
	| {ok: true; session: Session}
	| {ok: false; reason: ResolveSessionFailureReason; message: string};

export interface ResolveSessionOptions {
	/** When true, resolves "last" / index against every session, not just this cwd's. */
	all?: boolean;
	/** Injectable manager for tests; defaults to the app singleton. Caller must have already called `initialize()`. */
	manager?: SessionManager;
}

/**
 * Resolves a /resume-style argument ("last" / 1-based index / raw session id)
 * against sessionManager.listSessions, then loads and returns the full Session.
 *
 * This mirrors the resolution logic that used to live inline in
 * handleResumeCommand — behavior is intentionally unchanged:
 *  - undefined arg is treated as "last" (session-handler.ts itself only calls
 *    this when an arg is present; the CLI entry points rely on this default).
 *  - "last" (case-insensitive): most recent session (by lastAccessedAt) in
 *    the scoped list. Empty scoped list -> {ok:false, reason:'empty'}.
 *  - an all-digit string that is an in-range 1-based index into the scoped,
 *    lastAccessedAt-desc-sorted list: resolves to that entry. Only pure-digit
 *    args are index candidates — a uuid like "5e4b…" must not parseInt to 5.
 *  - anything else: treated as a raw session id and loaded directly via
 *    sessionManager.loadSession, which is NOT scoped by workingDirectory —
 *    so a raw uuid resolves correctly even when `all` is false and the
 *    session belongs to a different cwd. This matches the pre-refactor
 *    behavior of handleResumeCommand.
 */
export async function resolveSession(
	arg: string | undefined,
	workingDirectory: string,
	opts?: ResolveSessionOptions,
): Promise<ResolveSessionResult> {
	const manager = opts?.manager ?? sessionManager;
	const listOptions = opts?.all ? undefined : {workingDirectory};
	const sessions = await manager.listSessions(listOptions);
	const sorted = [...sessions].sort(
		(a, b) =>
			new Date(b.lastAccessedAt).getTime() -
			new Date(a.lastAccessedAt).getTime(),
	);

	const specialArg = arg === undefined ? 'last' : arg;

	let sessionId: string | null = null;

	if (specialArg.toLowerCase() === 'last') {
		if (sorted.length === 0) {
			return {ok: false, reason: 'empty', message: 'No sessions found.'};
		}
		sessionId = sorted[0].id;
	} else {
		const index = /^\d+$/.test(specialArg)
			? Number.parseInt(specialArg, 10)
			: Number.NaN;
		if (!Number.isNaN(index) && index >= 1 && index <= sorted.length) {
			sessionId = sorted[index - 1].id;
		} else {
			sessionId = specialArg;
		}
	}

	const session = await manager.loadSession(sessionId);
	if (!session) {
		return {
			ok: false,
			reason: 'not-found',
			message: `Session not found: ${sessionId}`,
		};
	}

	return {ok: true, session};
}
