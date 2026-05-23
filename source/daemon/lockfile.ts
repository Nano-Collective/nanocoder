/**
 * Daemon lockfile. Stores the PID, IPC socket path, and start time so the
 * TUI can find the daemon and `nanocoder daemon status` can tell whether
 * one is running.
 *
 * Atomicity: writes go to a sibling `*.tmp` file and rename in place, so a
 * partially-written lockfile is never observable.
 *
 * Stale detection: a lockfile pointing at a dead PID is reaped on first
 * read by any caller that cares (start, status).
 *
 * See `agents/2026-05-20-skills-unification-plan.md` step 19.
 */

import {randomBytes} from 'node:crypto';
import {existsSync, mkdirSync} from 'node:fs';
import {readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';

export interface DaemonLock {
	pid: number;
	socketPath: string;
	startedAt: number;
	projectRoot: string;
}

export function getLockfilePath(projectRoot: string): string {
	return join(projectRoot, '.nanocoder', 'daemon.json');
}

export function getSocketPath(projectRoot: string): string {
	return join(projectRoot, '.nanocoder', 'daemon.sock');
}

export async function readLockfile(
	projectRoot: string,
): Promise<DaemonLock | null> {
	const path = getLockfilePath(projectRoot);
	if (!existsSync(path)) return null;
	try {
		const raw = await readFile(path, 'utf-8');
		const parsed = JSON.parse(raw) as DaemonLock;
		if (
			typeof parsed.pid !== 'number' ||
			typeof parsed.socketPath !== 'string' ||
			typeof parsed.startedAt !== 'number'
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

export async function writeLockfile(lock: DaemonLock): Promise<void> {
	const path = getLockfilePath(lock.projectRoot);
	mkdirSync(dirname(path), {recursive: true});
	const tmp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
	await writeFile(tmp, JSON.stringify(lock, null, 2), 'utf-8');
	await rename(tmp, path);
}

export async function removeLockfile(projectRoot: string): Promise<void> {
	const path = getLockfilePath(projectRoot);
	try {
		await unlink(path);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== 'ENOENT') throw err;
	}
}

/**
 * Probe whether the PID in the lockfile is still alive. Uses signal 0 so
 * no signal is actually delivered - the kernel just reports whether
 * sending would have been allowed.
 */
export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		// EPERM means a process is there but we can't signal it (still alive)
		if (code === 'EPERM') return true;
		return false;
	}
}

/**
 * Read the lockfile and verify the daemon is actually running. Removes
 * stale lockfiles as a side effect so subsequent `daemon start` calls
 * have a clean slate.
 */
export async function readLiveLockfile(
	projectRoot: string,
): Promise<DaemonLock | null> {
	const lock = await readLockfile(projectRoot);
	if (!lock) return null;
	if (!isProcessAlive(lock.pid)) {
		await removeLockfile(projectRoot);
		return null;
	}
	return lock;
}
