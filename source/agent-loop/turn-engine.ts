/**
 * Shared agent turn engine.
 *
 * Nanocoder runs the same agent loop from four frontends (the Ink TUI, the
 * `--plain` shell, the ACP server and the subagent executor). Each used to
 * hand-write it, and fixes landed in one copy but not the others. This module
 * is the one copy: a single `while` loop with explicit per-iteration state,
 * no recursion, and no Ink/React imports, so every frontend can run it.
 *
 * ## What the engine owns
 *
 * One iteration is one model round-trip:
 *
 *   1. abort and turn-ceiling checks (`maxTurns`; the last allowed turn strips
 *      tools and asks for a final answer instead of failing)
 *   2. the request: system message + history capped to `sessions.maxMessages`
 *   3. the model call, with the frontend's stream sinks attached
 *   4. text tool-call parsing on the XML/JSON fallback path, and the
 *      malformed-call self-correction retry
 *   5. partitioning unknown/unusable calls and recording the assistant message
 *   6. auto-compaction, gated on the capped view the next request sends
 *   7. the retry guards (`nanocoder.retries`): repeated identical calls,
 *      empty turns, malformed calls and truncated turns
 *   8. handing valid calls to the frontend to run, then feeding the results
 *      back for the next iteration
 *
 * Everything that differs between frontends goes through the adapter.
 *
 * ## Adapter interface (`TurnEngineAdapter`)
 *
 * - `history`             where the conversation lives (a local array, an ACP
 *                         session, React state). The engine reads and writes
 *                         it at each step, so a throw keeps finished work.
 * - `getSystemMessage`    read per turn; `undefined` ends the run.
 * - `prepareTurn`         the tools and mode overrides offered this turn.
 * - `beginModelCall`      stream sinks for one call (render tokens, keep
 *                         reasoning), plus `end()` once the call settles.
 * - `onModelResponse`     per-call bookkeeping: usage, stats.
 * - `partitionToolCalls`  which emitted calls are runnable.
 * - `executeTools`        approval routing, hooks/plugin gates and execution
 *                         for one turn's valid calls. May stop the run.
 * - `onFinalAnswer`       a content-only turn: finish, or append messages
 *                         (a walkthrough nudge, say) and keep going.
 * - `on*Retry` / ...      notifications for status lines.
 *
 * The engine never renders and never formats a frontend's outcome. It returns
 * a `TurnEngineResult`, and each frontend maps that onto its own shape
 * (`PlainConversationOutcome`, an ACP `PromptResponse`, ...).
 */
import {getAppConfig} from '@/config/index';
import {
	createHeadlessRetryGuards,
	EMPTY_TURN_NUDGE,
	malformedToolCallNudge,
	TRUNCATED_TURN_INSTRUCTION,
} from '@/hooks/chat-handler/utils/headless-retry-guards';
import {
	buildAbandonedTurnMessages,
	type PartitionedToolCalls,
} from '@/hooks/chat-handler/utils/tool-filters';
import {parseToolCalls} from '@/tool-calling/index';
import type {RetryLimitsConfig} from '@/types/config';
import type {
	AISDKCoreTool,
	LLMChatResponse,
	LLMClient,
	Message,
	ModeOverrides,
	StreamCallbacks,
	ToolCall,
	ToolResult,
} from '@/types/core';
import {maybeAutoCompact} from '@/utils/auto-compact';
import {capMessagesForModel} from '@/utils/message-capping';

// On the last allowed turn we strip tools and inject this so the model
// finalizes cleanly instead of the loop bailing out with a hard error and
// discarding the work it has already done.
const FINAL_TURN_INSTRUCTION =
	'You have reached the maximum number of tool-execution turns for this run. ' +
	'Do not call any more tools. Produce your final answer now using only the ' +
	'information you already have.';

export interface TurnContext {
	/** Zero-based iteration index. */
	turn: number;
	/** The last allowed turn: no tools are offered and no text is parsed. */
	finalTurn: boolean;
}

export interface PreparedTurn {
	/** Every tool the turn offers. The engine sends none on the final turn. */
	tools: Record<string, AISDKCoreTool>;
	/** Names behind `tools`, for adapters that check what was offered. */
	availableNames: string[];
	modeOverrides?: ModeOverrides;
}

export interface ModelCallSink {
	callbacks: StreamCallbacks;
	/** The reasoning to keep on this turn's assistant message. */
	reasoning(): string | undefined;
	/** Called once the call settles, whether it returned or threw. */
	end?(): void;
}

export type ToolExecutionOutcome<S> =
	| {kind: 'continue'; results: ToolResult[]}
	/** End the run. `results` (if any) are recorded in history first. */
	| {kind: 'stop'; payload: S; results?: ToolResult[]};

export type FinalAnswerDecision =
	| {kind: 'finish'}
	/** Append `messages` and run another turn. */
	| {kind: 'continue'; messages: Message[]};

export interface FinalAnswerContext extends TurnContext {
	content: string;
	prepared: PreparedTurn;
}

export interface TurnEngineAdapter<S> {
	history: {get(): Message[]; set(messages: Message[]): void};
	getSystemMessage(): Message | undefined;
	prepareTurn(context: TurnContext): PreparedTurn;
	beginModelCall(context: TurnContext): ModelCallSink;
	onModelResponse?(response: LLMChatResponse): Promise<void> | void;
	partitionToolCalls(
		toolCalls: ToolCall[],
		prepared: PreparedTurn,
	): PartitionedToolCalls;
	/** Options for auto-compaction besides the signal. */
	compactOptions?: Omit<
		NonNullable<Parameters<typeof maybeAutoCompact>[4]>,
		'signal'
	>;
	executeTools(
		toolCalls: ToolCall[],
		context: TurnContext,
	): Promise<ToolExecutionOutcome<S>>;
	onFinalAnswer?(
		context: FinalAnswerContext,
	): Promise<FinalAnswerDecision> | FinalAnswerDecision;
	/** Called before a malformed turn is retried. */
	onMalformedRetry?(info: {error: string; attempt: number}): void;
	/** Calls rejected as unknown or unusable, before anything else is done. */
	onRejectedToolCalls?(partition: PartitionedToolCalls): void;
	onEmptyRetry?(attempt: number): void;
	onTruncatedRetry?(attempt: number): void;
	/** The truncated-turn cap was hit; the fragment stands as the answer. */
	onTruncatedGiveUp?(message: string): void;
}

export interface TurnEngineOptions<S> {
	client: LLMClient;
	signal: AbortSignal;
	maxTurns: number;
	retryLimits: RetryLimitsConfig;
	adapter: TurnEngineAdapter<S>;
}

export type TurnEngineStop<S> =
	| {kind: 'completed'}
	/** Aborted between turns or during the model call. */
	| {kind: 'aborted'}
	/** The model call threw while the signal was not aborted. */
	| {kind: 'model-error'; error: unknown}
	| {kind: 'no-response'}
	| {kind: 'no-system-message'}
	| {
			kind: 'guard-stop';
			guard: 'malformed' | 'empty' | 'repeated-tool-calls';
			message: string;
			/** Valid calls recorded in history that were never run. */
			unrunToolCalls: ToolCall[];
	  }
	| {kind: 'max-turns'; maxTurns: number}
	| {kind: 'adapter-stop'; payload: S};

/** `modelCalls` counts every request, including one that threw. */
export type TurnEngineResult<S> = TurnEngineStop<S> & {modelCalls: number};

export async function runTurnEngine<S>(
	options: TurnEngineOptions<S>,
): Promise<TurnEngineResult<S>> {
	const {client, signal, maxTurns, retryLimits, adapter} = options;
	const {history} = adapter;
	const guards = createHeadlessRetryGuards(retryLimits);
	let modelCalls = 0;
	const stop = (result: TurnEngineStop<S>): TurnEngineResult<S> => ({
		...result,
		modelCalls,
	});
	const append = (...messages: Message[]) => {
		history.set([...history.get(), ...messages]);
	};

	for (let turn = 0; turn < maxTurns; turn++) {
		if (signal.aborted) {
			return stop({kind: 'aborted'});
		}

		const context: TurnContext = {turn, finalTurn: turn === maxTurns - 1};
		const {finalTurn} = context;
		const prepared = adapter.prepareTurn(context);
		const tools = finalTurn ? {} : prepared.tools;

		const systemMessage = adapter.getSystemMessage();
		if (!systemMessage) {
			return stop({kind: 'no-system-message'});
		}

		const maxMessages = getAppConfig().sessions?.maxMessages ?? 1000;
		const finalTurnNotice: Message[] = finalTurn
			? [{role: 'user', content: FINAL_TURN_INSTRUCTION}]
			: [];

		const sink = adapter.beginModelCall(context);
		let result: LLMChatResponse;
		try {
			result = await client.chat(
				[
					systemMessage,
					...capMessagesForModel(history.get(), maxMessages),
					...finalTurnNotice,
				],
				tools,
				sink.callbacks,
				signal,
				prepared.modeOverrides,
			);
		} catch (error) {
			modelCalls++;
			sink.end?.();
			return stop(
				signal.aborted ? {kind: 'aborted'} : {kind: 'model-error', error},
			);
		}
		modelCalls++;
		await adapter.onModelResponse?.(result);
		sink.end?.();

		if (!result || !result.choices || result.choices.length === 0) {
			return stop({kind: 'no-response'});
		}

		const message = result.choices[0].message;
		const fullContent = message.content || '';
		const parsed =
			result.toolsDisabled && !finalTurn
				? parseToolCalls(fullContent)
				: {
						success: true as const,
						toolCalls: [],
						cleanedContent: fullContent,
					};

		if (!parsed.success) {
			const verdict = guards.malformed();
			if (verdict.action === 'stop') {
				return stop({
					kind: 'guard-stop',
					guard: 'malformed',
					message: verdict.message,
					unrunToolCalls: [],
				});
			}
			adapter.onMalformedRetry?.({
				error: parsed.error,
				attempt: verdict.attempt,
			});
			append(
				{role: 'assistant', content: fullContent},
				{
					role: 'user',
					content: malformedToolCallNudge(parsed.error, parsed.examples),
				},
			);
			continue;
		}

		const allToolCalls: ToolCall[] = [
			...(message.tool_calls || []),
			...parsed.toolCalls,
		];
		const content = parsed.cleanedContent;

		const partition = adapter.partitionToolCalls(allToolCalls, prepared);
		const {validToolCalls, errorResults} = partition;
		if (partition.rejectedToolCalls.length > 0) {
			adapter.onRejectedToolCalls?.(partition);
		}
		const {emittedToolCalls, resultsForAbandonedTurn} =
			buildAbandonedTurnMessages(partition);

		// A fully-empty assistant message (no text, no tool calls) is left out:
		// providers reject one, and the empty-turn nudge below re-asks without it.
		if (content.trim() || emittedToolCalls.length > 0) {
			append({
				role: 'assistant',
				content,
				tool_calls: emittedToolCalls.length > 0 ? emittedToolCalls : undefined,
				reasoning: sink.reasoning(),
			});
		}

		// Gate on the same view the next turn will send, so the threshold is not
		// measured against rows the cap already drops from the request.
		const compactGateInput = capMessagesForModel(history.get(), maxMessages);
		const compacted = await maybeAutoCompact(
			compactGateInput,
			systemMessage,
			client,
			result.toolsDisabled ? undefined : tools,
			{...adapter.compactOptions, signal},
		);
		// Only adopt the result when compaction actually ran — otherwise
		// maybeAutoCompact returns the capped view it was handed, and taking it
		// would discard history the cap only meant to hide from one request.
		if (compacted !== compactGateInput) {
			history.set(compacted);
		}
		if (signal.aborted) {
			return stop({kind: 'aborted'});
		}

		if (errorResults.length > 0) {
			// Turns with a rejected call (an unknown tool, or arguments that could
			// not be parsed) count toward the repeated-call streak, so a model
			// stuck on a bad call trips the same cap instead of draining tokens
			// until maxTurns. The signature covers every call the model emitted.
			const repeated = guards.toolCalls(allToolCalls);
			append(...resultsForAbandonedTurn);
			if (repeated) {
				return stop({
					kind: 'guard-stop',
					guard: 'repeated-tool-calls',
					message: repeated,
					unrunToolCalls: [],
				});
			}
			continue;
		}

		if (validToolCalls.length === 0) {
			if (!content.trim()) {
				const verdict = guards.empty();
				if (verdict.action === 'stop') {
					return stop({
						kind: 'guard-stop',
						guard: 'empty',
						message: verdict.message,
						unrunToolCalls: [],
					});
				}
				adapter.onEmptyRetry?.(verdict.attempt);
				append({role: 'user', content: EMPTY_TURN_NUDGE});
				continue;
			}

			// A turn cut off at the output-token limit is a fragment, not an
			// answer, but it arrives with no tool calls, which is exactly what a
			// finished turn looks like. Ask the model to carry on (its truncated
			// prose is already in history), capped so a model that truncates
			// every time cannot spin to maxTurns. Skipped on the final turn:
			// there is no turn left to continue into, so the fragment stands.
			if (result.finishReason === 'length' && !finalTurn) {
				const verdict = guards.truncated();
				if (verdict.action === 'retry') {
					adapter.onTruncatedRetry?.(verdict.attempt);
					append({role: 'user', content: TRUNCATED_TURN_INSTRUCTION});
					continue;
				}
				adapter.onTruncatedGiveUp?.(verdict.message);
			}

			const decision = (await adapter.onFinalAnswer?.({
				...context,
				content,
				prepared,
			})) ?? {kind: 'finish'};
			if (decision.kind === 'continue') {
				append(...decision.messages);
				continue;
			}
			return stop({kind: 'completed'});
		}

		// Loop detection, checked before anything runs: the repeat that hits
		// the cap is not executed. Keyed on every emitted call, matching the
		// rejected-call branch above, so a turn mixing a valid call with an
		// unknown one does not break the streak.
		const repeated = guards.toolCalls(allToolCalls);
		if (repeated) {
			return stop({
				kind: 'guard-stop',
				guard: 'repeated-tool-calls',
				message: repeated,
				unrunToolCalls: validToolCalls,
			});
		}

		const execution = await adapter.executeTools(validToolCalls, context);
		if (execution.kind === 'stop') {
			if (execution.results?.length) {
				append(...execution.results);
			}
			return stop({kind: 'adapter-stop', payload: execution.payload});
		}
		append(...execution.results);

		// End the run here when cancelled: without this the loop would issue
		// another model request before the top-of-turn check runs.
		if (signal.aborted) {
			return stop({kind: 'aborted'});
		}
	}

	return stop({kind: 'max-turns', maxTurns});
}
