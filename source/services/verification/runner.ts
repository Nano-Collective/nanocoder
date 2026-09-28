/**
 * Running the configured verification command to completion, safely.
 *
 * Contract, in order of importance:
 *
 *  1. **Never rejects.** A missing binary, a non-zero exit, a timeout, and an
 *     abort are all ordinary outcomes the caller has to reason about, not
 *     exceptions. This mirrors `lifecycle-hooks.ts` - a broken verification
 *     script must never be able to wedge the conversation loop.
 *  2. **Never leaves a process behind.** A test command spawns children
 *     (`npm test` -> node -> jest workers). Killing only the direct child
 *     leaves those running, holding the repo's `dist/`, `.cache/`, and
 *     coverage files - so the next run reads half-written state. Every exit
 *     path that ends the run early goes through {@link killProcessTree}.
 *  3. **Never returns unbounded text.** Output is byte-capped while streaming,
 *     not after, so a runaway suite cannot exhaust memory before the cap
 *     applies.
 */

import {type ChildProcess, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {extname, join} from 'node:path';
import {findShellMetacharacter, type ParsedCommand} from './command-parser.js';
import {prepareOutputForModel, stripAnsi} from './output.js';

export type VerificationStatus =
	| 'passed'
	| 'failed'
	| 'timeout'
	| 'aborted'
	| 'unavailable';

export interface VerificationRunResult {
	status: VerificationStatus;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	durationMs: number;
	/**
	 * stdout and stderr merged, ANSI-stripped and byte-capped. Merged because
	 * runners split across both (Jest writes results to stderr) and the model
	 * has no use for the distinction.
	 */
	output: string;
	truncated: boolean;
	/** Present only when `status` is `unavailable`. */
	spawnError?: string;
}

export interface RunCommandOptions {
	command: ParsedCommand;
	cwd: string;
	timeoutMs: number;
	maxOutputBytes: number;
	/** Aborting kills the process tree and resolves with `aborted`. */
	signal?: AbortSignal;
	/** Parameterised so the Windows branch is testable from any OS. */
	platform?: string;
}

export interface SpawnPlan {
	/** Exactly what to hand to `spawn` as argv[0]. */
	file: string;
	/** Exactly what to hand to `spawn` as argv[1..]. */
	args: string[];
	shell: boolean;
	detached: boolean;
	/**
	 * `true` when argv is already a finished Windows command line and Node must
	 * not apply its own quoting on top of it.
	 */
	verbatim?: boolean;
	/** Set when the command must not be run at all. */
	error?: string;
}

/**
 * Extensions Windows can execute without a command interpreter. For these the
 * metacharacter screen and the quoting are both unnecessary, because nothing
 * interprets the command line.
 */
const NATIVE_WINDOWS_EXECUTABLES = new Set(['.exe', '.com']);

/** Windows' own default, used when PATHEXT is unset. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

export interface ExecutableLookup {
	/** Absolute path to the executable, or `null` if it is not on PATH. */
	path: string | null;
	/** True when a command interpreter is required to run it. */
	needsShell: boolean;
}

/**
 * Resolve a Windows command to a real file, the way `cmd.exe` would, but
 * before spending a process on the answer.
 *
 * The reason this exists: with `shell: true` on Windows a missing binary is
 * *not* an `error` event. `cmd.exe` is found, reports "not recognized as an
 * internal or external command" in a message that differs by locale, and exits
 * non-zero. That failure is indistinguishable from a genuinely failing test
 * suite by exit code alone — so a typo'd verification command would be retried
 * to exhaustion, each attempt billing the model for the same useless error.
 * Resolving up front turns that into an immediate, unretriable `unavailable`.
 *
 * It also lets the common case skip the shell entirely: anything resolving to
 * `.exe`/`.com` is spawned directly, so its argv never reaches `cmd.exe` and
 * needs neither screening nor quoting.
 */
export function resolveWindowsExecutable(
	file: string,
	env: NodeJS.ProcessEnv = process.env,
	fileExists: (candidate: string) => boolean = existsSync,
): ExecutableLookup {
	// Explicitly pathed commands bypass PATH search but still have to exist.
	if (/[\\/]/.test(file)) {
		if (!fileExists(file)) return {path: null, needsShell: false};
		return {
			path: file,
			needsShell: !NATIVE_WINDOWS_EXECUTABLES.has(extname(file).toLowerCase()),
		};
	}

	const pathEnv = env.PATH ?? env.Path ?? '';
	const extensions = (env.PATHEXT ?? DEFAULT_PATHEXT)
		.split(';')
		.map(ext => ext.trim())
		.filter(Boolean);

	for (const dir of pathEnv.split(';').filter(Boolean)) {
		for (const ext of extensions) {
			// A name that already carries an extension is only tried as-is, so
			// `npm.cmd` does not also get probed as `npm.cmd.cmd`.
			const candidate = extname(file)
				? join(dir, file)
				: `${join(dir, file)}${ext}`;
			if (!fileExists(candidate)) continue;
			return {
				path: candidate,
				needsShell: !NATIVE_WINDOWS_EXECUTABLES.has(ext.toLowerCase()),
			};
		}
	}

	return {path: null, needsShell: false};
}

/**
 * Decide how to launch, as a pure function of platform.
 *
 * Windows needs a command interpreter for `.cmd`/`.bat` shims: `npm`, `pnpm`,
 * and friends cannot be executed without one. That makes `cmd.exe` the
 * interpreter, which forces two decisions.
 *
 * **Screening.** The metacharacter check is re-applied here rather than trusted
 * from the parser, because the array form is deliberately unscreened during
 * parsing and this is the last point before the bytes reach a shell.
 *
 * **Quoting.** The `cmd.exe` command line is built here, in full, and handed to
 * `spawn` with `windowsVerbatimArguments`, rather than being left to
 * `shell: true`. Two things go wrong if Node is left to assemble it:
 *
 * 1. `/s` makes `cmd.exe` strip the *first and last* quote of the string after
 *    `/c` and take the rest verbatim. Node's own per-argument quoting sits
 *    inside that range, so a program path containing a space
 *    (`C:\Program Files\nodejs\...`) is left unbalanced and the command never
 *    runs.
 * 2. When the quotes *are* balanced, `cmd.exe` hands the inner pair to the shim
 *    as real characters. A `.cmd` written the ordinary way
 *    (`if "%1"=="--watch"`) then compares against `"--watch"` with quotes and
 *    takes the wrong branch — silently running something other than what was
 *    configured.
 *
 * So the line is assembled explicitly: quote only the elements that need it,
 * then wrap the whole thing in the one extra pair of quotes that `/s` needs to
 * strip. Sound only because the screen above also rejects the double quote, so
 * no element can close the wrapper and append its own command. One screen, one
 * quoting rule, no way to route around either.
 *
 * This shape is only used once {@link resolveWindowsExecutable} has established
 * that a command interpreter is genuinely required; native executables are
 * spawned with `shell: false` and need neither defence.
 *
 * Not exported: the Windows branch is reachable through `platform: 'win32'` on
 * {@link runVerificationCommand}, so it is testable without widening the API.
 */
function resolveSpawnPlan(
	command: ParsedCommand,
	platform: string,
	lookup?: {path: string; needsShell: boolean},
): SpawnPlan {
	if (platform !== 'win32') {
		// No shell, and the child leads its own process group so a negative
		// pid signals the whole tree on timeout.
		return {
			file: command.command,
			args: command.args,
			shell: false,
			detached: true,
		};
	}

	const metacharacter = findShellMetacharacter([
		command.command,
		...command.args,
	]);
	if (metacharacter) {
		return {
			file: command.command,
			args: command.args,
			shell: false,
			detached: false,
			error:
				`Verification command contains "${metacharacter}", which ` +
				`cmd.exe would interpret. Nanocoder refuses to run it on Windows.`,
		};
	}

	// Run the *resolved* path, not the bare name. `cmd.exe` searches the current
	// directory before PATH, so a same-named `.cmd` sitting in the repository
	// would otherwise shadow the tool that was just validated — meaning the
	// `unavailable` verdict and the screen above were both decided about a
	// different file than the one that actually runs.
	const file = lookup?.path ?? command.command;
	const line = [file, ...command.args].map(quoteForCmdLine).join(' ');

	return {
		file: process.env.ComSpec || 'cmd.exe',
		args: ['/d', '/s', '/c', `"${line}"`],
		shell: false,
		detached: false,
		verbatim: true,
	};
}

/**
 * Quote one element for a `cmd.exe` command line — and only if it needs it.
 *
 * Quoting an element that does not need it is not a no-op: the shim receives
 * the quote characters as part of the argument. An empty element still needs a
 * pair, or it disappears entirely.
 *
 * The screen in {@link resolveSpawnPlan} has already rejected `"` and every
 * `cmd.exe` metacharacter, so no element here can close its own wrapper.
 */
function quoteForCmdLine(element: string): string {
	return element === '' || /[\s"]/.test(element) ? `"${element}"` : element;
}

/**
 * Kill a child and everything it started.
 *
 * On POSIX the child was spawned `detached`, so it leads its own process group
 * and a negative pid reaches the whole tree. Windows has no equivalent, so
 * `taskkill /T` walks it. Same shape as `killHookTree` in
 * `lifecycle-hooks.ts`; duplicated rather than extracted because that module
 * is hook-specific and hoisting a shared helper would widen this diff.
 *
 * This reads the *host* platform rather than any injected one, and that is
 * deliberate: `process.kill(-pid, ...)` and `taskkill` are operations against
 * the real OS, so pretending to be Linux on Windows would not simulate
 * anything. The injectable `platform` on {@link RunCommandOptions} shapes the
 * spawn decision, which is a pure function worth testing; the kill is not.
 */
function killProcessTree(proc: ChildProcess): void {
	const pid = proc.pid;
	if (pid === undefined) return;

	try {
		if (process.platform === 'win32') {
			// Fixed argv, no shell; the only interpolated value is a pid we
			// minted. Detached and unref'd so a slow taskkill cannot itself
			// hold the session open.
			// nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
			const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
				stdio: 'ignore',
				detached: true,
			});
			killer.on('error', () => {
				proc.kill('SIGKILL');
			});
			killer.unref();
			return;
		}
		process.kill(-pid, 'SIGTERM');
	} catch {
		// Already reaped, or we lost the race with a normal exit.
		try {
			proc.kill('SIGKILL');
		} catch {
			// Nothing left to kill.
		}
	}
}

/**
 * Byte-capped stream accumulator.
 *
 * Tracks the true total even after it stops appending, so the caller can
 * report how much was dropped rather than only that "some" was.
 */
function createCappedCollector(maxBytes: number) {
	const chunks: Buffer[] = [];
	let kept = 0;
	let total = 0;

	return {
		push(chunk: Buffer) {
			total += chunk.byteLength;
			if (kept >= maxBytes) return;
			const room = maxBytes - kept;
			if (chunk.byteLength <= room) {
				chunks.push(chunk);
				kept += chunk.byteLength;
				return;
			}
			chunks.push(chunk.subarray(0, room));
			kept = maxBytes;
		},
		text(): string {
			return Buffer.concat(chunks).toString('utf-8');
		},
		get truncated() {
			return total > kept;
		},
	};
}

function immediate(
	status: VerificationStatus,
	startedAt: number,
	spawnError?: string,
): VerificationRunResult {
	return {
		status,
		exitCode: null,
		signal: null,
		durationMs: Date.now() - startedAt,
		output: '',
		truncated: false,
		...(spawnError ? {spawnError} : {}),
	};
}

/**
 * How long to wait for a killed process to actually exit before reporting
 * anyway.
 *
 * Without this, a timeout resolves the instant the kill is *sent*, which makes
 * the contract a lie in the direction that matters: the caller concludes the
 * tree is gone and starts the next run, which then races the previous run's
 * workers over the same build output. A short bounded wait turns "kill
 * requested" into "reaped", and costs at most this much on a process that
 * ignores SIGTERM outright.
 */
const REAP_GRACE_MS = 1_000;

/** Run the command once. Resolves on every path; see the module contract. */
export function runVerificationCommand(
	options: RunCommandOptions,
): Promise<VerificationRunResult> {
	const {
		command,
		cwd,
		timeoutMs,
		maxOutputBytes,
		signal,
		platform = process.platform,
	} = options;

	const startedAt = Date.now();

	if (signal?.aborted) {
		return Promise.resolve(immediate('aborted', startedAt));
	}

	let plan: SpawnPlan;
	if (platform === 'win32') {
		// Establish that the command is real, and whether an interpreter is
		// required, before spending a process on it. Native executables skip
		// the shell entirely, so their argv is never interpreted at all. The
		// resolved path is threaded into the plan so the file that was
		// validated is also the file that runs.
		const lookup = resolveWindowsExecutable(command.command);
		const resolved = lookup.path;
		if (resolved === null) {
			return Promise.resolve(
				immediate(
					'unavailable',
					startedAt,
					`Verification command "${command.command}" was not found on PATH.`,
				),
			);
		}
		plan = resolveSpawnPlan(command, platform, {
			path: resolved,
			needsShell: lookup.needsShell,
		});
		if (!lookup.needsShell) {
			plan = {
				file: resolved,
				args: command.args,
				shell: false,
				detached: true,
			};
		}
	} else {
		plan = resolveSpawnPlan(command, platform);
	}

	if (plan.error) {
		return Promise.resolve(immediate('unavailable', startedAt, plan.error));
	}

	return new Promise<VerificationRunResult>(resolve => {
		const stdout = createCappedCollector(maxOutputBytes);
		const stderr = createCappedCollector(maxOutputBytes);

		let settled = false;
		// Set the moment a kill is requested, so the 'close' event that
		// follows reports *why* the process ended rather than re-deriving
		// `failed` from the non-zero exit code the kill itself produced.
		let pendingKill: 'timeout' | 'aborted' | null = null;
		let timer: NodeJS.Timeout | undefined;
		let graceTimer: NodeJS.Timeout | undefined;
		let onAbort: (() => void) | undefined;

		const buildOutput = () => {
			const merged = `${stdout.text()}\n${stderr.text()}`
				.replace(/\n{3,}/g, '\n\n')
				.trim();
			return prepareOutputForModel(stripAnsi(merged), maxOutputBytes);
		};

		const finish = (
			status: VerificationStatus,
			exitCode: number | null,
			exitSignal: NodeJS.Signals | null,
			spawnError?: string,
		) => {
			// 'close' can arrive after a timeout or abort has already settled
			// the run, and must not overwrite the verdict with a failed exit.
			if (settled) return;
			settled = true;

			if (timer) clearTimeout(timer);
			if (graceTimer) clearTimeout(graceTimer);
			if (onAbort && signal) signal.removeEventListener('abort', onAbort);

			const prepared = buildOutput();
			resolve({
				status,
				exitCode,
				signal: exitSignal,
				durationMs: Date.now() - startedAt,
				output: prepared.text,
				truncated: prepared.truncated || stdout.truncated || stderr.truncated,
				...(spawnError ? {spawnError} : {}),
			});
		};

		/**
		 * Kill the tree, then wait (briefly) for it to actually be gone before
		 * reporting. A process that exits promptly — the common case — reaches
		 * `finish` via 'close' with no added latency at all.
		 */
		const killAndSettle = (status: 'timeout' | 'aborted') => {
			pendingKill = status;
			killProcessTree(proc);
			graceTimer = setTimeout(() => {
				finish(status, null, proc.signalCode ?? null);
			}, REAP_GRACE_MS);
			// A pending verification must not be the reason the process refuses
			// to exit on Ctrl-C.
			graceTimer.unref?.();
		};

		// stdin is ignored on purpose: a command that stops to prompt would
		// otherwise block until the timeout, producing a confusing failure
		// instead of an honest one.
		// nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
		let proc: ChildProcess;
		try {
			proc = spawn(plan.file, plan.args, {
				cwd,
				shell: plan.shell,
				detached: plan.detached,
				stdio: ['ignore', 'pipe', 'pipe'],
				windowsHide: true,
				windowsVerbatimArguments: plan.verbatim === true,
			});
		} catch (error) {
			// `spawn` throws synchronously for loadable-looking but unloadable
			// targets: on Windows an `*.exe`/`*.com` that is not a real PE image
			// (empty file, text file, wrong-architecture binary) surfaces as a
			// raw `ErrnoException` instead of the async `error` event, because
			// that errno is outside libuv's allowlist. Left unhandled it rejects
			// the promise, which reaches `unhandledRejection` and takes the whole
			// session down over a bad verification command. This function
			// promises never to reject, so resolve it like any other reason the
			// command cannot be run.
			finish(
				'unavailable',
				null,
				null,
				error instanceof Error ? error.message : String(error),
			);
			return;
		}

		proc.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
		proc.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));

		proc.on('error', (error: Error) => {
			finish('unavailable', null, null, error.message);
		});

		proc.on(
			'close',
			(code: number | null, exitSignal: NodeJS.Signals | null) => {
				// A kill-driven close keeps the reason it was killed. The exit code
				// is dropped rather than reported, because it describes the kill
				// rather than the verification and would read as a test failure.
				if (pendingKill) {
					finish(pendingKill, null, exitSignal ?? proc.signalCode ?? null);
					return;
				}
				finish(code === 0 ? 'passed' : 'failed', code, exitSignal);
			},
		);

		if (timeoutMs > 0) {
			timer = setTimeout(() => killAndSettle('timeout'), timeoutMs);
			timer.unref?.();
		}

		if (signal) {
			onAbort = () => killAndSettle('aborted');
			signal.addEventListener('abort', onAbort, {once: true});
		}
	});
}
