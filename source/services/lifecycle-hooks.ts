import {type ChildProcess, spawn} from 'node:child_process';

import {getAppConfig} from '@/config/index';
import {getProjectRoot, getSafeSessionCwd} from '@/services/session-cwd';
import {getKeyGeneratorSessionId} from '@/session/key-generator';
import type {HookDefinition, HookEvent} from '@/types/config';
import type {ToolCall} from '@/types/core';
import {logError} from '@/utils/message-queue';
import {truncateToolResult} from '@/utils/truncate-tool-result';

/** Ceiling on a single hook's runtime. Overridable per hook via `timeout`. */
const DEFAULT_HOOK_TIMEOUT_MS = 30_000;

/**
 * `session-end` runs inside the shutdown manager's budget
 * (NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT, 5s by default), shared with the session
 * autosave flush and the UI teardown. A 30s default would be unreachable there
 * — the process exits first — so this event defaults low enough to finish and
 * still leave the rest of the shutdown room to run.
 */
const SESSION_END_HOOK_TIMEOUT_MS = 2_000;

function defaultTimeoutFor(event: HookEvent): number {
	return event === 'session-end'
		? SESSION_END_HOOK_TIMEOUT_MS
		: DEFAULT_HOOK_TIMEOUT_MS;
}

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

/**
 * Bumped by /clear. Anything a hook was still producing when the conversation
 * was cleared belongs to the conversation that went away, so a late arrival
 * compares generations and drops itself rather than grafting onto the new one.
 */
let contextGeneration = 0;

/** The in-flight `session-start` run, so the first prompt can wait for it. */
let sessionStartRun: Promise<void> | null = null;

/** The shutdown-manager handler name both session surfaces register under. */
export const SESSION_END_HOOK_HANDLER = 'lifecycle-hooks:session-end';

export function addPendingHookContext(text: string): void {
	const trimmed = text.trim();
	if (trimmed) pendingContext.push(trimmed);
}

/**
 * Kick off the `session-start` hooks and buffer their output.
 *
 * Returns the run so a caller can wait for it. Init deliberately does not:
 * a slow `git log` must not hold up the UI. The wait happens at the point it
 * actually matters — draining the buffer for the first prompt — via
 * takePendingHookContext(), so a fast typist still gets the context on prompt
 * one rather than prompt two.
 */
export function beginSessionStartHooks(): Promise<void> {
	if (sessionStartRun) return sessionStartRun;

	const generation = contextGeneration;
	sessionStartRun = runLifecycleHooks('session-start').then(({output}) => {
		if (output && generation === contextGeneration) {
			addPendingHookContext(output);
		}
	});
	return sessionStartRun;
}

/**
 * Drain the buffer, letting an in-flight `session-start` finish first.
 * Returns '' when nothing is pending.
 */
export async function takePendingHookContext(): Promise<string> {
	if (sessionStartRun) await sessionStartRun;
	return drainPendingHookContext();
}

/** The synchronous drain, for callers that have already awaited session-start. */
export function drainPendingHookContext(): string {
	if (pendingContext.length === 0) return '';
	const joined = pendingContext.join('\n\n');
	pendingContext = [];
	return joined;
}

/** Test seam — also used by /clear to drop stale session-start context. */
export function clearPendingHookContext(): void {
	pendingContext = [];
	contextGeneration++;
}

/** Test seam: forget the in-flight session-start run between test cases. */
export function resetSessionStartHooks(): void {
	sessionStartRun = null;
}

export function getConfiguredHooks(event: HookEvent): HookDefinition[] {
	return getAppConfig().hooks?.[event] ?? [];
}

/**
 * Tool calls whose `pre-tool-use` hooks have already run and passed.
 *
 * The gate is applied at more than one layer on purpose: the interactive TUI
 * gates before it renders a confirmation prompt (so a vetoed tool never asks
 * the user to approve something that is about to be refused), while
 * processToolUse, the streaming bash path, and the subagent loop each gate at
 * the execution boundary so no surface can reach a handler ungated. Keyed on
 * the tool-call object rather than its id, because ids are provider-supplied
 * and not guaranteed unique; a WeakSet also means nothing has to be cleaned up
 * when the turn ends.
 */
const gatedToolCalls = new WeakSet<ToolCall>();

/**
 * Run the `pre-tool-use` hooks for one tool call, at most once per call
 * however many layers ask.
 *
 * Hooks have side effects — an audit-log hook must record one line per tool
 * call, not one per layer that happens to check — so the second and later
 * callers for the same tool call get a pass without re-running anything.
 */
export async function runPreToolUseGate(
	toolCall: ToolCall,
	toolArgs: Record<string, unknown>,
): Promise<HookOutcome> {
	if (gatedToolCalls.has(toolCall)) return {blocked: false, output: ''};

	const outcome = await runLifecycleHooks('pre-tool-use', {
		toolName: toolCall.function.name,
		toolArgs,
	});
	// Only a pass is recorded. A veto short-circuits the call entirely, so
	// there is no later layer left to suppress.
	if (!outcome.blocked) gatedToolCalls.add(toolCall);
	return outcome;
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
	// Re-truncate the joined result. The caller already capped `content`, so
	// appending here without this could push a result past the cap by up to
	// MAX_HOOK_OUTPUT_CHARS — the cap exists to protect the context window, and
	// a chatty hook must not be the thing that breaches it.
	return truncateToolResult(
		`${content}\n\n<hook-output event="post-tool-use">\n${output}\n</hook-output>`,
	);
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
		// Where the hook itself runs (the project root).
		NANOCODER_CWD: cwd,
		// Where the agent's shell currently is, which a `cd` in execute_bash
		// moves. Hooks that need to act on the model's location read this.
		NANOCODER_SESSION_CWD: getSafeSessionCwd(),
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
 * Kill a timed-out hook and anything it started.
 *
 * `shell: true` means the child is `sh` / `cmd.exe`, not the user's command —
 * signalling it alone leaves the grandchildren of a compound command (`a && b`,
 * a pipeline) running after the agent has moved on. On POSIX the child is
 * spawned `detached`, so it leads its own process group and a negative pid
 * signals the whole group. Windows has no equivalent, so `taskkill /T` walks
 * the tree instead.
 */
function killHookTree(proc: ChildProcess): void {
	const pid = proc.pid;
	if (pid === undefined) return;

	try {
		if (process.platform === 'win32') {
			// /T kills the tree, /F forces it. Detached and unref'd so a slow
			// taskkill can't itself hold the session open. Fixed argv, no shell,
			// and the only interpolated value is a pid we minted ourselves.
			// nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
			const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
				stdio: 'ignore',
				detached: true,
			});
			killer.on('error', () => {
				// taskkill missing (a stripped image): fall back to the shell alone.
				proc.kill('SIGKILL');
			});
			killer.unref();
			return;
		}
		// Negative pid = "the whole process group", which the detached spawn
		// above made this process the leader of.
		process.kill(-pid, 'SIGTERM');
	} catch {
		// The group is already gone, or we lost the race with a normal exit.
		// Either way there is nothing left to reap.
		try {
			proc.kill('SIGKILL');
		} catch {
			// Nothing left to kill.
		}
	}
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
	defaultTimeoutMs: number,
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
		//
		// `detached` puts the shell in its own process group on POSIX so the
		// timeout below can signal the group rather than just `sh`. Without it a
		// compound command (`a && b`, a pipeline) leaves its grandchildren
		// running after the agent has moved on. Windows has no process groups to
		// detach into, and `detached` there spawns a new console window, so it
		// stays off and the taskkill path below does the reaping instead.
		// nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true, javascript.lang.security.detect-child-process.detect-child-process
		const proc = spawn(hook.command, {
			cwd,
			env,
			shell: true,
			detached: process.platform !== 'win32',
		});

		const timeoutMs = hook.timeout ?? defaultTimeoutMs;
		const timer = setTimeout(() => {
			killHookTree(proc);
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

	// The project root, not the session cwd: a hook is defined in project
	// config, so a relative `command` like `.nanocoder/hooks/guard.sh` has to
	// keep resolving after the model has `cd`-ed the shell somewhere else.
	const cwd = getProjectRoot();
	const env = buildEnv(event, context, cwd);
	const canVeto = VETOING_EVENTS.has(event);
	const defaultTimeoutMs = defaultTimeoutFor(event);
	const collected: string[] = [];

	for (const hook of hooks) {
		const run = await runHookCommand(hook, env, cwd, defaultTimeoutMs);
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
