import {type ChildProcess, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {isAbsolute, resolve} from 'node:path';
import {TRUNCATION_OUTPUT_LIMIT} from '@/constants';
import {cmdQuote, renderBody, shellQuote} from '@/custom-tools/template';
import type {CustomToolMetadata} from '@/types/custom-tools';
import type {ToolHandler} from '@/types/index';
import {isRealPathInside} from '@/utils/path-validation';
import {
	makeStreamCollector,
	STDERR_TRUNCATION_NOTICE,
	STDOUT_TRUNCATION_NOTICE,
} from '@/utils/stream-collector';
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
		const shell = pickShell(metadata.shell);
		const rendered = renderBody(
			body,
			applyParameterDefaults(metadata, args ?? {}),
			isWindowsCmd(shell) ? cmdQuote : shellQuote,
		);
		const cwd = resolveCwd(metadata.cwd, projectRoot);
		const env = mergeEnv(metadata.env);
		return runScript(rendered, {
			cwd,
			env,
			shell,
			timeoutMs: metadata.timeoutMs,
		});
	};
}

/**
 * Fill each omitted argument with its declared `default:`. The JSON schema
 * advertises defaults to the model, but models routinely leave optional
 * arguments out, so the template has to apply them itself.
 */
export function applyParameterDefaults(
	metadata: CustomToolMetadata,
	args: Record<string, unknown>,
): Record<string, unknown> {
	const filled = {...args};
	for (const [name, def] of Object.entries(metadata.parameters)) {
		if (filled[name] === undefined && def.default !== undefined) {
			filled[name] = def.default;
		}
	}
	return filled;
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
			// cmd.exe parses a command string itself. Let it receive the wrapper and
			// the doubled quotes from shellArgs verbatim; libuv quoting them again
			// changes the argv seen by the child command.
			windowsVerbatimArguments: isWindowsCmd(options.shell),
		});

		let stdout = '';
		let stderr = '';
		let settled = false;

		const timer = setTimeout(() => {
			// Drop our end of the pipes first so a detached grandchild that
			// inherited them cannot keep them readable, then signal the whole
			// process group.
			child.stdout?.destroy();
			child.stderr?.destroy();
			killProcessTree(child);

			// Force-kill the group if it refuses to die within a grace window.
			// No `!child.killed` guard: Node sets that flag the moment a signal
			// is delivered, so it is already true here and the escalation would
			// never run (see #1141). Nothing cancels this timer either -- unlike
			// the single-process case, the shell exiting does not mean its group
			// is empty, and reaping a descendant that ignored SIGTERM is the
			// whole point. Firing against an already-dead group is harmless:
			// killProcessTree swallows the ESRCH, and it is unref'd so it never
			// holds the process open.
			setTimeout(() => {
				killProcessTree(child, 'SIGKILL');
			}, 1_000).unref();

			// Settle now rather than waiting for `exit`/`close`: neither is
			// guaranteed to be prompt while a descendant holds an inherited
			// pipe, and the captured output is discarded on this path anyway.
			settle(() =>
				rejectPromise(
					new Error(`Custom tool timed out after ${options.timeoutMs}ms`),
				),
			);
		}, options.timeoutMs);

		// Guard every completion path: an `error`/`close` arriving after the
		// timeout already settled must not settle the promise a second time.
		const settle = (finish: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			finish();
		};

		// Per-stream byte budgets, shared with the built-in bash executor.
		const stdoutCollector = makeStreamCollector(text => {
			stdout += text;
		}, STDOUT_TRUNCATION_NOTICE);
		const stderrCollector = makeStreamCollector(text => {
			stderr += text;
		}, STDERR_TRUNCATION_NOTICE);
		child.stdout?.on('data', stdoutCollector.collect);
		child.stderr?.on('data', stderrCollector.collect);

		child.on('error', err => {
			settle(() =>
				rejectPromise(new Error(`Custom tool failed to start: ${err.message}`)),
			);
		});

		child.on('close', code => {
			settle(() => {
				// Release any multi-byte character the decoders were holding
				// across a chunk boundary before the output is formatted.
				stdoutCollector.flush();
				stderrCollector.flush();
				resolvePromise(
					truncateToolResult(
						formatScriptOutput(code, stdout, stderr),
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
): string {
	const exitCode = code ?? 0;
	// Any cap notice is already inline at the end of its own stream (see
	// makeStreamCollector), so it survives the tail-keeping truncation below.
	const out = stdout.trimEnd();
	const err = stderr.trimEnd();
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

/** cmd.exe: disable AutoRun/delayed expansion, then run one wrapped command. */
export function shellArgs(shell: string, script: string): string[] {
	return isWindowsCmd(shell)
		? ['/d', '/v:off', '/s', '/c', `"${script}"`]
		: ['-c', script];
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
