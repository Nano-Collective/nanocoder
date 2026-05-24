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
 * Windows: registers a per-user Scheduled Task via `schtasks /Create`
 * with an ONLOGON trigger. The task name embeds the same project-path
 * hash, so multiple projects each get their own task without clobbering.
 *
 * All operations are idempotent: install over an existing install is a
 * no-op (replaces the file/task), and uninstall on a missing install is
 * a no-op.
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

export type AutoStartPlatform = 'darwin' | 'linux' | 'win32' | 'unsupported';

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
	if (process.platform === 'win32') return 'win32';
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

/**
 * Per-project Scheduled Task name. We write the XML to disk for
 * `schtasks /XML` and reference the task by this name in subsequent
 * uninstall / status checks.
 */
export function scheduledTaskName(hash: string): string {
	return `nanocoder-daemon-${hash}`;
}

/**
 * Where the generated task XML lives. Per-user, hash-scoped so multiple
 * projects don't collide.
 */
export function scheduledTaskXmlPath(home: string, hash: string): string {
	return join(
		home,
		'AppData',
		'Local',
		'nanocoder',
		'tasks',
		`nanocoder-daemon-${hash}.xml`,
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

/**
 * XML escape for the fields we inject into the Task Scheduler manifest.
 * Project paths can contain `&`, `<`, `'`, etc. in extreme cases.
 */
function xmlEscape(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/**
 * Build a Task Scheduler XML manifest for the daemon. ONLOGON trigger
 * runs the daemon at each user login; `RestartOnFailure` keeps it up
 * if it crashes (mirroring launchd `KeepAlive` and systemd `Restart`).
 */
export function buildScheduledTaskXml(
	projectRoot: string,
	hash: string,
	daemonCommand: string,
): string {
	const root = xmlEscape(projectRoot);
	return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
\t<RegistrationInfo>
\t\t<Description>nanocoder daemon for ${root} (hash ${hash})</Description>
\t</RegistrationInfo>
\t<Triggers>
\t\t<LogonTrigger>
\t\t\t<Enabled>true</Enabled>
\t\t</LogonTrigger>
\t</Triggers>
\t<Settings>
\t\t<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
\t\t<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
\t\t<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
\t\t<AllowHardTerminate>true</AllowHardTerminate>
\t\t<StartWhenAvailable>true</StartWhenAvailable>
\t\t<RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
\t\t<IdleSettings>
\t\t\t<StopOnIdleEnd>false</StopOnIdleEnd>
\t\t\t<RestartOnIdle>false</RestartOnIdle>
\t\t</IdleSettings>
\t\t<AllowStartOnDemand>true</AllowStartOnDemand>
\t\t<Enabled>true</Enabled>
\t\t<Hidden>false</Hidden>
\t\t<RestartOnFailure>
\t\t\t<Interval>PT1M</Interval>
\t\t\t<Count>3</Count>
\t\t</RestartOnFailure>
\t\t<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
\t\t<Priority>7</Priority>
\t</Settings>
\t<Actions>
\t\t<Exec>
\t\t\t<Command>${xmlEscape(daemonCommand)}</Command>
\t\t\t<Arguments>daemon start</Arguments>
\t\t\t<WorkingDirectory>${root}</WorkingDirectory>
\t\t</Exec>
\t</Actions>
</Task>
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

	if (platform === 'win32') {
		const target = scheduledTaskXmlPath(home, hash);
		mkdirSync(dirname(target), {recursive: true});
		const contents = buildScheduledTaskXml(
			opts.projectRoot,
			hash,
			daemonCommand,
		);
		// Task Scheduler XML must be UTF-16 LE with a BOM.
		await writeFile(target, `﻿${contents}`, 'utf16le');
		if (loadService) {
			try {
				await execFileAsync('schtasks', [
					'/Create',
					'/XML',
					target,
					'/TN',
					scheduledTaskName(hash),
					'/F', // overwrite if it exists (idempotent install)
				]);
			} catch (err) {
				return {
					platform,
					written: target,
					message: `Wrote ${target} but schtasks /Create failed: ${err instanceof Error ? err.message : String(err)}`,
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

	if (platform === 'win32') {
		const target = scheduledTaskXmlPath(home, hash);
		if (loadService) {
			// Best-effort. The task may not exist (idempotent uninstall) or
			// schtasks may not be on PATH in unusual environments.
			await execFileAsync('schtasks', [
				'/Delete',
				'/TN',
				scheduledTaskName(hash),
				'/F',
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
	if (platform === 'win32') return existsSync(scheduledTaskXmlPath(home, hash));
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
	let path: string | null = null;
	if (platform === 'darwin') path = launchAgentPath(home, hash);
	else if (platform === 'linux') path = systemdUnitPath(home, hash);
	else if (platform === 'win32') path = scheduledTaskXmlPath(home, hash);
	if (!path || !existsSync(path)) return null;
	// Windows writes UTF-16 LE with a BOM (Task Scheduler requirement);
	// other platforms write UTF-8. fs.readFile auto-handles the BOM when
	// the encoding hint matches.
	const encoding = platform === 'win32' ? 'utf16le' : 'utf-8';
	const contents = await readFile(path, encoding);
	// Strip the UTF-16 BOM if present so callers see clean XML.
	return contents.replace(/^﻿/, '');
}
