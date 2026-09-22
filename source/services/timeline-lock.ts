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
 * Atomicity: the full payload is written to a unique temp file in the same
 * directory first, then published with a hard `link(tmp, lockPath)`. `link`
 * is atomic and fails with `EEXIST` when the destination already exists,
 * so a concurrent reader can never observe a half-written (empty) lockfile
 * and two racers can never both believe they hold the lock.
 */

import {existsSync} from 'node:fs';
import {
	link,
	mkdir,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
} from 'node:fs/promises';
import {join} from 'node:path';

export const TIMELINE_LOCK_PURPOSE = 'session-active';
export const MAX_LOCK_AGE_MS = 24 * 60 * 60 * 1000;

export interface TimelineLockPayload {
	pid: number;
	startedAt: number;
	purpose: typeof TIMELINE_LOCK_PURPOSE;
}

export function getTimelineLockPath(sessionDir: string): string {
	return join(sessionDir, '.lock');
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
		// An empty file means a writer is mid-publish; treat it as absent
		// rather than malformed so the caller retries instead of reaping a
		// live session's lock. With link-based publishing below this window
		// cannot occur, but the guard keeps old lockfiles safe.
		if (raw.length === 0) {
			return null;
		}
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
 * Acquire the per-session timeline lock atomically. The payload is written
 * to a unique temp file in the same directory first (same filesystem, so
 * `link` is atomic), then hard-linked into place. `link` fails with
 * `EEXIST` when another process already holds the lock, in which case this
 * returns `false`. Any other filesystem error is re-thrown so the caller
 * can log it distinctly from ordinary contention.
 */
export async function acquireTimelineLock(
	sessionDir: string,
	payload: Omit<TimelineLockPayload, 'purpose'>,
): Promise<boolean> {
	if (!existsSync(sessionDir)) {
		await mkdir(sessionDir, {recursive: true});
	}
	const lockPath = getTimelineLockPath(sessionDir);
	const body: TimelineLockPayload = {
		...payload,
		purpose: TIMELINE_LOCK_PURPOSE,
	};
	const tmpPath = join(
		sessionDir,
		`.lock.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);

	await writeFile(tmpPath, JSON.stringify(body, null, 2), 'utf-8');
	try {
		try {
			await link(tmpPath, lockPath);
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === 'EEXIST') {
				return false;
			}
			throw err;
		}
		return true;
	} finally {
		try {
			await unlink(tmpPath);
		} catch {
			// ignore - the temp file may already be gone
		}
	}
}

/**
 * Refresh a lock held by this process so a long-lived session never trips
 * the `MAX_LOCK_AGE_MS` guard while it is still running. Only refreshes
 * when the on-disk payload belongs to this process; otherwise a no-op.
 * Called from `TimelineManager.tryAcquireSessionLock` on every `ensureDir`,
 * which already runs on every capture.
 */
export async function refreshTimelineLock(sessionDir: string): Promise<void> {
	const lockPath = getTimelineLockPath(sessionDir);
	const payload = await readLockPayload(lockPath);
	if (!payload || payload.pid !== process.pid) {
		return;
	}
	const body: TimelineLockPayload = {
		pid: payload.pid,
		startedAt: Date.now(),
		purpose: TIMELINE_LOCK_PURPOSE,
	};
	const tmpPath = join(
		sessionDir,
		`.lock.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await writeFile(tmpPath, JSON.stringify(body, null, 2), 'utf-8');
	try {
		// Publish via temp + rename: rename atomically replaces, so readers
		// never see a half-written file. Contention is impossible here
		// because we already hold the lock.
		await rename(tmpPath, lockPath);
	} finally {
		try {
			await unlink(tmpPath);
		} catch {
			// rename already consumed it on success
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
 * stale lock (holder process dead, malformed JSON, wrong purpose tag, or
 * lockfile mtime older than `MAX_LOCK_AGE_MS`) is reaped as a side effect
 * so the next `pruneStaleSessions` walk sees a clean timeline root.
 *
 * The age check uses the lockfile's mtime — refreshed on every `ensureDir`
 * via `refreshTimelineLock` — rather than the `startedAt` payload field, so
 * a session that stays alive past 24h keeps its protection indefinitely.
 * `startedAt` is still written for debuggability but never read for expiry.
 */
export async function isTimelineLockLive(
	sessionDir: string,
): Promise<{live: boolean; payload: TimelineLockPayload | null}> {
	const lockPath = getTimelineLockPath(sessionDir);
	const payload = await readLockPayload(lockPath);
	if (!payload) {
		// Empty-file mid-publish reads return null without an on-disk file
		// to reap (or with a file a concurrent writer is about to link).
		// Only unlink when the file exists AND is non-empty (genuinely
		// malformed), never on an empty/missing read.
		try {
			const st = await stat(lockPath);
			if (st.size === 0) {
				return {live: false, payload: null};
			}
		} catch {
			return {live: false, payload: null};
		}
		try {
			await unlink(lockPath);
		} catch {
			// ignore
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
	try {
		const st = await stat(lockPath);
		if (Date.now() - st.mtimeMs > MAX_LOCK_AGE_MS) {
			try {
				await unlink(lockPath);
			} catch {
				// ignore
			}
			return {live: false, payload};
		}
	} catch {
		return {live: false, payload};
	}
	return {live: true, payload};
}
