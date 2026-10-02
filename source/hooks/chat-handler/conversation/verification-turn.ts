/**
 * Wires the verification orchestrator into the interactive conversation loop.
 *
 * Kept apart from `conversation-loop.tsx` so the wiring is testable without
 * standing up Ink, and so the loop's diff stays about the loop.
 *
 * The two hook points exist because the baseline is only meaningful *before*
 * the first edit:
 *
 *  - `preEditHook` runs immediately before the first mutating tool executes.
 *  - `postEditHook` runs after the turn's results are in.
 *
 * Anything that mutates file contents counts as an edit. `file_op` is
 * deliberately excluded: deleting or moving a file can break a build, but it
 * produces no content to attribute, and counting it would fire verification
 * after a stray `mkdir` or a scratch-file delete.
 */

import {getAppConfig, getRetryLimits} from '@/config/index';
import {getContainedSessionCwd} from '@/services/session-cwd';
import {
	buildVerificationMessage,
	stripVerificationMessages,
	VerificationOrchestrator,
	type VerificationSettings,
} from '@/services/verification/orchestrator';
import type {Message, ToolCall, ToolResult} from '@/types/core';

/** File-mutating tools whose output a content check can be blamed on. */
const EDIT_TOOL_NAMES = new Set(['write_file', 'string_replace', 'diff_edit']);

/** Per-turn state threaded through the loop's recursive continuations. */
export interface VerificationTurn {
	orchestrator: VerificationOrchestrator;
}

/**
 * Start a verification turn, or `null` when the feature is off.
 *
 * `null` is the single "do nothing" signal. A disabled-but-present turn would
 * give the loop two ways to spell "off", and one of them would eventually be
 * missed at a call site.
 */
export function startVerificationTurn(): VerificationTurn | null {
	const config = getAppConfig().verification;
	if (!config?.command || !config.enabled) return null;

	const settings: VerificationSettings = {
		command: config.command,
		timeoutMs: config.timeoutMs,
		maxOutputBytes: config.maxOutputBytes,
		maxAttempts: getRetryLimits().maxVerificationAttempts,
		cwd: getContainedSessionCwd(),
	};

	return {orchestrator: new VerificationOrchestrator(settings)};
}

/** True when the turn ran a tool that changed file contents. */
export function turnEditedFiles(toolCalls: readonly ToolCall[]): boolean {
	return toolCalls.some(call => EDIT_TOOL_NAMES.has(call.function.name));
}

/**
 * True when the turn changed file contents *and the change succeeded*.
 *
 * The result list is what separates the two. A write rejected by the user, a
 * diff that matched nothing, a path outside the sandbox - each returns an error
 * result and leaves the tree byte-identical. Counting those as edits would run
 * the check against unchanged code and then report a pre-existing failure as
 * if the model had just caused it, which is the single most expensive way for
 * this feature to be wrong: the model gets told to fix something it did not
 * break.
 *
 * Falls back to the calls when results are unavailable, so a caller that has
 * not run its tools yet is not silently treated as having edited nothing.
 */
export function turnEditedFilesSuccessfully(
	toolCalls: readonly ToolCall[],
	results?: readonly ToolResult[],
): boolean {
	if (results === undefined) return turnEditedFiles(toolCalls);
	if (!turnEditedFiles(toolCalls)) return false;

	const succeeded = new Set(
		results.filter(result => !result.isError).map(result => result.name),
	);
	for (const name of succeeded) {
		if (EDIT_TOOL_NAMES.has(name)) return true;
	}
	return false;
}

/**
 * Take the pre-edit baseline if this turn is about to change files.
 *
 * Called immediately before the first mutating tool runs, so the window between
 * "the repository was green" and "the agent broke it" is as small as the loop
 * can make it. The residual gap is out-of-band mutation - a watcher, a
 * formatter, an editor - which is not detectable without hashing the tree, so
 * it is not pretended at here.
 */
export async function preEditHook(
	turn: VerificationTurn | undefined,
	toolCalls: readonly ToolCall[],
	signal?: AbortSignal,
): Promise<void> {
	if (!turn || turn.orchestrator.hasBaselineRun) return;
	if (!turnEditedFiles(toolCalls)) return;
	await turn.orchestrator.ensureBaseline(signal);
}

export type VerificationTurnResult =
	| {kind: 'none'}
	| {kind: 'instruct'; message: Message}
	| {kind: 'report'; text: string; status: string};

/**
 * Run the post-edit check and turn the outcome into what the loop should do.
 *
 * The three outcomes are deliberately different kinds of thing: an instruction
 * to the model, a line for the user, or nothing. A stop is never fed back to
 * the model, because a model told "the loop gave up" tends to try anyway.
 */
export async function postEditHook(
	turn: VerificationTurn | undefined,
	edited: boolean,
	signal?: AbortSignal,
): Promise<VerificationTurnResult> {
	if (!turn || !edited) return {kind: 'none'};

	const outcome = await turn.orchestrator.afterEdits(signal);

	switch (outcome.action) {
		case 'passed':
			return {kind: 'report', text: 'Verification passed.', status: 'passed'};

		case 'feedback':
			return {
				kind: 'instruct',
				message: buildVerificationMessage(outcome.text),
			};

		case 'stopped':
			return {kind: 'report', text: outcome.text, status: outcome.reason};

		case 'error':
			return {kind: 'report', text: outcome.message, status: 'error'};

		case 'skipped':
			// `busy` is a second run overlapping the first; saying so would be
			// noise, and the run already in flight will report.
			return {kind: 'none'};
	}
}

/**
 * Prepare the message list for a fresh verification instruction.
 *
 * Strips the previous attempt's message first: left in history, each retry
 * appends another copy of the same output to the context the model is about to
 * read, and the budget being spent is the one being drained.
 */
export function prepareForVerificationInstruction(
	messages: Message[],
	instruction: Message,
): Message[] {
	return [...stripVerificationMessages(messages), instruction];
}
