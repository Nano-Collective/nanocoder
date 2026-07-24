import {existsSync, statSync} from 'node:fs';
import {resolve, sep} from 'node:path';

// Shared "where am I" for bash and every file tool. Without it, a `cd` in one
// bash subshell never reaches the next command or the file tools — so a
// relative read after `cd` into a worktree resolved against the launch dir.
//
// null means "not pinned yet": fall through to the live process.cwd() so tools
// behave exactly as before until a bash `cd` actually moves the shell.
let sessionCwd: string | null = null;

export function getSessionCwd(): string {
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
	return projectRoot ?? resolve(process.cwd());
}

export function setProjectRoot(dir: string): void {
	const trimmed = dir.trim();
	if (trimmed) projectRoot = resolve(trimmed);
}

export function setSessionCwd(dir: string): void {
	const trimmed = dir.trim();
	if (!trimmed) return;
	// Absolute so downstream `resolve(base, rel)` is stable.
	sessionCwd = resolve(trimmed);
}

// The session cwd clamped to the project root. A bash `cd /etc` moves the
// session cwd outside the project; the pathless search tools use this as their
// default root so they never glob/grep outside the project. Relative paths still
// resolve against the true session cwd — only the default search root is clamped.
export function getContainedSessionCwd(): string {
	const cwd = getSafeSessionCwd();
	const root = getProjectRoot();
	return cwd === root || cwd.startsWith(root + sep) ? cwd : root;
}

// Guards against a `cd`-ed-into dir being deleted mid-session (torn-down
// worktree): unpin so bash/file tools fall back to the live process.cwd().
export function getSafeSessionCwd(): string {
	const current = sessionCwd ?? process.cwd();
	try {
		if (existsSync(current) && statSync(current).isDirectory()) {
			return current;
		}
	} catch {
		// fall through to unpin
	}
	sessionCwd = null;
	return process.cwd();
}

// Test helper.
export function resetSessionCwd(): void {
	sessionCwd = null;
	projectRoot = null;
}
