import {AsyncLocalStorage} from 'node:async_hooks';
import {resolve} from 'node:path';

/**
 * What belongs to one session in a process that serves several (ACP).
 *
 * An ACP client names each session's folder in `session/new`, and the spec
 * requires it to be used however the agent was spawned. Process-wide values
 * would let concurrent sessions overwrite each other, so a session's work runs
 * inside its context instead, and the getters that read per-session state read
 * the active context when there is one.
 *
 * Outside any context (the TUI, `--plain`, the daemon: one session per
 * process) those getters fall back to the process-wide values, so single
 * session behaviour does not depend on this module at all.
 */
export interface SessionContext {
	/**
	 * The session's folder. Its project config (agents.config.json, .mcp.json)
	 * is read from here, and it is the file tools' containment boundary.
	 */
	projectRoot: string;
	/** Where a bash `cd` moved the session; null until one does. */
	sessionCwd: string | null;
	/**
	 * The session's id, handed to lifecycle hooks as NANOCODER_SESSION_ID.
	 * Unset until the session is registered.
	 */
	sessionId?: string;
	/** Storage behind every `defineSessionValue` for this session. */
	readonly values: Map<symbol, unknown>;
}

const sessionContextStore = new AsyncLocalStorage<SessionContext>();

export function createSessionContext(projectRoot: string): SessionContext {
	return {
		projectRoot: resolve(projectRoot),
		sessionCwd: null,
		values: new Map(),
	};
}

export function runInSessionContext<T>(
	context: SessionContext,
	run: () => T,
): T {
	return sessionContextStore.run(context, run);
}

export function getActiveSessionContext(): SessionContext | undefined {
	return sessionContextStore.getStore();
}

/** Runs `run` as code outside any session does: on the launch folder. */
export function runOutsideSessionContext<T>(run: () => T): T {
	return sessionContextStore.exit(run);
}

/**
 * The folder project config is read from: the active session's folder, else
 * the directory the process runs in.
 */
export function getConfigRoot(): string {
	return sessionContextStore.getStore()?.projectRoot ?? process.cwd();
}

// Values set outside any session context: the one session of the TUI,
// `--plain` and the daemon.
const processValues = new Map<symbol, unknown>();

function activeValues(): Map<symbol, unknown> {
	return sessionContextStore.getStore()?.values ?? processValues;
}

/**
 * One value that belongs to the session, such as a `/compact` override or the
 * last prompt built. Null until set. Read and written in the active session's
 * context, or process-wide outside one, so a session never sees another's.
 * `normalize` runs on every set, so callers can clamp or reject (to null).
 */
export interface SessionValue<T> {
	get(): T | null;
	set(value: T | null): void;
	reset(): void;
}

export function defineSessionValue<T>(
	normalize: (value: T | null) => T | null = value => value,
): SessionValue<T> {
	const key = Symbol('session-value');
	return {
		get: () => (activeValues().get(key) as T | undefined) ?? null,
		set(value) {
			activeValues().set(key, normalize(value));
		},
		reset() {
			activeValues().delete(key);
		},
	};
}
