import fs, {type FileHandle} from 'node:fs/promises';

/**
 * A lock file shared by processes that read-modify-write the same JSON file.
 *
 * An in-process queue cannot stop a second Nanocoder process (another
 * terminal, the VS Code extension, a parallel `nanocoder run`) from reading the
 * file, writing its own copy and renaming it over ours. The lock is created
 * with O_EXCL next to the file, heartbeats while held, and is reclaimed when
 * its owner is dead or has stopped heartbeating. Used by the semantic memory
 * store and the session index.
 */

/**
 * How long a lock may go un-refreshed before a waiter treats it as abandoned.
 * The holder heartbeats well inside this, so an un-refreshed lock means the
 * holder is gone or wedged rather than merely slow.
 */
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 15_000;
/** Refresh interval while the lock is held. Comfortably inside the stale window. */
const LOCK_HEARTBEAT_MS = 2_000;

/**
 * Is the process with this pid still around?
 *
 * `kill(pid, 0)` is the canonical probe: it checks for the process without
 * signalling it. EPERM means it exists but belongs to someone else, which
 * still counts as alive; only ESRCH means gone.
 *
 * `vscode/discovery.ts` has its own copy of this. That module is deliberately
 * free of `@/` aliases so the VS Code extension can bundle it, so it cannot
 * import a shared helper, and a ten-line duplicate beats teaching esbuild
 * about the source tree's path aliases.
 */
function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException)?.code === 'EPERM';
	}
}

/** Read the pid a lock file records, or null if it is unreadable/malformed. */
async function readLockOwner(lockPath: string): Promise<number | null> {
	try {
		const raw = (await fs.readFile(lockPath, 'utf8')).trim();
		const pid = Number(raw);
		return Number.isInteger(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}

/**
 * Decide whether a lock we could not create is abandoned and may be removed.
 *
 * Elapsed time alone is not the question. The mtime used to be stamped once
 * at acquisition and never touched again, so "held for more than 10 seconds"
 * and "abandoned" were the same test - and any operation that legitimately
 * ran longer than that had its lock deleted out from under it by a waiter in
 * another process. Both then ran the critical section at once and finished
 * with `atomicWriteFile`, so the loser's memories were silently dropped
 * rather than merged.
 *
 * Two signals instead. A dead owner is abandoned immediately, however fresh
 * the file looks. A live owner is left alone unless its heartbeat has stopped
 * for longer than the stale window, which covers both a wedged holder and the
 * case where the recorded pid has been recycled by an unrelated process.
 */
/** @internal Exported for tests: this is where the reclaim decision lives. */
export async function isLockAbandoned(lockPath: string): Promise<boolean> {
	const owner = await readLockOwner(lockPath);
	// A dead owner is abandoned outright, however recently the file was
	// touched. A null owner means the file is unreadable or half-written, so
	// there is no pid to judge and only the heartbeat is left to go on.
	if (owner !== null && !isProcessAlive(owner)) return true;
	return await isHeartbeatStale(lockPath);
}

async function isHeartbeatStale(lockPath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(lockPath);
		return Date.now() - stat.mtimeMs > LOCK_STALE_MS;
	} catch {
		// Gone already; the retry will just take it.
		return false;
	}
}

/**
 * `open(..., 'wx')` failures that mean "someone else has the lock right now"
 * rather than "this can never work". EEXIST is the ordinary case. Windows
 * reports a lock file that another process is in the middle of deleting as
 * EPERM (sometimes EACCES or EBUSY) until the delete completes, so those are
 * waited out too instead of failing the save.
 */
const CONTENDED_CODES = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY']);

function errorCode(error: unknown): string | undefined {
	return error instanceof Error && 'code' in error
		? (error as NodeJS.ErrnoException).code
		: undefined;
}

/** Delete a lock or guard file only if this process wrote it. */
async function removeIfOwned(filePath: string): Promise<void> {
	try {
		const owner = (await fs.readFile(filePath, 'utf8')).trim();
		if (owner === String(process.pid)) {
			await fs.unlink(filePath);
		}
	} catch {
		// Already gone or taken over.
	}
}

/**
 * Remove a lock judged abandoned, without racing other waiters that judged
 * the same thing.
 *
 * Checking and deleting are two steps, so two waiters that both saw the dead
 * lock could interleave: one deletes it and takes a fresh lock, then the other
 * deletes that fresh lock, and both run the critical section. Reclaiming
 * therefore happens under a short guard lock (`<lock>.reclaim`), and while it
 * is held the lock is checked again - still abandoned, and still the same file
 * - so a lock taken since the waiter's first look is left alone. A guard left
 * behind by a waiter that died mid-reclaim is removed once it goes stale.
 *
 * Returns whether the lock was removed.
 */
async function reclaimAbandonedLock(lockPath: string): Promise<boolean> {
	const guardPath = `${lockPath}.reclaim`;
	let guard: FileHandle;
	try {
		guard = await fs.open(guardPath, 'wx', 0o600);
	} catch (error) {
		const code = errorCode(error);
		if (code === undefined || !CONTENDED_CODES.has(code)) throw error;
		// Another waiter is reclaiming; leave it to them unless it died there.
		if (await isHeartbeatStale(guardPath)) {
			await fs.unlink(guardPath).catch(() => {});
		}
		return false;
	}
	try {
		await guard.writeFile(String(process.pid), 'utf8');
		const judged = await fs.stat(lockPath);
		if (!(await isLockAbandoned(lockPath))) return false;
		const current = await fs.stat(lockPath);
		if (current.ino !== judged.ino || current.mtimeMs !== judged.mtimeMs) {
			return false;
		}
		await fs.unlink(lockPath);
		return true;
	} catch {
		// The lock went away or changed under us; the caller just retries.
		return false;
	} finally {
		await guard.close().catch(() => {});
		await removeIfOwned(guardPath);
	}
}

async function acquireLock(lockPath: string): Promise<FileHandle> {
	const deadline = Date.now() + LOCK_WAIT_MS;
	while (true) {
		try {
			return await fs.open(lockPath, 'wx', 0o600);
		} catch (error) {
			const code = errorCode(error);
			if (code === undefined || !CONTENDED_CODES.has(code)) throw error;
			if (Date.now() >= deadline) {
				throw new Error(
					`Timed out waiting for file lock: ${lockPath} (${code})`,
				);
			}
			if (
				(await isLockAbandoned(lockPath)) &&
				(await reclaimAbandonedLock(lockPath))
			) {
				continue;
			}
			await new Promise(resolve => setTimeout(resolve, 20));
		}
	}
}

/**
 * Run `operation` while holding the lock file at `lockPath`.
 *
 * Only creating the lock is retried. An error thrown by `operation` itself is
 * never mistaken for contention: it releases the lock and propagates.
 */
export async function withExclusiveLock<T>(
	lockPath: string,
	operation: () => Promise<T>,
): Promise<T> {
	const handle = await acquireLock(lockPath);
	// Keep the lock's mtime moving for as long as we hold it, so a waiter can
	// tell "still working" from "abandoned". Unref'd: this must never be the
	// thing keeping the process alive.
	const heartbeat = setInterval(() => {
		const now = new Date();
		fs.utimes(lockPath, now, now).catch(() => {
			// Lock removed under us; the release below notices.
		});
	}, LOCK_HEARTBEAT_MS);
	heartbeat.unref();
	try {
		await handle.writeFile(String(process.pid), 'utf8');
		return await operation();
	} finally {
		clearInterval(heartbeat);
		await handle.close();
		await removeIfOwned(lockPath);
	}
}
