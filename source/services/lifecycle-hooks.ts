import {spawn} from 'node:child_process';

import {getAppConfig} from '@/config/index';
import {getSafeSessionCwd} from '@/services/session-cwd';
import {getKeyGeneratorSessionId} from '@/session/key-generator';
import type {HookDefinition, HookEvent} from '@/types/config';
import {logError} from '@/utils/message-queue';

/** Ceiling on a single hook's runtime. Overridable per hook via `timeout`. */
const DEFAULT_HOOK_TIMEOUT_MS = 30_000;

/** Cap on captured stdout/stderr so a chatty hook can't blow up context. */
const MAX_HOOK_OUTPUT_CHARS = 16 * 1024;

/**
 * Everything a hook can be told about the moment it fired. Each populated
 * field becomes a `NANOCODER_*` environment variable for the hook command.
 */
export interface HookContext {
	toolName?: string;
	toolArgs?: Record<string, unknown>;
	toolResult?: string;
	prompt?: string;
	messageCount?: number;
}

export interface HookOutcome {
	/**
	 * True when a hook exited non-zero on a vetoing event (`pre-tool-use`,
	 * `user-prompt-submit`). Always false for observe-only events.
	 */
	blocked: boolean;
	/** Label + output of the hook that blocked, for the model and the user. */
	reason?: string;
	/** Combined stdout of the hooks that ran, trimmed. Empty when none wrote. */
	output: string;
}

/** Events where a non-zero exit vetoes the action instead of just logging. */
const VETOING_EVENTS: ReadonlySet<HookEvent> = new Set([
	'pre-tool-use',
	'user-prompt-submit',
]);

/**
 * Context gathered by `session-start` / `user-prompt-submit` hooks that has not
 * been handed to the model yet. Drained on the next prompt submission, so a
 * `git log -5` at session start reaches the model without the user typing
 * anything.
 */
let pendingContext: string[] = [];

export function addPendingHookContext(text: string): void {
	const trimmed = text.trim();
	if (trimmed) pendingContext.push(trimmed);
}

/** Drain the buffer. Returns '' when nothing is pending. */
export function takePendingHookContext(): string {
	if (pendingContext.length === 0) return '';
	const joined = pendingContext.join('\n\n');
	pendingContext = [];
	return joined;
}

/** Test seam — also used by /clear to drop stale session-start context. */
export function clearPendingHookContext(): void {
	pendingContext = [];
}

export function getConfiguredHooks(event: HookEvent): HookDefinition[] {
	return getAppConfig().hooks?.[event] ?? [];
}

/**
 * Run the `post-tool-use` hooks for one tool call and fold any stdout into the
 * result the model reads, so a formatter's output (or a linter's complaint)
 * lands on the same turn instead of a turn later. Shared by every execution
 * path so the tag the model sees is identical whichever one ran the tool.
 */
export async function appendPostToolUseOutput(
	toolName: string,
	toolArgs: Record<string, unknown>,
	content: string,
): Promise<string> {
	const {output} = await runLifecycleHooks('post-tool-use', {
		toolName,
		toolArgs,
		toolResult: content,
	});
	if (!output) return content;
	return `${content}\n\n<hook-output event="post-tool-use">\n${output}\n</hook-output>`;
}

/** Human-readable label for transcripts and error messages. */
function hookLabel(hook: HookDefinition): string {
	return hook.name ?? hook.command;
}

/**
 * A tool-scoped hook with no `matchTools` applies to every tool; otherwise the
 * tool name must be listed. Non-tool events ignore `matchTools` entirely.
 */
function appliesTo(hook: HookDefinition, toolName?: string): boolean {
	if (!hook.matchTools) return true;
	if (!toolName) return true;
	return hook.matchTools.includes(toolName);
}

/**
 * The file a tool acted on, when it has one. Every file tool names the
 * argument `path`; `file_path` / `filePath` are accepted because weaker models
 * emit them and the formatters already tolerate both.
 */
function resolveFilePath(args?: Record<string, unknown>): string | undefined {
	for (const key of ['path', 'file_path', 'filePath']) {
		const value = args?.[key];
		if (typeof value === 'string' && value !== '') return value;
	}
	return undefined;
}

function buildEnv(
	event: HookEvent,
	context: HookContext,
	cwd: string,
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		NANOCODER_HOOK_EVENT: event,
		NANOCODER_CWD: cwd,
		// The process-wide session id — stable for the life of the session and
		// rebased by /clear and /resume, so a hook can key a log or a cache on it.
		NANOCODER_SESSION_ID: getKeyGeneratorSessionId(),
	};

	if (context.toolName) env.NANOCODER_TOOL_NAME = context.toolName;
	if (context.toolArgs) {
		try {
			env.NANOCODER_TOOL_ARGS = JSON.stringify(context.toolArgs);
		} catch {
			// Unserialisable args (cycles) just mean no NANOCODER_TOOL_ARGS.
		}
		const filePath = resolveFilePath(context.toolArgs);
		if (filePath) env.NANOCODER_FILE = filePath;
		const command = context.toolArgs.command;
		if (typeof command === 'string') env.NANOCODER_COMMAND = command;
	}
	if (context.toolResult !== undefined) {
		env.NANOCODER_TOOL_RESULT = context.toolResult.slice(
			0,
			MAX_HOOK_OUTPUT_CHARS,
		);
	}
	if (context.prompt !== undefined) env.NANOCODER_PROMPT = context.prompt;
	if (context.messageCount !== undefined) {
		env.NANOCODER_MESSAGE_COUNT = String(context.messageCount);
	}

	return env;
}

interface HookRun {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	/** Set when the hook never produced a usable exit code (spawn error/timeout). */
	failure?: string;
}

/**
 * Run one hook command to completion. Never rejects: a spawn failure or a
 * timeout resolves with `failure` set and no exit code, which callers treat as
 * "did not veto" so a broken script can't wedge the session.
 */
function runHookCommand(
	hook: HookDefinition,
	env: NodeJS.ProcessEnv,
	cwd: string,
): Promise<HookRun> {
	return new Promise<HookRun>(resolve => {
		let settled = false;
		const finish = (run: HookRun) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(run);
		};

		let stdout = '';
		let stderr = '';
		const capture = (current: string, chunk: Buffer): string => {
			const remaining = MAX_HOOK_OUTPUT_CHARS - current.length;
			return remaining <= 0
				? current
				: current + chunk.toString().slice(0, remaining);
		};

		// `shell: true` runs the command through `sh -c` / `cmd.exe /d /s /c`
		// with the platform's own quoting rules, so a hook body with quotes in
		// it survives on Windows as well as POSIX.
		//
		// Running a shell IS the feature: a hook is defined as a shell command,
		// the same way an `mcpServers` entry is defined as a command to spawn,
		// and both are read from the same project-local `agents.config.json`
		// behind the same directory-trust prompt.
		//
		// The invariant that keeps this safe — DO NOT BREAK IT: `hook.command`
		// is the ONLY value that reaches the shell. Everything the model
		// influences (tool arguments, file paths, bash commands, tool results,
		// prompts) is handed over through `env` in buildEnv() and is never
		// interpolated into the command string, so a model-chosen path like
		// `a.ts; rm -rf /` is inert here. Adding a template literal to this
		// line would turn a config string into an injection sink.
		// nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true, javascript.lang.security.detect-child-process.detect-child-process
		const proc = spawn(hook.command, {cwd, env, shell: true});

		const timeoutMs = hook.timeout ?? DEFAULT_HOOK_TIMEOUT_MS;
		const timer = setTimeout(() => {
			proc.kill('SIGTERM');
			finish({
				exitCode: null,
				stdout,
				stderr,
				failure: `timed out after ${timeoutMs}ms`,
			});
		}, timeoutMs);
		timer.unref();

		proc.stdout?.on('data', (chunk: Buffer) => {
			stdout = capture(stdout, chunk);
		});
		proc.stderr?.on('data', (chunk: Buffer) => {
			stderr = capture(stderr, chunk);
		});

		proc.on('error', (error: Error) => {
			finish({exitCode: null, stdout, stderr, failure: error.message});
		});
		proc.on('close', (code: number | null) => {
			finish({exitCode: code, stdout, stderr});
		});
	});
}

/**
 * Run every hook configured for `event`, in config order.
 *
 * Hooks are deterministic and model-free: they fire every time, cost no
 * tokens, and (on `pre-tool-use` / `user-prompt-submit`) can veto the action
 * by exiting non-zero. Only a real non-zero exit vetoes — a hook that times
 * out or fails to spawn is logged and skipped, so a broken script degrades to
 * "no hook" rather than wedging the agent. The first veto ends the chain; the
 * remaining hooks for that event do not run.
 *
 * Hook commands come from project-local `agents.config.json`, the same file
 * that already configures `mcpServers`; both are gated by the directory-trust
 * prompt that guards the session as a whole.
 */
export async function runLifecycleHooks(
	event: HookEvent,
	context: HookContext = {},
): Promise<HookOutcome> {
	const hooks = getConfiguredHooks(event).filter(hook =>
		appliesTo(hook, context.toolName),
	);
	if (hooks.length === 0) return {blocked: false, output: ''};

	const cwd = getSafeSessionCwd();
	const env = buildEnv(event, context, cwd);
	const canVeto = VETOING_EVENTS.has(event);
	const collected: string[] = [];

	for (const hook of hooks) {
		const run = await runHookCommand(hook, env, cwd);
		const label = hookLabel(hook);

		if (run.failure) {
			logError(`Hook "${label}" (${event}) ${run.failure} — skipping.`);
			continue;
		}

		if (run.exitCode !== 0) {
			const detail = run.stdout.trim() || run.stderr.trim();
			if (canVeto) {
				return {
					blocked: true,
					reason: detail
						? `Blocked by hook "${label}": ${detail}`
						: `Blocked by hook "${label}" (exit ${run.exitCode}).`,
					output: collected.join('\n').trim(),
				};
			}
			logError(
				`Hook "${label}" (${event}) exited ${run.exitCode}${
					detail ? `: ${detail}` : ''
				}`,
			);
			continue;
		}

		const out = run.stdout.trim();
		if (out) collected.push(out);
	}

	return {blocked: false, output: collected.join('\n').trim()};
}
