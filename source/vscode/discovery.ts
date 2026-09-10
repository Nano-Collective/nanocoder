/**
 * Discovery file for the VS Code WebSocket companion.
 *
 * The companion server (`nanocoder --vscode`) binds to an ephemeral loopback
 * port and mints a per-session random token, then writes the two values to a
 * well-known JSON file under the user's nanocoder config directory. The VS
 * Code extension reads the file to learn where (and how) to connect.
 *
 * Threat model
 * ------------
 * Anyone who can read the user's config directory can already act as that
 * user on the same machine, so writing the token to disk does not widen the
 * trust boundary: the only adversary it protects against is one who can
 * observe the loopback network traffic but cannot read the user's files.
 * The token therefore lives in an `Authorization: Bearer <token>` header
 * during the WebSocket upgrade, never in the URL. Query strings are routinely
 * logged by HTTP intermediaries; loopback has none of those but using a
 * header keeps the rationale honest and the door closed if anything TLS-
 * terminating ever sits in front of the socket.
 *
 * Stale detection
 * ---------------
 * Each file records the PID of the CLI that wrote it. On read we ask the
 * kernel whether that PID is still alive; if not, the file is treated as
 * missing so a crashed CLI cannot hold the port hostage.
 *
 * This module is intentionally self-contained (no `@/...` aliases) so the VS
 * Code extension can bundle it via esbuild without having to teach the
 * bundler about the source tree's path aliases.
 */

import {randomBytes, timingSafeEqual} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';

/** Filename written under the user's nanocoder config directory. */
export const VSCODE_DISCOVERY_FILENAME = 'vscode-server.json';

/** Schema version written into the discovery file. Bump on breaking changes. */
export const VSCODE_DISCOVERY_VERSION = 1;

/** Number of random bytes (32) → 256 bits, hex-encoded as a 64-char string. */
const TOKEN_BYTES = 32;

/**
 * Information about a running companion server, persisted to disk so the VS
 * Code extension can locate it.
 */
export interface ServerDiscovery {
	/** Schema version (currently always `1`). */
	version: number;
	/** Resolved TCP port the WebSocket server is listening on. */
	port: number;
	/** Per-session bearer token; must be presented on the WebSocket upgrade. */
	token: string;
	/** PID of the CLI process that wrote the file (for stale-detection). */
	pid: number;
	/** CLI version that produced this file. */
	cliVersion: string;
	/** Wall-clock time at which the file was written (ms since epoch). */
	startedAt: number;
}

/**
 * Generate a fresh, cryptographically random session token. The token is the
 * only thing standing between an attacker and a complete takeover of the
 * running agent, so it must be unguessable.
 */
export function generateServerToken(): string {
	return randomBytes(TOKEN_BYTES).toString('hex');
}

/**
 * Resolve the user's nanocoder config directory the same way the CLI does,
 * so the writer (CLI) and reader (extension) agree on the location without
 * either having to import the shared `paths` module.
 *
 * Mirrors `getConfigPath` from `@/config/paths` so the two sides stay in
 * sync without sharing code at build time. Update both if a new platform
 * rule is added.
 */
export function getDefaultConfigDir(): string {
	if (process.env.NANOCODER_CONFIG_DIR) {
		return process.env.NANOCODER_CONFIG_DIR;
	}

	let base: string;
	switch (process.platform) {
		case 'win32':
			base = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
			break;
		case 'darwin':
			base = join(homedir(), 'Library', 'Preferences');
			break;
		default:
			base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
	}
	return join(base, 'nanocoder');
}

/**
 * Absolute path to the discovery file under the user's nanocoder config
 * directory. Exposed so callers (notably the VS Code extension side, when
 * unit-tested) can stub or relocate it.
 */
export function getDiscoveryFilePath(configDir?: string): string {
	const base = configDir ?? getDefaultConfigDir();
	return join(base, VSCODE_DISCOVERY_FILENAME);
}

/**
 * Test whether the process with the given PID is still alive, without
 * sending it a signal. Uses the canonical `kill(pid, 0)` probe, which
 * returns/throws based on EPERM/ESRCH rather than actually killing anything.
 *
 * - On POSIX this works as advertised.
 * - On Windows, signal 0 is also supported by Node's `process.kill` and
 *   returns the same way for missing PIDs (throws `ESRCH`).
 *
 * Returns `false` if the check itself throws or if the supplied PID is
 * non-positive (defensively, since neither OS will ever reuse pid 0 or 1
 * for a regular user process).
 */
export function isProcessAlive(pid: number): boolean {
	if (!Number.isFinite(pid) || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (
			error &&
			typeof error === 'object' &&
			'code' in error &&
			((error as {code?: string}).code === 'ESRCH' ||
				(error as {code?: string}).code === 'EPERM')
		) {
			// EPERM means the process exists but we can't signal it - that's
			// still "alive" from our point of view, so honour it. We only
			// treat ESRCH (no such process) as dead.
			return (error as {code?: string}).code === 'EPERM';
		}
		return false;
	}
}

/**
 * Persist `info` atomically: write to a sibling temp file, then rename over
 * the destination so a concurrent reader can never observe a half-written
 * JSON document.
 */
export async function writeDiscoveryFile(
	filePath: string,
	info: ServerDiscovery,
): Promise<void> {
	const dir = dirname(filePath);
	if (!existsSync(dir)) {
		await mkdir(dir, {recursive: true});
	}

	const json = JSON.stringify(info);
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tempPath, json, {mode: 0o600});
	try {
		// Atomic on POSIX; on Windows, `rename` overwrites silently, which is
		// also what we want here.
		await rename(tempPath, filePath);
	} catch (error) {
		// Clean up the temp file on rename failure so we don't leak secrets.
		try {
			await unlink(tempPath);
		} catch {
			// Best-effort cleanup; the original error is more useful.
		}
		throw error;
	}
}

/**
 * Read the discovery file. Returns `null` when the file does not exist,
 * is unreadable, has the wrong shape, or describes a PID that is no
 * longer alive (stale). The extension should treat all of these as
 * "not yet ready" rather than as fatal errors.
 */
export async function readDiscoveryFile(
	filePath: string,
): Promise<ServerDiscovery | null> {
	let parsed: Partial<ServerDiscovery> | null = null;
	try {
		const raw = await readFile(filePath, 'utf-8');
		parsed = JSON.parse(raw) as Partial<ServerDiscovery>;
	} catch (error) {
		if (
			error &&
			typeof error === 'object' &&
			'code' in error &&
			(error as {code?: string}).code === 'ENOENT'
		) {
			return null;
		}
		// Corrupt or unreadable file: treat as "no server running" rather than
		// than crashing the extension. The CLI will overwrite it on next start.
		return null;
	}

	if (
		!parsed ||
		typeof parsed.port !== 'number' ||
		typeof parsed.token !== 'string' ||
		typeof parsed.pid !== 'number'
	) {
		return null;
	}

	// Stale detection: if the PID is no longer alive, the CLI that wrote
	// this file is gone. Treat the entry as missing so a crashed CLI cannot
	// hold the port hostage - the next start() overwrites it.
	if (!isProcessAlive(parsed.pid)) {
		return null;
	}

	return {
		version:
			typeof parsed.version === 'number'
				? parsed.version
				: VSCODE_DISCOVERY_VERSION,
		port: parsed.port,
		token: parsed.token,
		pid: parsed.pid,
		cliVersion:
			typeof parsed.cliVersion === 'string' ? parsed.cliVersion : '0.0.0',
		startedAt:
			typeof parsed.startedAt === 'number' ? parsed.startedAt : Date.now(),
	};
}

/**
 * Remove the discovery file. Ignores "missing" so it is safe to call during
 * shutdown without checking first.
 *
 * If `expectedPid` is supplied and the on-disk file describes a different
 * PID, the file is left alone: another CLI instance owns the path and
 * unlinking it would orphan its server (live or stale - either way it is
 * not ours to remove). Callers that want unconditional removal (e.g.
 * tests) may pass `undefined`.
 *
 * The on-disk pid is read raw rather than via {@link readDiscoveryFile},
 * so a stale-but-foreign entry is also left alone.
 */
export async function clearDiscoveryFile(
	filePath: string,
	expectedPid?: number,
): Promise<void> {
	if (expectedPid !== undefined) {
		const ownerPid = await readDiscoveryFilePidRaw(filePath);
		if (ownerPid !== null && ownerPid !== expectedPid) {
			// Owned by another process; do not touch.
			return;
		}
	}
	try {
		await unlink(filePath);
	} catch (error) {
		if (
			error &&
			typeof error === 'object' &&
			'code' in error &&
			(error as {code?: string}).code !== 'ENOENT'
		) {
			throw error;
		}
	}
}

/**
 * Read the `pid` field from the discovery file without applying the
 * stale-detection filter. Used by {@link clearDiscoveryFile} so that an
 * ownership check works against stale-but-foreign entries too.
 */
async function readDiscoveryFilePidRaw(
	filePath: string,
): Promise<number | null> {
	try {
		const raw = await readFile(filePath, 'utf-8');
		const parsed = JSON.parse(raw) as {pid?: unknown};
		return typeof parsed.pid === 'number' ? parsed.pid : null;
	} catch {
		return null;
	}
}

/**
 * Constant-time equality check suitable for comparing unguessable tokens.
 * Length-mismatch is also handled in constant time so the comparison cannot
 * leak the expected length.
 */
export function safeEqualToken(a: string, b: string): boolean {
	const aBuf = Buffer.from(a, 'utf-8');
	const bBuf = Buffer.from(b, 'utf-8');
	if (aBuf.length !== bBuf.length) {
		// Compare against a same-length dummy so timing does not depend on the
		// attacker's input length.
		const dummy = Buffer.alloc(aBuf.length);
		timingSafeEqual(aBuf, dummy);
		return false;
	}
	return timingSafeEqual(aBuf, bBuf);
}
