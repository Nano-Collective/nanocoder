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
}

const sessionContextStore = new AsyncLocalStorage<SessionContext>();

export function createSessionContext(projectRoot: string): SessionContext {
	return {projectRoot: resolve(projectRoot), sessionCwd: null};
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

/**
 * The folder project config is read from: the active session's folder, else
 * the directory the process runs in.
 */
export function getConfigRoot(): string {
	return sessionContextStore.getStore()?.projectRoot ?? process.cwd();
}
