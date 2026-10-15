import {AsyncLocalStorage} from 'node:async_hooks';
import {existsSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {isPathInside} from '@/utils/path-validation';

// Shared "where am I" for bash and every file tool. Without it, a `cd` in one
// bash subshell never reaches the next command or the file tools — so a
// relative read after `cd` into a worktree resolved against the launch dir.
//
// null means "not pinned yet": fall through to the live process.cwd() so tools
// behave exactly as before until a bash `cd` actually moves the shell.
let sessionCwd: string | null = null;

/**
 * The working directory of one session in a process that serves several (ACP).
 *
 * An ACP client names the session's directory in `session/new`, and the spec
 * requires it to be used however the agent was spawned. Pinning the
 * process-wide values above would let concurrent sessions overwrite each
 * other, so a turn runs inside its session's scope instead, and every getter
 * and setter below reads and writes the scope while one is active. A bash `cd`
 * therefore moves only the session that ran it.
 */
export interface SessionCwdScope {
	projectRoot: string;
	sessionCwd: string | null;
}

const sessionScope = new AsyncLocalStorage<SessionCwdScope>();

export function createSessionCwdScope(projectRoot: string): SessionCwdScope {
	return {projectRoot: resolve(projectRoot), sessionCwd: null};
}

export function runInSessionCwdScope<T>(
	scope: SessionCwdScope,
	run: () => T,
): T {
	return sessionScope.run(scope, run);
}

export function getSessionCwd(): string {
	const scope = sessionScope.getStore();
	if (scope) return scope.sessionCwd ?? scope.projectRoot;
	return sessionCwd ?? process.cwd();
}

// The containment boundary for the file tools: the project root (launch dir).
// The session cwd moves DEEPER as `cd` descends; the boundary must NOT shrink
// with it, or a tool can no longer reach the project root (or a sibling
// worktree) once the shell is inside a subdir — the failure that rejected a
// `list_directory` of the workspace root after a `cd` into a worktree. Nothing
// process.chdir()s during a session (the daemon sets it once at entry), so the
// live process.cwd() is the launch dir; `projectRoot` lets tests (or an explicit
// startup call) pin it when the session cwd is not under the launch dir.
let projectRoot: string | null = null;

export function getProjectRoot(): string {
	const scope = sessionScope.getStore();
	if (scope) return scope.projectRoot;
	return projectRoot ?? resolve(process.cwd());
}

export function setProjectRoot(dir: string): void {
	const trimmed = dir.trim();
	if (!trimmed) return;
	const scope = sessionScope.getStore();
	if (scope) scope.projectRoot = resolve(trimmed);
	else projectRoot = resolve(trimmed);
}

export function setSessionCwd(dir: string): void {
	const trimmed = dir.trim();
	if (!trimmed) return;
	// Absolute so downstream `resolve(base, rel)` is stable.
	const scope = sessionScope.getStore();
	if (scope) scope.sessionCwd = resolve(trimmed);
	else sessionCwd = resolve(trimmed);
}

// The session cwd clamped to the project root. A bash `cd /etc` moves the
// session cwd outside the project; the pathless search tools use this as their
// default root so they never glob/grep outside the project. Relative paths still
// resolve against the true session cwd — only the default search root is clamped.
export function getContainedSessionCwd(): string {
	const cwd = getSafeSessionCwd();
	const root = getProjectRoot();
	return isPathInside(cwd, root) ? cwd : root;
}

// Guards against a `cd`-ed-into dir being deleted mid-session (torn-down
// worktree): unpin so bash/file tools fall back to the live process.cwd(), or
// to the session's own directory inside a session scope.
export function getSafeSessionCwd(): string {
	const scope = sessionScope.getStore();
	if (scope) {
		const pinned = scope.sessionCwd;
		if (pinned !== null && isDirectory(pinned)) return pinned;
		scope.sessionCwd = null;
		return scope.projectRoot;
	}

	const current = sessionCwd ?? process.cwd();
	if (isDirectory(current)) return current;
	sessionCwd = null;
	return process.cwd();
}

function isDirectory(dir: string): boolean {
	try {
		return existsSync(dir) && statSync(dir).isDirectory();
	} catch {
		return false;
	}
}

// Test helper.
export function resetSessionCwd(): void {
	sessionCwd = null;
	projectRoot = null;
}
