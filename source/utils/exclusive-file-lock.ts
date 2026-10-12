import fs from 'node:fs/promises';

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

export async function withExclusiveLock<T>(
	lockPath: string,
	operation: () => Promise<T>,
): Promise<T> {
	const deadline = Date.now() + LOCK_WAIT_MS;
	while (true) {
		try {
			const handle = await fs.open(lockPath, 'wx', 0o600);
			// Keep the lock's mtime moving for as long as we hold it, so a
			// waiter can tell "still working" from "abandoned". Unref'd: this
			// must never be the thing keeping the process alive.
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
				try {
					const owner = (await fs.readFile(lockPath, 'utf8')).trim();
					if (owner === String(process.pid)) {
						await fs.unlink(lockPath);
					}
				} catch {
					// Lock already gone or stolen.
				}
			}
		} catch (error) {
			const code =
				error instanceof Error && 'code' in error
					? (error as NodeJS.ErrnoException).code
					: undefined;
			if (code !== 'EEXIST') throw error;
			if (Date.now() >= deadline) {
				throw new Error(`Timed out waiting for file lock: ${lockPath}`);
			}
			if (await isLockAbandoned(lockPath)) {
				try {
					await fs.unlink(lockPath);
				} catch {
					// Someone else reclaimed it first; retry the create.
				}
				continue;
			}
			await new Promise(resolve => setTimeout(resolve, 20));
		}
	}
}
