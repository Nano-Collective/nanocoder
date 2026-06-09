import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {isAbsolute, resolve} from 'node:path';
import {TRUNCATION_OUTPUT_LIMIT} from '@/constants';
import {renderBody} from '@/custom-tools/template';
import type {CustomToolMetadata} from '@/types/custom-tools';
import type {ToolHandler} from '@/types/index';

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
		const child = spawn(options.shell, ['-c', script], {
			cwd: options.cwd,
			env: options.env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let stdout = '';
		let stderr = '';
		let timedOut = false;

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill('SIGTERM');
			// Force-kill if the process refuses to exit within a grace window.
			setTimeout(() => {
				if (!child.killed) child.kill('SIGKILL');
			}, 1_000).unref();
		}, options.timeoutMs);

		child.stdout?.on('data', chunk => {
			stdout += chunk.toString();
		});
		child.stderr?.on('data', chunk => {
			stderr += chunk.toString();
		});

		child.on('error', err => {
			clearTimeout(timer);
			rejectPromise(new Error(`Custom tool failed to start: ${err.message}`));
		});

		child.on('close', code => {
			clearTimeout(timer);
			if (timedOut) {
				rejectPromise(
					new Error(`Custom tool timed out after ${options.timeoutMs}ms`),
				);
				return;
			}
			resolvePromise(truncate(formatScriptOutput(code, stdout, stderr)));
		});
	});
}

function truncate(text: string): string {
	if (text.length <= TRUNCATION_OUTPUT_LIMIT) return text;
	return text.slice(0, TRUNCATION_OUTPUT_LIMIT) + '\n... [Output truncated]';
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
 * Relative paths resolve against the project root. Returns the project root
 * if the configured directory doesn't exist (so we don't hard-fail on a
 * stale checkout).
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
	return existsSync(absolute) ? absolute : projectRoot;
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

function pickShell(configured: string | undefined): string {
	if (configured === 'bash') return '/bin/bash';
	if (configured === 'sh') return '/bin/sh';
	if (process.platform === 'win32') return process.env.ComSpec || 'cmd.exe';
	if (existsSync('/bin/bash')) return '/bin/bash';
	return '/bin/sh';
}
