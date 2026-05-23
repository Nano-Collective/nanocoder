/**
 * Auto-start install/uninstall for the per-project daemon.
 *
 * macOS: writes a LaunchAgent plist under `~/Library/LaunchAgents/` and
 * loads it via `launchctl bootstrap`. The plist's `Label` and filename
 * include a short hash of the absolute project path so multiple projects
 * each get their own agent without clobbering.
 *
 * Linux: writes a systemd user unit under `~/.config/systemd/user/` and
 * enables it via `systemctl --user enable --now`.
 *
 * Windows: out of scope - `install` reports manual fallback instructions.
 *
 * Both operations are idempotent: install over an existing install is a
 * no-op, and uninstall on a missing install is a no-op.
 *
 * See `agents/2026-05-20-skills-unification-plan.md` step 20.
 */

import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync} from 'node:fs';
import {readFile, unlink, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

export type AutoStartPlatform = 'darwin' | 'linux' | 'unsupported';

export interface InstallOptions {
	projectRoot: string;
	/** Override the path to the daemon CLI entry. Defaults to the resolved bin. */
	daemonCommand?: string;
	/** Override the platform target. Tests pin this to get deterministic output. */
	platform?: AutoStartPlatform;
	/** Override `homedir()` for testing. */
	home?: string;
	/**
	 * Whether the install function may shell out to `launchctl` / `systemctl`.
	 * Defaults to true. Tests pass false to verify file generation only.
	 */
	loadService?: boolean;
}

export interface InstallResult {
	platform: AutoStartPlatform;
	written?: string;
	message: string;
}

export function platformOf(override?: AutoStartPlatform): AutoStartPlatform {
	if (override) return override;
	if (process.platform === 'darwin') return 'darwin';
	if (process.platform === 'linux') return 'linux';
	return 'unsupported';
}

export function projectHash(projectRoot: string): string {
	return createHash('sha256').update(projectRoot).digest('hex').slice(0, 10);
}

export function launchAgentPath(home: string, hash: string): string {
	return join(
		home,
		'Library',
		'LaunchAgents',
		`com.nanocoder.daemon.${hash}.plist`,
	);
}

export function systemdUnitPath(home: string, hash: string): string {
	return join(
		home,
		'.config',
		'systemd',
		'user',
		`nanocoder-daemon-${hash}.service`,
	);
}

export function buildLaunchAgentPlist(
	projectRoot: string,
	hash: string,
	daemonCommand: string,
): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>com.nanocoder.daemon.${hash}</string>
\t<key>ProgramArguments</key>
\t<array>
\t\t<string>${daemonCommand}</string>
\t\t<string>daemon</string>
\t\t<string>start</string>
\t</array>
\t<key>WorkingDirectory</key>
\t<string>${projectRoot}</string>
\t<key>EnvironmentVariables</key>
\t<dict>
\t\t<key>NANOCODER_PROJECT_ROOT</key>
\t\t<string>${projectRoot}</string>
\t</dict>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<true/>
</dict>
</plist>
`;
}

export function buildSystemdUnit(
	projectRoot: string,
	hash: string,
	daemonCommand: string,
): string {
	return `[Unit]
Description=nanocoder daemon for ${projectRoot}
After=default.target

[Service]
Type=simple
WorkingDirectory=${projectRoot}
Environment=NANOCODER_PROJECT_ROOT=${projectRoot}
ExecStart=${daemonCommand} daemon start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

export async function installAutoStart(
	opts: InstallOptions,
): Promise<InstallResult> {
	const platform = platformOf(opts.platform);
	const home = opts.home ?? homedir();
	const daemonCommand = opts.daemonCommand ?? 'nanocoder';
	const loadService = opts.loadService ?? true;
	const hash = projectHash(opts.projectRoot);

	if (platform === 'darwin') {
		const target = launchAgentPath(home, hash);
		mkdirSync(dirname(target), {recursive: true});
		const contents = buildLaunchAgentPlist(
			opts.projectRoot,
			hash,
			daemonCommand,
		);
		await writeFile(target, contents, 'utf-8');
		if (loadService) {
			try {
				await execFileAsync('launchctl', ['unload', target]).catch(() => {
					/* ignore - may not be loaded */
				});
				await execFileAsync('launchctl', ['load', target]);
			} catch (err) {
				return {
					platform,
					written: target,
					message: `Wrote ${target} but launchctl load failed: ${err instanceof Error ? err.message : String(err)}`,
				};
			}
		}
		return {
			platform,
			written: target,
			message: `Auto-start installed for ${opts.projectRoot}.`,
		};
	}

	if (platform === 'linux') {
		const target = systemdUnitPath(home, hash);
		mkdirSync(dirname(target), {recursive: true});
		const contents = buildSystemdUnit(opts.projectRoot, hash, daemonCommand);
		await writeFile(target, contents, 'utf-8');
		if (loadService) {
			try {
				await execFileAsync('systemctl', ['--user', 'daemon-reload']);
				await execFileAsync('systemctl', [
					'--user',
					'enable',
					'--now',
					`nanocoder-daemon-${hash}.service`,
				]);
			} catch (err) {
				return {
					platform,
					written: target,
					message: `Wrote ${target} but systemctl enable failed: ${err instanceof Error ? err.message : String(err)}`,
				};
			}
		}
		return {
			platform,
			written: target,
			message: `Auto-start installed for ${opts.projectRoot}.`,
		};
	}

	return {
		platform: 'unsupported',
		message:
			'Auto-start is not supported on this platform. Run `nanocoder daemon start` manually.',
	};
}

export async function uninstallAutoStart(
	opts: InstallOptions,
): Promise<InstallResult> {
	const platform = platformOf(opts.platform);
	const home = opts.home ?? homedir();
	const loadService = opts.loadService ?? true;
	const hash = projectHash(opts.projectRoot);

	if (platform === 'darwin') {
		const target = launchAgentPath(home, hash);
		if (loadService && existsSync(target)) {
			await execFileAsync('launchctl', ['unload', target]).catch(() => {
				/* ignore */
			});
		}
		await tryUnlink(target);
		return {
			platform,
			written: target,
			message: existsSync(target)
				? `Could not remove ${target} (still present).`
				: `Auto-start uninstalled for ${opts.projectRoot}.`,
		};
	}

	if (platform === 'linux') {
		const target = systemdUnitPath(home, hash);
		if (loadService && existsSync(target)) {
			await execFileAsync('systemctl', [
				'--user',
				'disable',
				'--now',
				`nanocoder-daemon-${hash}.service`,
			]).catch(() => {
				/* ignore */
			});
		}
		await tryUnlink(target);
		return {
			platform,
			written: target,
			message: existsSync(target)
				? `Could not remove ${target} (still present).`
				: `Auto-start uninstalled for ${opts.projectRoot}.`,
		};
	}

	return {
		platform: 'unsupported',
		message: 'Auto-start is not supported on this platform; nothing to do.',
	};
}

export async function isAutoStartInstalled(
	opts: InstallOptions,
): Promise<boolean> {
	const platform = platformOf(opts.platform);
	const home = opts.home ?? homedir();
	const hash = projectHash(opts.projectRoot);
	if (platform === 'darwin') return existsSync(launchAgentPath(home, hash));
	if (platform === 'linux') return existsSync(systemdUnitPath(home, hash));
	return false;
}

async function tryUnlink(target: string): Promise<void> {
	try {
		await unlink(target);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== 'ENOENT') throw err;
	}
}

/** Exported for spec parity / read-only confirmation. */
export async function readUnitOrPlist(
	opts: InstallOptions,
): Promise<string | null> {
	const platform = platformOf(opts.platform);
	const home = opts.home ?? homedir();
	const hash = projectHash(opts.projectRoot);
	const path =
		platform === 'darwin'
			? launchAgentPath(home, hash)
			: platform === 'linux'
				? systemdUnitPath(home, hash)
				: null;
	if (!path || !existsSync(path)) return null;
	return readFile(path, 'utf-8');
}
