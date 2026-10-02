/**
 * Free-form prompt runs for the daemon.
 *
 * Triggered runs (`file.changed`, `schedule.cron`) are the daemon's native
 * unit of work, but a remote client - a chat bridge, an editor, a script -
 * needs to hand the daemon an arbitrary instruction and get the answer
 * back. This module owns that path. It turns an IPC `prompt` request into a
 * subagent run under a built-in runner agent, serializes requests so two
 * clients never edit the working tree at the same time, and snapshots the
 * tree first so the user can revert from wherever they sent the message.
 *
 * The runner is transport-agnostic: `source/daemon/ipc.ts` exposes it over
 * the socket today, and an HTTP surface can reuse it unchanged.
 */

import type {Checkpointer, ExecutorFactory} from '@/skills/dispatcher';
import {
	type SubagentConfigWithSource,
	SubagentLoadPriority,
	type SubagentResult,
} from '@/subagents/types';
import type {DevelopmentMode} from '@/types/core';
import {formatError} from '@/utils/error-formatter';

/**
 * Name of the built-in subagent remote prompts run under. The daemon
 * registers it at boot (see `buildPromptRunnerConfig`).
 */
export const PROMPT_RUNNER_AGENT = 'nanocoder-prompt-runner';

/** Modes a remote prompt may run in: `headless` executes tools, `plan` only reports. */
export type PromptRunMode = Extract<DevelopmentMode, 'headless' | 'plan'>;

const PROMPT_RUN_MODES: readonly PromptRunMode[] = ['headless', 'plan'];

/**
 * Longest prompt accepted over IPC. Every chat platform caps messages far
 * lower; this only guards the daemon against a runaway client.
 */
export const MAX_PROMPT_LENGTH = 64 * 1024;

export interface PromptRequest {
	prompt: string;
	/** Defaults to `headless`. */
	mode?: PromptRunMode;
	/**
	 * Who sent the prompt, for the daemon log and the checkpoint reason
	 * (`telegram:123456`). Free-form, truncated to 200 characters.
	 */
	source?: string;
}

export interface PromptResult {
	success: boolean;
	output: string;
	error?: string;
	durationMs: number;
	/** Checkpoint taken before the run, when one could be created. */
	checkpointId?: string;
}

export interface PromptRunActivity {
	request: PromptRequest;
	mode: PromptRunMode;
	result: SubagentResult;
	checkpointId?: string;
	durationMs: number;
}

export interface PromptRunnerOptions {
	buildExecutor: ExecutorFactory;
	/** Snapshot the tree before a mutating (non-plan) run. */
	checkpointer?: Checkpointer;
	/** Called after every run, success or failure. */
	onActivity?: (activity: PromptRunActivity) => void;
}

export interface PromptRunner {
	/**
	 * Queue a prompt. Resolves once the run has finished; never rejects -
	 * executor failures come back as `success: false`.
	 */
	run(request: PromptRequest): Promise<PromptResult>;
}

/**
 * Validate an untrusted IPC payload. Returns the request, or a message
 * describing what is wrong with it. Unknown fields are dropped.
 */
export function parsePromptRequest(
	params: unknown,
): {request: PromptRequest; error?: undefined} | {error: string} {
	if (!params || typeof params !== 'object' || Array.isArray(params)) {
		return {error: 'prompt params must be an object'};
	}
	const raw = params as Record<string, unknown>;

	if (typeof raw.prompt !== 'string' || raw.prompt.trim() === '') {
		return {error: 'prompt must be a non-empty string'};
	}
	if (raw.prompt.length > MAX_PROMPT_LENGTH) {
		return {error: `prompt exceeds ${MAX_PROMPT_LENGTH} characters`};
	}

	const request: PromptRequest = {prompt: raw.prompt};

	if (raw.mode !== undefined) {
		if (
			typeof raw.mode !== 'string' ||
			!PROMPT_RUN_MODES.includes(raw.mode as PromptRunMode)
		) {
			return {error: `mode must be one of: ${PROMPT_RUN_MODES.join(', ')}`};
		}
		request.mode = raw.mode as PromptRunMode;
	}

	if (raw.source !== undefined) {
		if (typeof raw.source !== 'string') {
			return {error: 'source must be a string'};
		}
		const source = raw.source.trim().slice(0, 200);
		if (source) request.source = source;
	}

	return {request};
}

export function createPromptRunner(options: PromptRunnerOptions): PromptRunner {
	// FIFO chain. Triggered runs already serialize per subscription through
	// the backpressure dispatcher; remote prompts share one lane so two
	// chats cannot race each other over the same files. A failed run must
	// not poison the chain, so the tail swallows rejections.
	let tail: Promise<void> = Promise.resolve();

	return {
		run(request) {
			const result = tail.then(() => execute(options, request));
			tail = result.then(
				() => undefined,
				() => undefined,
			);
			return result;
		},
	};
}

async function execute(
	options: PromptRunnerOptions,
	request: PromptRequest,
): Promise<PromptResult> {
	const mode: PromptRunMode = request.mode ?? 'headless';
	const source = request.source ?? 'ipc';

	let checkpointId: string | undefined;
	if (mode !== 'plan' && options.checkpointer) {
		try {
			checkpointId = await options.checkpointer.create(`prompt:${source}`);
		} catch {
			// Non-fatal, as for triggered runs: the run proceeds and the result
			// simply carries no checkpoint id.
		}
	}

	const start = Date.now();
	let result: SubagentResult;
	try {
		result = await options.buildExecutor(mode).execute({
			subagent_type: PROMPT_RUNNER_AGENT,
			description: `Handle a request relayed from ${source}`,
			prompt: request.prompt,
		});
	} catch (err) {
		result = {
			subagentName: PROMPT_RUNNER_AGENT,
			output: '',
			success: false,
			error: formatError(err),
			executionTimeMs: Date.now() - start,
		};
	}
	const durationMs = Date.now() - start;

	options.onActivity?.({request, mode, result, checkpointId, durationMs});

	return {
		success: result.success,
		output: result.output,
		...(result.error ? {error: result.error} : {}),
		durationMs,
		...(checkpointId ? {checkpointId} : {}),
	};
}

/**
 * The built-in subagent remote prompts execute under. No tool allowlist,
 * so it sees whatever the run's mode permits - the same posture as the
 * command runner for triggered skills.
 */
export function buildPromptRunnerConfig(): SubagentConfigWithSource {
	return {
		name: PROMPT_RUNNER_AGENT,
		description:
			'Carries out a request relayed to the daemon from a remote client such as a chat app.',
		model: 'inherit',
		systemPrompt:
			"You are handling a request relayed to this project's daemon from a remote client, usually a chat app on the user's phone. " +
			'Nobody is watching a terminal and nobody can answer questions, so never ask for clarification: make reasonable assumptions, state them in one line, and carry out the request with your tools. ' +
			'When you are done, reply with a short plain-text summary that reads well as a chat message: what you did, what you found, and anything the user must do next. ' +
			'Keep code listings out of the reply unless they were explicitly asked for; mention file paths instead.',
		source: {priority: SubagentLoadPriority.BuiltIn, isBuiltIn: true},
	};
}
