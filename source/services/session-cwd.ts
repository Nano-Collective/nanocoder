import {existsSync, statSync} from 'node:fs';
import {resolve} from 'node:path';

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

export function setSessionCwd(dir: string): void {
	const trimmed = dir.trim();
	if (!trimmed) return;
	// Absolute so downstream `resolve(base, rel)` is stable.
	sessionCwd = resolve(trimmed);
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
}
