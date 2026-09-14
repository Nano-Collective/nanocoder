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
import {createInterface} from 'node:readline/promises';
import {fileURLToPath} from 'node:url';
import {getAppConfig} from '@/config/index';
import {formatError} from '@/utils/error-formatter';
import {isTrustLevel, resolveTrustLevel, type TrustLevel} from '@/verify/trust';
import {
	isFullCommitTrustConfirmed,
	recordFullCommitTrustConfirmed,
} from './full-commit-trust';
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

const START_USAGE =
	'Usage: nanocoder daemon start [--trust <comment-only|auto-fix|full-commit>]';

interface ParsedStartArgs {
	trustLevel?: TrustLevel;
}

/**
 * Parse `daemon start`'s flags. Mirrors `verify/cli.ts`'s `parseArgs`:
 * hand-rolled loop, unknown-flag rejection, discriminated-union return.
 */
function parseStartArgs(args: string[]): ParsedStartArgs | {error: string} {
	let trustLevel: TrustLevel | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--trust') {
			const value = args[i + 1];
			i++;
			if (!isTrustLevel(value)) {
				return {
					error: `Invalid --trust value: "${value ?? ''}". Must be one of comment-only, auto-fix, full-commit.`,
				};
			}
			trustLevel = value;
		} else {
			return {error: `Unknown flag: "${arg}".`};
		}
	}

	return {trustLevel};
}

const FULL_COMMIT_WARNING = (projectRoot: string) => `
⚠️  Security Warning — full-commit trust

You're starting the daemon with --trust full-commit for:
  ${projectRoot}

At this trust level, when CI watch detects a failure, the daemon will
autonomously edit files, commit, and PUSH DIRECTLY to the failing branch —
with no human review step and no draft PR. This is equivalent to yolo mode
for an unattended background process watching your repository.

Only enable this on a project/branch where you're comfortable with an
automated agent pushing commits without your review.

This warning will not be shown again for this project.
`;

/**
 * Default confirmation prompt for `--trust full-commit`. `daemon start`
 * runs in the plain CLI fast-path (no Ink tree is ever mounted for it —
 * `cli.tsx`'s daemon block exits via `process.exit()` before importing
 * `@/app`), so a plain readline prompt is the correct mechanism here, not
 * a stopgap.
 */
async function defaultConfirmFullCommitTrust(
	projectRoot: string,
): Promise<boolean> {
	process.stdout.write(FULL_COMMIT_WARNING(projectRoot));
	const rl = createInterface({input: process.stdin, output: process.stdout});
	try {
		const answer = await rl.question('Proceed? [y/N] ');
		return (
			answer.trim().toLowerCase() === 'y' ||
			answer.trim().toLowerCase() === 'yes'
		);
	} finally {
		rl.close();
	}
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
	launchDaemon?: (
		projectRoot: string,
		trustLevel: TrustLevel,
	) => ChildProcess | null;
	/** Raw argv after the subcommand — only `start` consumes this. */
	args?: string[];
	/** Test seam: override the one-time full-commit confirmation prompt. */
	confirmFullCommitTrust?: (projectRoot: string) => Promise<boolean>;
	/** Test seam: override the persisted confirmation check. */
	isFullCommitTrustConfirmedFn?: typeof isFullCommitTrustConfirmed;
	/** Test seam: override persisting the confirmation. */
	recordFullCommitTrustConfirmedFn?: typeof recordFullCommitTrustConfirmed;
	/** Test seam: override reading the project-level trust-level config,
	 * avoiding `getAppConfig()`'s real cwd-based filesystem reads in tests. */
	loadVerifyConfigFn?: () => {trustLevel?: TrustLevel} | undefined;
}

/**
 * Default launcher: spawns a detached `node <daemonEntry>` with the
 * project root in its environment. Stdio is redirected to the daemon log
 * file.
 */
function defaultLaunchDaemon(
	projectRoot: string,
	daemonEntry: string,
	trustLevel: TrustLevel,
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
			NANOCODER_CI_TRUST_LEVEL: trustLevel,
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

	const parsed = parseStartArgs(opts.args ?? []);
	if ('error' in parsed) {
		return {exitCode: 1, output: `${parsed.error}\n${START_USAGE}`};
	}

	const loadVerifyConfig =
		opts.loadVerifyConfigFn ?? (() => getAppConfig().verify);
	const trustLevel = resolveTrustLevel(
		parsed.trustLevel,
		loadVerifyConfig()?.trustLevel,
	);

	if (trustLevel === 'full-commit') {
		const isConfirmed =
			opts.isFullCommitTrustConfirmedFn ?? isFullCommitTrustConfirmed;
		if (!isConfirmed(opts.projectRoot)) {
			const confirm =
				opts.confirmFullCommitTrust ?? defaultConfirmFullCommitTrust;
			const confirmed = await confirm(opts.projectRoot);
			if (!confirmed) {
				return {
					exitCode: 1,
					output: 'Aborted: full-commit trust was not confirmed.',
				};
			}
			(opts.recordFullCommitTrustConfirmedFn ?? recordFullCommitTrustConfirmed)(
				opts.projectRoot,
			);
		}
	}

	const launcher = opts.launchDaemon ?? launchSelfHosted;
	const child = launcher(opts.projectRoot, trustLevel);
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
				output: `Failed to stop daemon (pid ${live.pid}): IPC unreachable and SIGTERM failed: ${formatError(
					err,
				)}`,
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

function launchSelfHosted(
	projectRoot: string,
	trustLevel: TrustLevel,
): ChildProcess {
	const daemonEntry = fileURLToPath(new URL('./entry.js', import.meta.url));
	return defaultLaunchDaemon(projectRoot, daemonEntry, trustLevel);
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
