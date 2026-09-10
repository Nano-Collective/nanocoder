import {type ChildProcess, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {isAbsolute, resolve} from 'node:path';
import {BASH_MAX_OUTPUT_BYTES, TRUNCATION_OUTPUT_LIMIT} from '@/constants';
import {renderBody} from '@/custom-tools/template';
import type {CustomToolMetadata} from '@/types/custom-tools';
import type {ToolHandler} from '@/types/index';
import {isRealPathInside} from '@/utils/path-validation';
import {truncateToolResult} from '@/utils/truncate-tool-result';

/**
 * Build a `ToolHandler` that renders the script body and runs it under the
 * configured shell. Captures stdout + stderr, applies the timeout, and
 * returns the trimmed/truncated combined output.
 */
export function buildHandler(
	metadata: CustomToolMetadata,
	body: string,
	projectRoot: string,
): ToolHandler {
	return async (args: Record<string, unknown>): Promise<string> => {
		const rendered = renderBody(body, args ?? {});
		const cwd = resolveCwd(metadata.cwd, projectRoot);
		const env = mergeEnv(metadata.env);
		const shell = pickShell(metadata.shell);
		return runScript(rendered, {
			cwd,
			env,
			shell,
			timeoutMs: metadata.timeoutMs,
		});
	};
}

export interface RunOptions {
	cwd: string;
	env: NodeJS.ProcessEnv;
	shell: string;
	timeoutMs: number;
}

/**
 * Spawn the shell with the rendered script and wait for completion.
 *
 * Always returns the captured output (matching `execute_bash`'s behavior). A
 * non-zero exit gets an `EXIT_CODE: N` prefix and stderr/stdout sections so
 * the LLM can reason about it, but is NOT treated as a tool failure — many
 * CLIs (`pnpm audit`, `git diff --exit-code`, `grep`, test runners) exit
 * non-zero as part of normal operation. Throws are reserved for genuine tool
 * failures: spawn errors (command not found) and timeouts.
 */
export function runScript(
	script: string,
	options: RunOptions,
): Promise<string> {
	return new Promise((resolvePromise, rejectPromise) => {
		// On Unix the child leads its own process group (detached) so the whole
		// subtree can be signalled together; a tool that backgrounds a long-lived
		// child must not be able to outlive the shell's timeout.
		const child = spawn(options.shell, shellArgs(options.shell, script), {
			cwd: options.cwd,
			env: options.env,
			stdio: ['ignore', 'pipe', 'pipe'],
			detached: process.platform !== 'win32',
		});

		let stdout = '';
		let stderr = '';
		let outputBytes = 0;
		let stdoutCapped = false;
		let stderrCapped = false;
		let settled = false;

		// Combine stdout + stderr into a single byte budget, mirroring the built-in
		// bash executor. Without a cap, a long-running tool printing large output
		// is fully materialised in memory before the final truncation runs.

		const timer = setTimeout(() => {
			// Destroy the pipes so nothing keeps the event loop (or a detached
			// grandchild's inherited fds) engaged, then kill the process group.
			child.stdout?.destroy();
			child.stderr?.destroy();
			killProcessTree(child);
			// Force-kill the group if it refuses to exit within a grace window.
			// Deliberately stronger than BashExecutor.cancel()'s SIGTERM-only:
			// a custom tool is user-authored and its timeout must hold even
			// against a child that traps SIGTERM, so the escalation is the
			// guarantee here rather than an inconsistency to converge away.
			setTimeout(() => {
				if (!child.killed) killProcessTree(child, 'SIGKILL');
			}, 1_000).unref();

			// Settle now rather than waiting for `close`, which may never fire if a
			// descendant holds a pipe inherited from the shell.
			settle(() =>
				rejectPromise(
					new Error(`Custom tool timed out after ${options.timeoutMs}ms`),
				),
			);
		}, options.timeoutMs);

		// Guard every completion path: `error`/`close` arriving after the timeout
		// (which already settled) must not double-resolve the promise.
		const settle = (finish: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			finish();
		};

		child.stdout?.on('data', (data: Buffer) => {
			if (outputBytes < BASH_MAX_OUTPUT_BYTES) {
				const remaining = BASH_MAX_OUTPUT_BYTES - outputBytes;
				const limited = data.subarray(0, remaining);
				stdout += limited.toString();
				outputBytes += limited.length;
				if (outputBytes >= BASH_MAX_OUTPUT_BYTES) stdoutCapped = true;
			}
		});
		child.stderr?.on('data', (data: Buffer) => {
			if (outputBytes < BASH_MAX_OUTPUT_BYTES) {
				const remaining = BASH_MAX_OUTPUT_BYTES - outputBytes;
				const limited = data.subarray(0, remaining);
				stderr += limited.toString();
				outputBytes += limited.length;
				if (outputBytes >= BASH_MAX_OUTPUT_BYTES) stderrCapped = true;
			}
		});

		child.on('error', err => {
			settle(() =>
				rejectPromise(new Error(`Custom tool failed to start: ${err.message}`)),
			);
		});

		child.on('close', code => {
			settle(() => {
				// Per-stream notices let the model see which stream was cut. They
				// ride at the end of the captured stdout/stderr section (mirroring
				// the built-in bash executor) and, because truncateToolResult keeps
				// the tail, they survive the 2000-character limit.
				resolvePromise(
					truncateToolResult(
						formatScriptOutput(code, stdout, stderr, {
							stdoutCapped,
							stderrCapped,
						}),
						TRUNCATION_OUTPUT_LIMIT,
					),
				);
			});
		});
	});
}

/**
 * Terminate the spawned shell and its descendants.
 *
 * The child is spawned `detached` on Unix, making it the leader of its own
 * process group; signalling the negative PID kills the whole tree, so work the
 * tool backgrounded cannot survive the shell's timeout. Windows has no process
 * groups here, so we fall back to the single process: a descendant the tool
 * backgrounded keeps running to completion (the promise already settled, so
 * this leaks a stray process rather than hanging the call — documented
 * limitation; a Job Object / `taskkill /T` could close it).
 */
function killProcessTree(
	child: ChildProcess,
	signal: NodeJS.Signals = 'SIGTERM',
): void {
	const pid = child.pid;
	if (pid === undefined) return;

	if (process.platform === 'win32') {
		try {
			child.kill(signal);
		} catch {
			// Process already exited; nothing to terminate.
		}
		return;
	}

	try {
		process.kill(-pid, signal);
	} catch {
		// Group already gone (or never formed) — fall back to the lone process.
		try {
			child.kill(signal);
		} catch {
			// Process already exited; nothing to terminate.
		}
	}
}

/**
 * Format the captured output for the LLM. Mirrors `formatBashResultForLLM`
 * in `source/tools/execute-bash.tsx`: always include `EXIT_CODE: N` (so the
 * LLM can tell success from failure on every call, consistent with
 * `execute_bash`) and split stderr/stdout sections when stderr is present.
 */
function formatScriptOutput(
	code: number | null,
	stdout: string,
	stderr: string,
	options: {stdoutCapped: boolean; stderrCapped: boolean},
): string {
	const exitCode = code ?? 0;
	let out = stdout.trimEnd();
	let err = stderr.trimEnd();
	// Per-stream cap notices, mirroring the bash executor's "Output truncated"
	// / "Stderr truncated" markers.
	if (options.stdoutCapped) {
		out += '\n... [Output truncated to prevent memory exhaustion]';
	}
	if (options.stderrCapped) {
		err += '\n... [Stderr truncated to prevent memory exhaustion]';
	}
	const prefix = `EXIT_CODE: ${exitCode}\n`;
	if (err) {
		return `${prefix}STDERR:\n${err}\nSTDOUT:\n${out}`;
	}
	return `${prefix}${out}`;
}

/**
 * Resolve the working directory with `${VAR}` substitution from process.env.
 * Relative paths resolve against the project root.
 *
 * Returns the project root if the configured directory doesn't exist, so we
 * don't hard-fail on a stale checkout.
 *
 * Throws if the directory exists but really sits outside the project once
 * symlinks are resolved (a symlinked `./scripts`, an absolute path, `${HOME}`).
 * Falling back to the project root would be worse than refusing: a tool whose
 * body is `rm -rf ./*` and whose cwd was meant to be a scratch directory would
 * then run that against the project itself. The escape is a misconfiguration
 * and the user needs to see it, not have it silently redirected.
 *
 * Note this is containment, not a sandbox — the rendered body is arbitrary
 * shell and can `cd` anywhere it likes.
 */
export function resolveCwd(
	configured: string | undefined,
	projectRoot: string,
): string {
	if (!configured) return projectRoot;
	const expanded = expandVars(configured);
	const absolute = isAbsolute(expanded)
		? expanded
		: resolve(projectRoot, expanded);
	if (!existsSync(absolute)) return projectRoot;
	if (!isRealPathInside(absolute, projectRoot)) {
		throw new Error(
			`Custom tool cwd escapes the project directory: ${configured} -> ${absolute}`,
		);
	}
	return absolute;
}

/**
 * Merge configured env vars into `process.env`, performing `${VAR}`
 * substitution on values. Keys with no value resolve to an empty string.
 */
export function mergeEnv(
	configured: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
	const base: NodeJS.ProcessEnv = {...process.env};
	if (!configured) return base;
	for (const [k, v] of Object.entries(configured)) {
		base[k] = expandVars(v);
	}
	return base;
}

const PROCESS_ENV_REF =
	/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Expand `$VAR`, `${VAR}`, and `${VAR:-default}` references using values
 * from `process.env`. Unknown vars without a default expand to "".
 */
export function expandVars(value: string): string {
	return value.replace(PROCESS_ENV_REF, (_match, braced, def, bare) => {
		const name = braced ?? bare;
		const v = process.env[name];
		if (v !== undefined) return v;
		return def ?? '';
	});
}

/** cmd.exe: /d (skip AutoRun), /s (deterministic quotes), /c. POSIX: -c. */
export function shellArgs(shell: string, script: string): string[] {
	return isWindowsCmd(shell) ? ['/d', '/s', '/c', script] : ['-c', script];
}

function isWindowsCmd(shell: string): boolean {
	const name = shell.replaceAll('\\', '/').split('/').pop() ?? '';
	return /^cmd(\.exe)?$/i.test(name);
}

function pickShell(configured: string | undefined): string {
	if (configured === 'bash') return '/bin/bash';
	if (configured === 'sh') return '/bin/sh';
	if (process.platform === 'win32') return process.env.ComSpec || 'cmd.exe';
	if (existsSync('/bin/bash')) return '/bin/bash';
	return '/bin/sh';
}
