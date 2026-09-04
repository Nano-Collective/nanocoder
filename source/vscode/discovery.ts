/**
 * Discovery file for the VS Code WebSocket companion.
 *
 * The companion server (`nanocoder --vscode`) binds to an ephemeral loopback
 * port and mints a per-session random token, then writes the two values to a
 * well-known JSON file under the user's nanocoder config directory. The VS
 * Code extension reads the file to learn where (and how) to connect.
 *
 * Publishing the port and token together replaces the old fixed-port fallback
 * scan with a discovery step. Anyone who can read the user's config directory
 * can already access anything else on the machine, so this does not weaken the
 * security boundary; it merely keeps the token off the wire during the
 * upgrade, where a passive observer could otherwise pick it up.
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
 * Mirrors {@link import('@/config/paths').getConfigPath} so the two sides
 * stay in sync without sharing code at build time. Update both if a new
 * platform rule is added.
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
 * Read the discovery file. Returns `null` when the file does not exist or is
 * unreadable - both are normal during startup, before the CLI has written
 * the file, and the extension should treat them as "not yet ready" rather
 * than as fatal errors.
 */
export async function readDiscoveryFile(
	filePath: string,
): Promise<ServerDiscovery | null> {
	try {
		const raw = await readFile(filePath, 'utf-8');
		const parsed = JSON.parse(raw) as Partial<ServerDiscovery>;
		if (
			typeof parsed.port !== 'number' ||
			typeof parsed.token !== 'string' ||
			typeof parsed.pid !== 'number'
		) {
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
}

/**
 * Remove the discovery file. Ignores "missing" so it is safe to call during
 * shutdown without checking first.
 */
export async function clearDiscoveryFile(filePath: string): Promise<void> {
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
