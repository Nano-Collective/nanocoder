import {type ChildProcess, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	unlinkSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {platform} from 'node:process';

import {getAppConfig} from '@/config/index';
import {
	BASH_OUTPUT_PREVIEW_LENGTH,
	INTERVAL_BASH_PROGRESS_MS,
	TIMEOUT_BASH_DEFAULT_MS,
} from '@/constants';
import {signalProcessTree} from '@/utils/process-tree';
import {getShutdownManager} from '@/utils/shutdown';
import {
	makeStreamCollector,
	STDERR_TRUNCATION_NOTICE,
	STDOUT_TRUNCATION_NOTICE,
} from '@/utils/stream-collector';
import {
	planBashSpawn,
	resolveJailRoot,
	sandboxedCommandGroup,
	spawnPlanned,
} from './bash-sandbox.js';
import {
	getProjectRoot,
	getSafeSessionCwd,
	setSessionCwd,
} from './session-cwd.js';

const isWindows = platform === 'win32';

/**
 * On Unix, probe the process group rather than the leader. Every command runs
 * under a wrapping `sh`, which can exit (on SIGTERM, or on its own after
 * backgrounding a job) while descendants live on in the group. The PGID
 * cannot be recycled while any member is alive, so a successful probe means
 * a signal reaches our own processes. With the Linux jail on, the command
 * runs in a second group that bwrap started, which counts too.
 */
function isGroupAlive(proc: ChildProcess): boolean {
	if (proc.pid === undefined) return false;
	if (isWindows) {
		return proc.exitCode === null && proc.signalCode === null;
	}
	const command = sandboxedCommandGroup(proc);
	return probeGroup(proc.pid) || (command !== undefined && probeGroup(command));
}

function probeGroup(pgid: number): boolean {
	try {
		process.kill(-pgid, 0);
		return true;
	} catch {
		return false;
	}
}

function signalGroups(proc: ChildProcess, signal: NodeJS.Signals): void {
	const command = sandboxedCommandGroup(proc);
	if (command !== undefined) {
		try {
			process.kill(-command, signal);
		} catch {
			// Already gone.
		}
	}
	signalProcessTree(proc, signal);
}

export interface BashExecutionState {
	executionId: string;
	command: string;
	outputPreview: string; // Last 150 chars for display
	fullOutput: string; // Complete output
	stderr: string; // Complete stderr
	isComplete: boolean;
	exitCode: number | null;
	error: string | null;
}

interface ExecutionEntry {
	state: BashExecutionState;
	process: ChildProcess;
	intervalId: NodeJS.Timeout;
	resolve: (state: BashExecutionState) => void;
	timeoutId?: NodeJS.Timeout;
	signal?: AbortSignal;
	abortListener?: () => void;
	cwdCaptureFile?: string;
	jailTmp?: string;
	cleanupJailTmp?: () => void;
}

export class BashExecutor extends EventEmitter {
	private executions = new Map<string, ExecutionEntry>();
	// Process groups that outlive their execution entry: a cancelled command
	// still being stopped, and jobs a finished command left behind (`cmd &`).
	// stopAll() and killAll() reach these too.
	private stopping = new Map<ChildProcess, Promise<void>>();
	private leftovers = new Set<ChildProcess>();
	private leftoverPrune?: NodeJS.Timeout;

	execute(
		command: string,
		options?: {timeoutMs?: number; signal?: AbortSignal},
	): {
		executionId: string;
		promise: Promise<BashExecutionState>;
	} {
		const executionId = randomUUID();

		const state: BashExecutionState = {
			executionId,
			command,
			outputPreview: '',
			fullOutput: '',
			stderr: '',
			isComplete: false,
			exitCode: null,
			error: null,
		};

		// Share the session cwd so bash and the file tools agree on relative paths.
		const cwd = getSafeSessionCwd();
		const sandbox = getAppConfig().sandbox === true;
		const projectRoot = sandbox
			? resolveJailRoot(getProjectRoot())
			: getProjectRoot();

		// Per-execution temp dir the jail can write to (compilers, mktemp, npm).
		// Cwd capture lives here too so it is not interpolated into `sh -c` and
		// does not land in the user's repo.
		let jailTmp: string | undefined;
		if (sandbox && !isWindows) {
			jailTmp = resolveJailRoot(mkdtempSync(join(tmpdir(), 'nc-sbx-')));
		}
		const cwdCaptureFile = isWindows
			? undefined
			: join(jailTmp ?? tmpdir(), `nanocoder-cwd-${executionId}`);
		const spawnCommand =
			cwdCaptureFile === undefined
				? command
				: // Blank line before the epilogue: a command ending in a trailing
					// backslash would otherwise line-continue into `__nc_ec=$?`.
					// Capture path is $NC_CWD_FILE so positional args stay empty.
					`${command}\n\n__nc_ec=$?\ncommand pwd -P > "$NC_CWD_FILE" 2>/dev/null\nexit $__nc_ec`;
		const childEnv = {
			...process.env,
			...(cwdCaptureFile ? {NC_CWD_FILE: cwdCaptureFile} : {}),
			...(jailTmp ? {TMPDIR: jailTmp, TMP: jailTmp, TEMP: jailTmp} : {}),
		};

		let jailTmpCleaned = false;
		const cleanupJailTmp = () => {
			if (!jailTmp || jailTmpCleaned) return;
			jailTmpCleaned = true;
			try {
				if (existsSync(jailTmp)) {
					rmSync(jailTmp, {recursive: true, force: true});
				}
			} catch {
				// best-effort cleanup
			}
		};

		let proc: ChildProcess;
		if (sandbox) {
			const planned = planBashSpawn({
				platform,
				sandbox: true,
				command,
				spawnCommand,
				cwd,
				projectRoot,
				tmpDir: jailTmp,
				hostTmp: resolveJailRoot(tmpdir()),
			});
			if ('error' in planned) {
				cleanupJailTmp();
				state.isComplete = true;
				state.error = planned.error;
				this.emit('start', {...state});
				this.emit('complete', {...state});
				return {executionId, promise: Promise.resolve({...state})};
			}
			proc = spawnPlanned(planned, {cwd, env: childEnv});
		} else if (cwdCaptureFile === undefined) {
			proc = spawn('cmd', ['/c', command], {cwd});
		} else {
			// codeql[js/shell-command-built-from-environment] -c script uses $NC_CWD_FILE; path is env, not argv
			// codeql[js/shell-command-constructed-from-input]
			proc = spawn('sh', ['-c', spawnCommand], {
				cwd,
				detached: true,
				env: childEnv,
			});
		}

		// Best-effort: a missed capture just leaves the cwd where it was.
		const applyCapturedCwd = () => {
			if (!cwdCaptureFile) return;
			try {
				if (existsSync(cwdCaptureFile)) {
					const captured = readFileSync(cwdCaptureFile, 'utf8').trim();
					// Concurrent bash runs race here; last close wins, which is fine
					// since the session cwd is a single shared value either way.
					if (captured) setSessionCwd(captured);
				}
			} catch {
				// Non-fatal: leave the session cwd where it was.
			} finally {
				try {
					if (existsSync(cwdCaptureFile)) unlinkSync(cwdCaptureFile);
				} catch {
					// best-effort cleanup
				}
			}
		};

		const stdoutCollector = makeStreamCollector(text => {
			state.fullOutput += text;
		}, STDOUT_TRUNCATION_NOTICE);
		const stderrCollector = makeStreamCollector(text => {
			state.stderr += text;
		}, STDERR_TRUNCATION_NOTICE);

		// Both streams are finished by the time `close`/`error` runs, so release
		// whatever the decoders were holding back mid-character. `cancel()`
		// resolves and unregisters the execution before either handler gets
		// here, so a cancelled run never flushes: its pending partial character
		// is dropped along with the rest of the output it never produced.
		const flushStreams = () => {
			stdoutCollector.flush();
			stderrCollector.flush();
			state.outputPreview = state.fullOutput.slice(-BASH_OUTPUT_PREVIEW_LENGTH);
		};

		// Collect output
		proc.stdout?.on('data', (data: Buffer) => {
			stdoutCollector.collect(data);
			state.outputPreview = state.fullOutput.slice(-BASH_OUTPUT_PREVIEW_LENGTH);
			// Emit progress immediately when output is received
			// This ensures fast commands still show streaming output
			this.emit('progress', {...state});
		});

		proc.stderr?.on('data', (data: Buffer) => {
			stderrCollector.collect(data);
			// Emit progress immediately when stderr is received
			this.emit('progress', {...state});
		});

		// Progress interval - emit updates every 500ms
		// Using unref() so this interval doesn't prevent Node.js from exiting
		// (important for tests and clean shutdown)
		const intervalId = setInterval(() => {
			this.emit('progress', {...state});
		}, INTERVAL_BASH_PROGRESS_MS);
		intervalId.unref();

		const promise = new Promise<BashExecutionState>((resolve, _reject) => {
			const entry: ExecutionEntry = {
				state,
				process: proc,
				intervalId,
				resolve,
				signal: options?.signal,
				cwdCaptureFile,
				jailTmp,
				cleanupJailTmp,
			};

			const ms = options?.timeoutMs ?? TIMEOUT_BASH_DEFAULT_MS;
			if (ms > 0) {
				entry.timeoutId = setTimeout(() => {
					this.cancel(executionId, `Command timed out after ${ms}ms`);
				}, ms);
				entry.timeoutId.unref();
			}

			if (options?.signal) {
				entry.abortListener = () => {
					this.cancel(executionId, 'Cancelled via AbortSignal');
				};

				options.signal.addEventListener('abort', entry.abortListener, {
					once: true,
				});
				if (options.signal.aborted) {
					process.nextTick(entry.abortListener);
				}
			}

			this.executions.set(executionId, entry);

			proc.on('close', (code: number | null) => {
				if (entry.timeoutId) clearTimeout(entry.timeoutId);
				if (entry.signal && entry.abortListener) {
					entry.signal.removeEventListener('abort', entry.abortListener);
				}

				// Only process if not already handled by cancel()
				if (!this.executions.has(executionId)) return;

				flushStreams();

				// Persist `cd` only on a real completion, not a cancel/timeout.
				applyCapturedCwd();
				cleanupJailTmp();
				clearInterval(intervalId);
				this.trackLeftovers(proc);
				state.isComplete = true;
				state.exitCode = code;
				this.emit('complete', {...state});
				this.executions.delete(executionId);
				resolve({...state});
			});

			proc.on('error', (error: Error) => {
				if (entry.timeoutId) clearTimeout(entry.timeoutId);
				if (entry.signal && entry.abortListener) {
					entry.signal.removeEventListener('abort', entry.abortListener);
				}

				// Only process if not already handled by cancel()
				if (!this.executions.has(executionId)) return;

				flushStreams();

				applyCapturedCwd();
				cleanupJailTmp();
				clearInterval(intervalId);
				state.isComplete = true;
				state.error = error.message;
				this.emit('complete', {...state});
				this.executions.delete(executionId);
				resolve({...state}); // Resolve with error state instead of rejecting
			});
		});

		// Emit initial state
		this.emit('start', {...state});

		return {executionId, promise};
	}

	cancel(executionId: string, reason = 'Cancelled by user'): boolean {
		const execution = this.executions.get(executionId);
		if (!execution) return false;

		clearInterval(execution.intervalId);
		if (execution.timeoutId) clearTimeout(execution.timeoutId);
		if (execution.signal && execution.abortListener) {
			execution.signal.removeEventListener('abort', execution.abortListener);
		}

		// Destroy stdio streams to prevent them from keeping the event loop alive
		execution.process.stdout?.destroy();
		execution.process.stderr?.destroy();
		execution.process.stdin?.destroy();

		// No longer active, so a second cancel is a no-op. The result waits
		// until the process group is gone, though: a command that ignores
		// SIGTERM keeps running until the SIGKILL fallback, and reporting it
		// as stopped before then lets nanocoder move on, or exit, around it.
		this.executions.delete(executionId);
		void this.stop(execution.process).then(() => {
			// Drop the cwd temp file; a killed command must not move the session cwd.
			if (execution.cwdCaptureFile) {
				try {
					if (existsSync(execution.cwdCaptureFile)) {
						unlinkSync(execution.cwdCaptureFile);
					}
				} catch {
					// best-effort cleanup
				}
			}
			execution.cleanupJailTmp?.();
			execution.state.isComplete = true;
			execution.state.error = reason;
			this.emit('complete', {...execution.state});

			// Resolve the promise with the cancelled state
			execution.resolve({...execution.state});
		});
		return true;
	}

	/**
	 * Stop everything this executor started that may still be running:
	 * active commands, cancelled ones still being stopped, and jobs a finished
	 * command left in its process group. Resolves once they are all gone.
	 */
	async stopAll(): Promise<void> {
		for (const id of this.getActiveExecutionIds()) {
			this.cancel(id);
		}
		for (const proc of this.leftovers) {
			void this.stop(proc);
		}
		this.leftovers.clear();
		await Promise.all(this.stopping.values());
	}

	/**
	 * SIGKILL everything stopAll() would stop, synchronously. For process
	 * exit, where nothing can be awaited: a forced quit, or a shutdown that
	 * ran out of time before stopAll() finished.
	 */
	killAll(): void {
		const procs = [
			...Array.from(this.executions.values(), entry => entry.process),
			...this.stopping.keys(),
			...this.leftovers,
		];
		for (const proc of procs) {
			if (isGroupAlive(proc)) signalGroups(proc, 'SIGKILL');
		}
	}

	private stop(proc: ChildProcess): Promise<void> {
		const pending = this.stopping.get(proc);
		if (pending) return pending;
		const done = this.killProcessTree(proc).then(() => {
			this.stopping.delete(proc);
		});
		this.stopping.set(proc, done);
		return done;
	}

	/**
	 * Remember a finished command's process group if something in it is still
	 * running, such as a job it started with `cmd &`, so shutdown can stop it.
	 * Dead groups are pruned every second: once its last member exits, the
	 * group id can be reused by an unrelated process.
	 */
	private trackLeftovers(proc: ChildProcess): void {
		if (!isGroupAlive(proc)) return;
		this.leftovers.add(proc);
		if (this.leftoverPrune) return;
		this.leftoverPrune = setInterval(() => {
			for (const leftover of this.leftovers) {
				if (!isGroupAlive(leftover)) this.leftovers.delete(leftover);
			}
			if (this.leftovers.size === 0) {
				clearInterval(this.leftoverPrune);
				this.leftoverPrune = undefined;
			}
		}, 1000);
		this.leftoverPrune.unref();
	}

	/**
	 * Terminate a spawned command and its descendants.
	 *
	 * On Unix the child is spawned `detached`, so it leads its own process
	 * group; signalling the negative PID reaches the whole group (the command
	 * plus anything it spawned). With the Linux jail on, the group bwrap
	 * started the command in is signalled too. On Windows the child is
	 * `cmd.exe`, so `taskkill /T` stops the program it started too.
	 *
	 * Sends SIGTERM first. If the process has not exited after a grace period
	 * (2 seconds), sends SIGKILL to guarantee termination even if SIGTERM is
	 * trapped or ignored. Resolves once the group is gone.
	 *
	 * The timers are not unref()ed: callers wait on this before reporting the
	 * command as stopped, so Node must not exit, or drop the SIGKILL, first.
	 */
	private killProcessTree(proc: ChildProcess): Promise<void> {
		if (!isGroupAlive(proc)) return Promise.resolve();

		// Initial SIGTERM
		signalGroups(proc, 'SIGTERM');

		return new Promise(resolve => {
			// Poll liveness every 50ms so cleanup triggers as soon as all
			// processes in the process group have exited.
			const pollInterval = setInterval(() => {
				if (!isGroupAlive(proc)) finish();
			}, 50);

			// SIGKILL fallback after 2 seconds for anything that trapped or
			// ignored SIGTERM. Gate on liveness only, not proc.killed: Node sets
			// proc.killed on any successful proc.kill() call, including the
			// SIGTERM above.
			const sigkillTimer = setTimeout(() => {
				if (isGroupAlive(proc)) {
					signalGroups(proc, 'SIGKILL');
				} else {
					finish();
				}
			}, 2000);

			// Safety backstop: ensure cleanup runs even if a stubborn process
			// or zombie remains alive/unreaped after SIGKILL.
			const safetyTimer = setTimeout(finish, 10000);

			function finish() {
				clearInterval(pollInterval);
				clearTimeout(sigkillTimer);
				clearTimeout(safetyTimer);
				resolve();
			}
		});
	}

	/**
	 * Get the temporary jail directory path for an active execution, if sandboxed.
	 */
	getJailTmp(executionId: string): string | undefined {
		return this.executions.get(executionId)?.jailTmp;
	}

	getState(executionId: string): BashExecutionState | undefined {
		const execution = this.executions.get(executionId);
		return execution ? {...execution.state} : undefined;
	}

	hasActiveExecutions(): boolean {
		return this.executions.size > 0;
	}

	getActiveExecutionIds(): string[] {
		return Array.from(this.executions.keys());
	}
}

// Singleton instance for app-wide use
export const bashExecutor = new BashExecutor();

// Each command leads its own process group (or, on Windows, its own tree), so
// it outlives nanocoder unless stopped on the way out. Priority 12: after the
// plain-run and daemon handlers (10) abort their runs, which stops those
// commands through their AbortSignals.
getShutdownManager().register({
	name: 'bash-executor',
	priority: 12,
	handler: () => bashExecutor.stopAll(),
});
process.on('exit', () => {
	bashExecutor.killAll();
});
