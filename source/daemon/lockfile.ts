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

import {createHash, randomBytes} from 'node:crypto';
import {existsSync, mkdirSync} from 'node:fs';
import {readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, posix} from 'node:path';

export interface DaemonLock {
	pid: number;
	socketPath: string;
	startedAt: number;
	projectRoot: string;
}

export function getLockfilePath(projectRoot: string): string {
	return join(projectRoot, '.nanocoder', 'daemon.json');
}

/** Short, stable per-project discriminator for socket and pipe names. */
function projectHash(projectRoot: string): string {
	return createHash('sha256').update(projectRoot).digest('hex').slice(0, 10);
}

/**
 * Bytes available in `sockaddr_un.sun_path`. A path of exactly this length
 * still binds (macOS carries an explicit `sun_len`, Linux tolerates an
 * unterminated path), so the check downstream is `>`, not `>=`.
 */
function sunPathCapacity(platform: string): number {
	return platform === 'darwin' ? 104 : 108;
}

/**
 * Pure resolver behind {@link getSocketPath}. `platform` and `tmpDir` are
 * parameters rather than reads of `process.platform` / `os.tmpdir()` so every
 * branch is exercisable from any OS - CI only runs Linux, and the interesting
 * branches are the macOS and Windows ones.
 */
export function resolveSocketPath(
	projectRoot: string,
	platform: string,
	tmpDir: string,
): string {
	if (platform === 'win32') {
		// Node's net.createServer().listen(path) on Windows requires the
		// `\\.\pipe\` prefix to bind a named pipe. The hash keeps each
		// project's pipe in its own slot of the global pipe namespace.
		return `\\\\.\\pipe\\nanocoder-daemon-${projectHash(projectRoot)}`;
	}

	// posix.join rather than join: on a non-Windows target the separator is
	// always '/', and this keeps the resolver honest when `platform` is
	// injected by a test running on Windows.
	const projectSock = posix.join(projectRoot, '.nanocoder', 'daemon.sock');
	const capacity = sunPathCapacity(platform);
	if (Buffer.byteLength(projectSock) <= capacity) return projectSock;

	// Over capacity, libuv does not fail - it silently truncates the path to
	// `capacity` bytes. The daemon then reports a socket it never bound, its
	// own stale-socket cleanup misses the real file, and two projects sharing
	// a `capacity`-byte prefix collide on one socket. So the moment the
	// project-local path is too long we stop carrying the unbounded
	// projectRoot into the socket name at all, and hash it instead.
	const name = `nanocoder-daemon-${projectHash(projectRoot)}.sock`;
	const tmpSock = posix.join(tmpDir, name);
	if (Buffer.byteLength(tmpSock) <= capacity) return tmpSock;

	// A long TMPDIR can push even the hashed name over the limit, which would
	// put us right back in truncation territory. `/tmp` plus a fixed-length
	// name is 37 bytes, so this last resort always fits.
	return posix.join('/tmp', name);
}

/**
 * IPC endpoint path. Unix-like: a project-local AF_UNIX socket file, or a
 * hashed name under the temp dir when the project-local path would exceed
 * `sockaddr_un.sun_path`. Windows: a named pipe whose name embeds a hash of
 * the project root so multiple projects each get their own pipe namespace.
 * The path is stored verbatim in the lockfile, so clients read it back
 * regardless of platform.
 */
export function getSocketPath(projectRoot: string): string {
	return resolveSocketPath(projectRoot, process.platform, tmpdir());
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
