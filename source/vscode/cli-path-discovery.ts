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

/**
 * `path.join` over segments that are all local to this machine: the current
 * user's home directory, env vars naming their own toolchain install dirs, and
 * string literals. Nothing here is derived from a request, a config file or any
 * other outside input, which is what semgrep's path-traversal rule is looking
 * for - hence one suppression here rather than on every call site below.
 */
// nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal
const joinLocal = (...segments: string[]): string => path.join(...segments);

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
	const nvmDir = process.env.NVM_DIR || joinLocal(home, '.nvm');
	const nvmNodeDir = joinLocal(nvmDir, 'versions', 'node');
	if (fs.existsSync(nvmNodeDir)) {
		try {
			const versions = fs.readdirSync(nvmNodeDir);
			// Sort newest first using numeric segment comparison
			versions.sort((a, b) => b.localeCompare(a, undefined, {numeric: true}));
			for (const version of versions) {
				dirs.push(joinLocal(nvmNodeDir, version, 'bin'));
			}
		} catch {
			// ignore
		}
	}

	// --- Volta ---
	const voltaDir = process.env.VOLTA_HOME || joinLocal(home, '.volta');
	dirs.push(joinLocal(voltaDir, 'bin'));

	// --- fnm ---
	const fnmDir =
		process.env.FNM_DIR || joinLocal(home, '.local', 'share', 'fnm');
	dirs.push(joinLocal(fnmDir, 'aliases', 'default', 'bin'));

	// --- pnpm global ---
	if (process.env.PNPM_HOME) {
		dirs.push(process.env.PNPM_HOME);
	} else if (process.platform === 'darwin') {
		dirs.push(joinLocal(home, 'Library', 'pnpm'));
	} else {
		// Linux / WSL
		dirs.push(joinLocal(home, '.local', 'share', 'pnpm'));
	}

	// --- Bun ---
	dirs.push(joinLocal(home, '.bun', 'bin'));

	// --- n ---
	dirs.push(joinLocal(home, '.n', 'bin'));

	// --- npm global ---
	dirs.push(joinLocal(home, '.npm-global', 'bin'));

	// --- System prefixes ---
	if (process.platform !== 'win32') {
		dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin');
	}

	// Expand every dir × every name
	const candidates: string[] = [];
	for (const dir of dirs) {
		for (const name of names) {
			candidates.push(joinLocal(dir, name));
		}
	}

	return candidates;
}

/** Directly spawnable Windows extensions, most preferred first. */
const WINDOWS_EXECUTABLE_EXTENSIONS = ['.exe', '.cmd', '.bat'];

/**
 * Choose the usable match from `where.exe` output.
 *
 * npm installs both a `nanocoder.cmd` shim and an extensionless POSIX shim
 * into the same directory, and `where.exe` lists the extensionless one first.
 * That file is a shell script Windows cannot execute, so taking line 0 blindly
 * makes the later spawn fail with ENOENT. Rank by extension instead and only
 * accept an extensionless match when there is nothing better.
 */
export function pickWindowsExecutable(lines: string[]): string | null {
	const candidates = lines.map(line => line.trim()).filter(Boolean);
	if (candidates.length === 0) {
		return null;
	}

	for (const ext of WINDOWS_EXECUTABLE_EXTENSIONS) {
		const match = candidates.find(candidate =>
			candidate.toLowerCase().endsWith(ext),
		);
		if (match) {
			return match;
		}
	}

	return candidates[0];
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
				const lines = stdout.trim().split('\n');
				resolve(
					process.platform === 'win32'
						? pickWindowsExecutable(lines)
						: lines[0].trim(),
				);
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
	return fs.existsSync(joinLocal(cliDir, nodeExe));
}

/**
 * Both shim flavours npm/pnpm/yarn generate reference the real entrypoint
 * relative to the shim's own directory: `%dp0%\…` or `%~dp0\…` in the `.cmd`,
 * `$basedir/…` in the extensionless POSIX one. Requiring that prefix is what
 * keeps the `.exe` and `PATHEXT` lines around it from matching.
 */
const SHIM_SCRIPT_PATTERN = /(?:%~?dp0%?|\$basedir)[\\/]([^"'\s]+\.[cm]?js)/;

/** A shim is a few hundred bytes; anything larger is a real binary. */
const MAX_SHIM_BYTES = 64 * 1024;

/**
 * Resolve the JavaScript entrypoint behind a package-manager shim, so the CLI
 * can be launched as `node <script>` rather than by executing the shim.
 *
 * This is what makes Windows work: the extensionless shim is not executable
 * there, and Node has refused to spawn `.cmd`/`.bat` without `shell: true`
 * since the CVE-2024-27980 fix, so neither shim can be spawned directly.
 *
 * Returns null when `cliPath` is not a shim (a real binary, or the symlink npm
 * creates on unix) or when the referenced script is missing.
 */
export function resolveShimScript(cliPath: string): string | null {
	if (/\.[cm]?js$/i.test(cliPath)) {
		return fs.existsSync(cliPath) ? cliPath : null;
	}
	if (/\.exe$/i.test(cliPath)) {
		return null;
	}

	let contents: string;
	try {
		const stats = fs.statSync(cliPath);
		if (!stats.isFile() || stats.size > MAX_SHIM_BYTES) {
			return null;
		}
		contents = fs.readFileSync(cliPath, 'utf8');
	} catch {
		return null;
	}

	const match = contents.match(SHIM_SCRIPT_PATTERN);
	if (!match) {
		return null;
	}

	// The shim body is the one input here this module does not construct itself,
	// so keep the target inside the shim's own directory tree - which is where
	// every npm/pnpm/yarn layout puts it. A shim pointing outside is either a
	// layout we do not understand or a tampered one; either way the caller falls
	// back to launching the shim itself.
	const shimDir = path.resolve(path.dirname(cliPath)); // nosemgrep
	const relative = match[1].split(/[\\/]/).join(path.sep);
	// Traversal is contained by the check immediately below, which semgrep's
	// rule does not recognise as a sanitiser.
	const script = path.resolve(shimDir, relative); // nosemgrep
	if (!script.startsWith(shimDir + path.sep)) {
		return null;
	}

	return fs.existsSync(script) ? script : null;
}

/** How to hand the CLI to `child_process.spawn`. */
export interface CliSpawnPlan {
	command: string;
	args: string[];
	shell: boolean;
}

/**
 * Work out how to launch `cliPath`, which may be an absolute binary, the
 * `node <script>` form used by the local-development fallback, or a Windows
 * package-manager shim.
 *
 * Preference order: run the resolved JS entrypoint through node (no shell), or
 * fall back to letting cmd.exe run a `.cmd`/`.bat` whose entrypoint could not
 * be resolved, or spawn the path directly.
 *
 * Throws when a shell launch would be required for a path containing a double
 * quote - Windows paths cannot contain one, so this only ever fires on input
 * that could otherwise break out of the quoting.
 */
export function planCliSpawn(cliPath: string, args: string[]): CliSpawnPlan {
	if (cliPath.startsWith('node ')) {
		return {command: 'node', args: [cliPath.slice(5), ...args], shell: false};
	}

	// Unix spawns the binary directly and lets its shebang pick node, which has
	// always worked; only Windows needs the shim indirection.
	if (process.platform === 'win32') {
		const script = resolveShimScript(cliPath);
		if (script) {
			return {command: 'node', args: [script, ...args], shell: false};
		}

		if (/\.(cmd|bat)$/i.test(cliPath)) {
			if (cliPath.includes('"')) {
				throw new Error(
					`Refusing to shell-spawn a CLI path containing a double quote: ${cliPath}`,
				);
			}
			// Node does not quote the command for shell spawns, so paths under
			// e.g. C:\Users\First Last\ have to be quoted here.
			return {command: `"${cliPath}"`, args, shell: true};
		}
	}

	return {command: cliPath, args, shell: false};
}
