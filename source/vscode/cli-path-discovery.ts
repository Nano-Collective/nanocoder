/**
 * Pure, vscode-free CLI discovery logic.
 *
 * This module contains no VS Code API imports so it can be unit-tested
 * directly with AVA under the root `source/**` glob.
 */

import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** The executable name(s) to look for, depending on platform. */
export function cliExecutableNames(): string[] {
	if (process.platform === 'win32') {
		return ['nanocoder.cmd', 'nanocoder'];
	}
	return ['nanocoder'];
}

/**
 * Probe a list of candidate absolute paths and return the first one that
 * exists on disk, or null if none do.
 */
export function findFirstExisting(candidates: string[]): string | null {
	for (const p of candidates) {
		if (fs.existsSync(p)) {
			return p;
		}
	}
	return null;
}

/**
 * Build a list of candidate paths for the nanocoder CLI binary, covering:
 *  - NVM  (~/.nvm or $NVM_DIR), all installed versions, newest-first
 *  - Volta (~/.volta)
 *  - fnm   ($FNM_DIR or ~/.local/share/fnm)
 *  - pnpm global bin ($PNPM_HOME or ~/.local/share/pnpm on Linux,
 *                     ~/Library/pnpm on macOS)
 *  - Bun  (~/.bun/bin)
 *  - n    (~/.n/bin)
 *  - npm global (~/.npm-global/bin)
 *  - Common system prefixes (/opt/homebrew, /usr/local, /opt/local)
 */
export function buildFallbackCandidates(home: string): string[] {
	const names = cliExecutableNames();

	const dirs: string[] = [];

	// --- NVM ---
	const nvmDir = process.env.NVM_DIR || path.join(home, '.nvm');
	const nvmNodeDir = path.join(nvmDir, 'versions', 'node');
	if (fs.existsSync(nvmNodeDir)) {
		try {
			const versions = fs.readdirSync(nvmNodeDir);
			// Sort newest first using numeric segment comparison
			versions.sort((a, b) => b.localeCompare(a, undefined, {numeric: true}));
			for (const version of versions) {
				dirs.push(path.join(nvmNodeDir, version, 'bin'));
			}
		} catch {
			// ignore
		}
	}

	// --- Volta ---
	const voltaDir = process.env.VOLTA_HOME || path.join(home, '.volta');
	dirs.push(path.join(voltaDir, 'bin'));

	// --- fnm ---
	const fnmDir =
		process.env.FNM_DIR || path.join(home, '.local', 'share', 'fnm');
	dirs.push(path.join(fnmDir, 'aliases', 'default', 'bin'));

	// --- pnpm global ---
	if (process.env.PNPM_HOME) {
		dirs.push(process.env.PNPM_HOME);
	} else if (process.platform === 'darwin') {
		dirs.push(path.join(home, 'Library', 'pnpm'));
	} else {
		// Linux / WSL
		dirs.push(path.join(home, '.local', 'share', 'pnpm'));
	}

	// --- Bun ---
	dirs.push(path.join(home, '.bun', 'bin'));

	// --- n ---
	dirs.push(path.join(home, '.n', 'bin'));

	// --- npm global ---
	dirs.push(path.join(home, '.npm-global', 'bin'));

	// --- System prefixes ---
	if (process.platform !== 'win32') {
		dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin');
	}

	// Expand every dir × every name
	const candidates: string[] = [];
	for (const dir of dirs) {
		for (const name of names) {
			candidates.push(path.join(dir, name));
		}
	}

	return candidates;
}

/**
 * Discover the nanocoder CLI binary using the login-shell PATH obtained from
 * `spawnEnv`.  Falls back to a hard-coded list of common global installation
 * directories if `which`/`where` fails (e.g. under the VS Code Remote
 * extension host whose PATH is a minimal launchd/systemd stub).
 *
 * Returns null when the CLI cannot be found.
 */
export async function discoverCliPath(
	spawnEnv: NodeJS.ProcessEnv,
): Promise<string | null> {
	// 1. Try which / where using the login-shell PATH
	const fromPath = await new Promise<string | null>(resolve => {
		const command =
			process.platform === 'win32' ? 'where.exe nanocoder' : 'which nanocoder';
		cp.exec(command, {env: spawnEnv}, (error, stdout) => {
			if (error || !stdout.trim()) {
				resolve(null);
			} else {
				// `where` may return multiple lines; take the first
				resolve(stdout.trim().split('\n')[0].trim());
			}
		});
	});

	if (fromPath) {
		return fromPath;
	}

	// 2. Hard-coded fallback directories (covers NVM, Volta, fnm, pnpm, bun…)
	const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
	if (!home) {
		return null;
	}

	return findFirstExisting(buildFallbackCandidates(home));
}

/**
 * Return whether a `node` binary lives in the same directory as `cliPath`.
 * Used to decide if we should prepend `cliDir` to PATH when spawning.
 */
export function nodeExistsAlongside(cliPath: string): boolean {
	const cliDir = path.dirname(cliPath);
	const nodeExe = process.platform === 'win32' ? 'node.exe' : 'node';
	return fs.existsSync(path.join(cliDir, nodeExe));
}
