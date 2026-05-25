/**
 * CLI surface for `nanocoder daemon <subcommand>`. Each handler returns a
 * `{exitCode, output}` pair so the wiring in `cli.tsx` (step 21) can fan
 * those to the right stdout/stderr streams without each handler needing
 * to know.
 *
 * `start` is special: it must spawn the daemon entry point detached from
 * the parent terminal. The default uses `child_process.spawn`; tests
 * inject a stub launcher.
 *
 * See `agents/2026-05-20-skills-unification-plan.md` step 19.
 */

import {type ChildProcess, spawn} from 'node:child_process';
import {existsSync, mkdirSync, openSync, statSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	getLockfilePath,
	getSocketPath,
	readLiveLockfile,
	readLockfile,
	removeLockfile,
} from './lockfile';

function getLogPath(projectRoot: string): string {
	return join(projectRoot, '.nanocoder', 'daemon.log');
}

export interface DaemonCliResult {
	exitCode: 0 | 1;
	output: string;
}

export type DaemonCliCommand =
	| 'start'
	| 'stop'
	| 'status'
	| 'logs'
	| 'install'
	| 'uninstall';

export interface DaemonCliOptions {
	projectRoot: string;
	/**
	 * Launch the detached daemon process. Tests pass a stub that records the
	 * arguments without actually forking. Production uses
	 * `defaultLaunchDaemon`.
	 */
	launchDaemon?: (projectRoot: string) => ChildProcess | null;
}

/**
 * Default launcher: spawns a detached `node <daemonEntry>` with the
 * project root in its environment. Stdio is redirected to the daemon log
 * file.
 */
function defaultLaunchDaemon(
	projectRoot: string,
	daemonEntry: string,
): ChildProcess {
	const logPath = getLogPath(projectRoot);
	mkdirSync(dirname(logPath), {recursive: true});
	// Append mode so subsequent runs don't clobber the log.
	const logFd = openSync(logPath, 'a');
	const child = spawn(process.execPath, [daemonEntry], {
		cwd: projectRoot,
		env: {
			...process.env,
			NANOCODER_PROJECT_ROOT: projectRoot,
			NANOCODER_DAEMON_PROCESS: '1',
		},
		detached: true,
		stdio: ['ignore', logFd, logFd],
	});
	child.unref();
	return child;
}

export async function runDaemonCli(
	command: DaemonCliCommand,
	opts: DaemonCliOptions,
): Promise<DaemonCliResult> {
	switch (command) {
		case 'start':
			return start(opts);
		case 'stop':
			return stop(opts);
		case 'status':
			return status(opts);
		case 'logs':
			return logs(opts);
		case 'install':
			return installCommand(opts);
		case 'uninstall':
			return uninstallCommand(opts);
	}
}

async function installCommand(
	opts: DaemonCliOptions,
): Promise<DaemonCliResult> {
	const {installAutoStart} = await import('./install');
	const result = await installAutoStart({projectRoot: opts.projectRoot});
	return {
		exitCode: result.platform === 'unsupported' ? 1 : 0,
		output: result.message,
	};
}

async function uninstallCommand(
	opts: DaemonCliOptions,
): Promise<DaemonCliResult> {
	const {uninstallAutoStart} = await import('./install');
	const result = await uninstallAutoStart({projectRoot: opts.projectRoot});
	return {exitCode: 0, output: result.message};
}

async function start(opts: DaemonCliOptions): Promise<DaemonCliResult> {
	const live = await readLiveLockfile(opts.projectRoot);
	if (live) {
		return {
			exitCode: 0,
			output: `Daemon already running (pid ${live.pid}).`,
		};
	}

	const launcher = opts.launchDaemon ?? launchSelfHosted;
	const child = launcher(opts.projectRoot);
	if (!child) {
		return {
			exitCode: 1,
			output: 'Failed to spawn daemon process.',
		};
	}

	// Wait briefly for the daemon to write its lockfile, so `start` reports
	// success only if the boot actually happened.
	const lock = await waitForLockfile(opts.projectRoot, 5000);
	if (!lock) {
		return {
			exitCode: 1,
			output:
				'Daemon process spawned but did not write a lockfile within 5s. Check the daemon log.',
		};
	}

	return {
		exitCode: 0,
		output: `Daemon started (pid ${lock.pid}, socket ${lock.socketPath}).`,
	};
}

async function stop(opts: DaemonCliOptions): Promise<DaemonCliResult> {
	const live = await readLiveLockfile(opts.projectRoot);
	if (!live) {
		return {exitCode: 0, output: 'No daemon is running.'};
	}

	// Prefer IPC: works on Windows (where SIGTERM is force-kill) and gives
	// the daemon a chance to drain its event loop cleanly. Falls back to
	// SIGTERM if IPC can't be reached (older daemon, socket missing, etc).
	const ipcAccepted = await tryIpcShutdown(live.socketPath);

	if (!ipcAccepted) {
		try {
			process.kill(live.pid, 'SIGTERM');
		} catch (err) {
			return {
				exitCode: 1,
				output: `Failed to stop daemon (pid ${live.pid}): IPC unreachable and SIGTERM failed: ${
					err instanceof Error ? err.message : String(err)
				}`,
			};
		}
	}

	// Wait for the daemon to remove its lockfile, then we know it's gone.
	const removed = await waitForLockfileGone(opts.projectRoot, 5000);
	if (!removed) {
		await removeLockfile(opts.projectRoot);
		const how = ipcAccepted ? 'IPC shutdown' : 'SIGTERM';
		return {
			exitCode: 0,
			output: `Sent ${how} to daemon (pid ${live.pid}). Lockfile cleaned up manually.`,
		};
	}
	return {exitCode: 0, output: `Daemon stopped (was pid ${live.pid}).`};
}

/**
 * Best-effort attempt to ask the daemon to shut itself down over IPC.
 * Returns true if the daemon accepted the request. Any failure (no socket,
 * timeout, older daemon without the method) returns false so the caller
 * can fall back to SIGTERM.
 */
async function tryIpcShutdown(socketPath: string): Promise<boolean> {
	const {DaemonIpcClient} = await import('./ipc');
	const client = new DaemonIpcClient(socketPath);
	try {
		await Promise.race([
			client.connect(),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('IPC connect timeout')), 1000),
			),
		]);
	} catch {
		return false;
	}
	try {
		await Promise.race([
			client.shutdown(),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('IPC shutdown timeout')), 2000),
			),
		]);
		return true;
	} catch {
		return false;
	} finally {
		await client.disconnect().catch(() => {});
	}
}

async function status(opts: DaemonCliOptions): Promise<DaemonCliResult> {
	const lock = await readLockfile(opts.projectRoot);
	if (!lock) {
		return {exitCode: 0, output: 'Not running.'};
	}
	const live = await readLiveLockfile(opts.projectRoot);
	if (!live) {
		return {
			exitCode: 0,
			output: `Stale lockfile cleaned (was pid ${lock.pid}). Daemon is not running.`,
		};
	}
	const uptime = formatUptime(Date.now() - live.startedAt);
	return {
		exitCode: 0,
		output: `Running. pid ${live.pid}, socket ${live.socketPath}, uptime ${uptime}.`,
	};
}

async function logs(opts: DaemonCliOptions): Promise<DaemonCliResult> {
	const logPath = getLogPath(opts.projectRoot);
	if (!existsSync(logPath)) {
		return {exitCode: 0, output: 'No daemon log yet.'};
	}
	const size = statSync(logPath).size;
	const start = Math.max(0, size - 64 * 1024);
	const buf = await readFile(logPath, 'utf-8');
	return {exitCode: 0, output: buf.slice(start)};
}

function launchSelfHosted(projectRoot: string): ChildProcess {
	const daemonEntry = fileURLToPath(new URL('./entry.js', import.meta.url));
	return defaultLaunchDaemon(projectRoot, daemonEntry);
}

async function waitForLockfile(
	projectRoot: string,
	timeoutMs: number,
): Promise<{pid: number; socketPath: string} | null> {
	const deadline = Date.now() + timeoutMs;
	const path = getLockfilePath(projectRoot);
	while (Date.now() < deadline) {
		if (existsSync(path)) {
			const live = await readLiveLockfile(projectRoot);
			if (live) return {pid: live.pid, socketPath: getSocketPath(projectRoot)};
		}
		await new Promise(r => setTimeout(r, 50));
	}
	return null;
}

async function waitForLockfileGone(
	projectRoot: string,
	timeoutMs: number,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	const path = getLockfilePath(projectRoot);
	while (Date.now() < deadline) {
		if (!existsSync(path)) return true;
		await new Promise(r => setTimeout(r, 50));
	}
	return false;
}

function formatUptime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}
