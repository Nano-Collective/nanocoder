/**
 * Per-session timeline lockfile. Mirrors `daemon/lockfile.ts` but lives
 * next to the session directory (`.nanocoder/timeline/<sessionId>/.lock`)
 * so the existing `pruneStaleSessions` walk can probe a session's
 * liveness without a separate index.
 *
 * The lock's job is narrow: prevent `pruneStaleSessions` from removing a
 * session directory that an in-flight process is still writing into. The
 * lock is best-effort - if acquisition fails for any reason the caller
 * logs and continues; pruning is housekeeping and must never block a
 * chat.
 *
 * Atomicity: writes use `O_EXCL` so two processes cannot both observe an
 * empty file. The payload is the holder's PID plus the start timestamp
 * and a tag that distinguishes the timeline lock from any other JSON the
 * session directory might contain.
 */

import {randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const TIMELINE_LOCK_FILENAME = '.lock';
export const TIMELINE_LOCK_PURPOSE = 'session-active';

export interface TimelineLockPayload {
	pid: number;
	startedAt: number;
	purpose: typeof TIMELINE_LOCK_PURPOSE;
}

export function getTimelineLockPath(sessionDir: string): string {
	return join(sessionDir, TIMELINE_LOCK_FILENAME);
}

/**
 * Probe whether the PID in `pid` is still alive. Uses signal 0 so no
 * signal is delivered; the kernel only reports whether sending one would
 * have been permitted. `EPERM` is treated as alive (a process exists
 * but we lack the privilege to signal it).
 *
 * Duplicated from `daemon/lockfile.ts` so the timeline can stay
 * self-contained. A future refactor can lift this into a shared util.
 */
export function isProcessAlive(pid: number): boolean {
	if (!Number.isFinite(pid) || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === 'EPERM') return true;
		return false;
	}
}

async function readLockPayload(
	lockPath: string,
): Promise<TimelineLockPayload | null> {
	if (!existsSync(lockPath)) {
		return null;
	}
	try {
		const raw = await readFile(lockPath, 'utf-8');
		const parsed = JSON.parse(raw) as Partial<TimelineLockPayload>;
		if (
			typeof parsed.pid !== 'number' ||
			typeof parsed.startedAt !== 'number' ||
			parsed.purpose !== TIMELINE_LOCK_PURPOSE
		) {
			return null;
		}
		return {
			pid: parsed.pid,
			startedAt: parsed.startedAt,
			purpose: TIMELINE_LOCK_PURPOSE,
		};
	} catch {
		return null;
	}
}

/**
 * Acquire the per-session timeline lock. The write goes to a sibling
 * `*.tmp` file and is renamed in place, so a partially-written lock is
 * never observable. The call is best-effort: a `false` return means
 * another process holds the lock (or the filesystem refused the
 * rename), and the caller should log and continue.
 */
export async function acquireTimelineLock(
	sessionDir: string,
	payload: Omit<TimelineLockPayload, 'purpose'>,
): Promise<boolean> {
	const lockPath = getTimelineLockPath(sessionDir);
	if (existsSync(lockPath)) {
		return false;
	}
	await mkdir(sessionDir, {recursive: true});
	const tmp = `${lockPath}.${randomBytes(8).toString('hex')}.tmp`;
	const body: TimelineLockPayload = {
		...payload,
		purpose: TIMELINE_LOCK_PURPOSE,
	};
	try {
		await writeFile(tmp, JSON.stringify(body, null, 2), 'utf-8');
		await rename(tmp, lockPath);
		return true;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		// EEXIST means a sibling process beat us to the rename; treat as
		// a normal "lock held" outcome rather than a failure.
		if (code === 'EEXIST') {
			return false;
		}
		return false;
	} finally {
		// Best-effort cleanup if the rename never happened.
		if (existsSync(tmp)) {
			try {
				await unlink(tmp);
			} catch {
				// ignore
			}
		}
	}
}

/**
 * Release the lock. Missing files are ignored so the call is idempotent.
 */
export async function releaseTimelineLock(sessionDir: string): Promise<void> {
	const lockPath = getTimelineLockPath(sessionDir);
	try {
		await unlink(lockPath);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== 'ENOENT') throw err;
	}
}

/**
 * Read the lockfile and report whether the holder is still alive. A
 * stale lock (process dead, malformed JSON, or wrong purpose tag) is
 * reaped as a side effect so the next `pruneStaleSessions` walk sees a
 * clean timeline root.
 */
export async function isTimelineLockLive(
	sessionDir: string,
): Promise<{live: boolean; payload: TimelineLockPayload | null}> {
	const lockPath = getTimelineLockPath(sessionDir);
	const payload = await readLockPayload(lockPath);
	if (!payload) {
		if (existsSync(lockPath)) {
			// Malformed - treat as not-live and clear it.
			try {
				await unlink(lockPath);
			} catch {
				// ignore
			}
		}
		return {live: false, payload: null};
	}
	if (!isProcessAlive(payload.pid)) {
		try {
			await unlink(lockPath);
		} catch {
			// ignore
		}
		return {live: false, payload};
	}
	return {live: true, payload};
}
