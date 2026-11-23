import {jsonSchema, tool} from 'ai';
import {
	NO_RESPONSE_MESSAGE,
	runTurnEngine,
	type TurnEngineAdapter,
	type TurnEnginePolicy,
	type TurnEngineResult,
} from '@/agent-loop/turn-engine';
import {appendToolDefinitionsToPrompt} from '@/ai-sdk-client/tools/system-prompt-assembler';
import {getRetryLimits} from '@/config/index';
import {invalidArgumentsResult} from '@/hooks/chat-handler/utils/tool-filters';
import type {
	AISDKCoreTool,
	LLMClient,
	Message,
	ToolCall,
	ToolResult,
} from '@/types/core';
import type {ReviewActivitySpan, ReviewActivityStore} from './review-activity';
import type {ReviewAgentTool} from './review-context';
import {normalizeCitationPath} from './review-findings';
import {ReviewCancelledError} from './review-tools';

export interface ReviewAgentBudget {
	/** Model calls allowed while tools are available (a final report turn is extra). */
	maxTurns: number;
	/** Tool executions allowed across the whole run. */
	maxToolCalls: number;
}

export interface ReviewToolMode {
	/** True when the provider cannot take native tools; calls are parsed from text. */
	disabled: boolean;
	format: 'xml' | 'json';
}

export interface ReviewAgentRun {
	client: LLMClient;
	name: string;
	summary: string;
	systemPrompt: string;
	userPrompt: string;
	tools: ReviewAgentTool[];
	budget: ReviewAgentBudget;
	toolMode: ReviewToolMode;
	activity: ReviewActivityStore;
	parentId?: string;
	signal?: AbortSignal;
}

export type ReviewAgentStatus =
	| 'completed'
	| 'budget-exhausted'
	| 'failed'
	| 'cancelled';

export type ReviewBudgetReason = 'turns' | 'tool-calls' | 'context';

export interface ReviewAgentOutcome {
	status: ReviewAgentStatus;
	/** Which budget stopped the run when `status === 'budget-exhausted'`. */
	budgetReason?: ReviewBudgetReason;
	output: string;
	error?: string;
	/** A model output or context limit made this run partial, even if the text parses. */
	incompleteReason?: string;
	turns: number;
	toolCalls: number;
	/** Paths passed to tools that read file content or diffs. */
	inspectedPaths: Set<string>;
	/** Paths whose entire diff or file content reached the model without clipping. */
	fullyInspectedPaths: Set<string>;
}

const MAX_TOOL_RESULT_CHARS = 12_000;
const MIN_CONTEXT_TOOL_CHARS = 400;
// Conservative budget (~80% of context at 3 chars/token) so tool schemas,
// message framing, and the final report turn still fit on smaller windows.
const CONTEXT_CHARS_PER_TOKEN = 2.4;

const BUDGET_EXHAUSTED_PROMPT =
	'Your tool budget for this review is exhausted. Do not call any more tools. Report now in the required output format, using only what you have already verified.';

const CONTEXT_BUDGET_EXHAUSTED_PROMPT =
	'The model context budget for this review is nearly full. Do not call any more tools. Report now in the required output format, using only what you have already verified.';

type ReviewStopReason = 'tool-budget' | 'context-budget' | 'cancelled';

function toSdkTools(tools: ReviewAgentTool[]): Record<string, AISDKCoreTool> {
	const sdkTools: Record<string, AISDKCoreTool> = {};
	for (const reviewTool of tools) {
		sdkTools[reviewTool.name] = tool({
			description: reviewTool.description,
			inputSchema: jsonSchema(reviewTool.parameters),
		});
	}
	return sdkTools;
}

function toolArguments(call: ToolCall): Record<string, unknown> {
	const raw: unknown = call.function.arguments;
	if (typeof raw === 'string') {
		try {
			const parsed: unknown = JSON.parse(raw);
			return parsed && typeof parsed === 'object'
				? (parsed as Record<string, unknown>)
				: {};
		} catch {
			return {};
		}
	}
	return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

function clipResult(result: string, maxChars: number): string {
	return result.length > maxChars
		? `${result.slice(0, maxChars)}\n[output truncated]`
		: result;
}

function estimateHistoryChars(
	systemPrompt: string,
	messages: Message[],
	pending: ToolResult[],
): number {
	let total = systemPrompt.length;
	for (const message of messages) {
		total += message.content?.length ?? 0;
		if (message.tool_calls && message.tool_calls.length > 0) {
			total += JSON.stringify(message.tool_calls).length;
		}
	}
	for (const result of pending) {
		total += result.content.length;
	}
	return total;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
	return (
		signal?.aborted === true ||
		error instanceof ReviewCancelledError ||
		(error instanceof Error && error.name === 'AbortError')
	);
}

/**
 * Run one review agent on the shared turn engine with read-only snapshot
 * tools. Turn, tool-call, and context budgets are enforced here rather than
 * requested from the model; when a budget runs out the agent gets one
 * tool-free turn to report and the outcome is marked `budget-exhausted` so
 * callers can label the review incomplete.
 */
export async function runReviewAgent(
	run: ReviewAgentRun,
): Promise<ReviewAgentOutcome> {
	const {activity, toolMode} = run;
	const signal = run.signal ?? new AbortController().signal;
	const toolsByName = new Map(run.tools.map(entry => [entry.name, entry]));
	const availableNames = [...toolsByName.keys()];
	const sdkTools = toSdkTools(run.tools);
	const systemPrompt = appendToolDefinitionsToPrompt(
		run.systemPrompt,
		toolMode.disabled,
		toolMode.format,
		sdkTools,
	);
	const systemMessage: Message = {role: 'system', content: systemPrompt};
	let history: Message[] = [{role: 'user', content: run.userPrompt}];
	const contextTokens = run.client.getContextSize();
	const maxContextChars =
		contextTokens > 0
			? Math.floor(contextTokens * CONTEXT_CHARS_PER_TOKEN)
			: Number.POSITIVE_INFINITY;
	const inspectedPaths = new Set<string>();
	const fullyInspectedPaths = new Set<string>();
	const span = activity.begin({
		source: 'agent',
		name: run.name,
		summary: run.summary,
		...(run.parentId ? {parentId: run.parentId} : {}),
	});
	let turns = 0;
	let toolCalls = 0;
	let incompleteReason: string | undefined;
	let activeApiSpan: ReviewActivitySpan | null = null;
	let lastOutput = '';
	let finalOutput = '';
	let hitTurnBudget = false;
	let toolCancelled = false;

	const finish = (
		status: ReviewAgentStatus,
		output: string,
		error?: string,
		budgetReason?: ReviewBudgetReason,
	): ReviewAgentOutcome => {
		const counts = `${turns} model call${turns === 1 ? '' : 's'}, ${toolCalls} tool call${toolCalls === 1 ? '' : 's'}`;
		if (status === 'completed') span.complete(`Finished (${counts})`);
		else if (status === 'budget-exhausted')
			span.complete(`Stopped at its budget (${counts})`);
		else if (status === 'cancelled') span.cancel('Cancelled by user');
		else span.fail(error ?? 'failed', `Failed (${counts})`);
		return {
			status,
			...(budgetReason ? {budgetReason} : {}),
			output,
			...(error ? {error} : {}),
			...(incompleteReason ? {incompleteReason} : {}),
			turns,
			toolCalls,
			inspectedPaths,
			fullyInspectedPaths,
		};
	};

	const settleApiSpanOnFailure = (
		engineResult: TurnEngineResult<ReviewStopReason>,
	): ReviewAgentOutcome | null => {
		if (
			engineResult.kind === 'aborted' ||
			(engineResult.kind === 'model-error' &&
				isAbort(engineResult.error, signal))
		) {
			activeApiSpan?.cancel('Cancelled by user');
			activeApiSpan = null;
			return finish('cancelled', '');
		}
		if (engineResult.kind === 'model-error') {
			activeApiSpan?.fail(engineResult.error, `${run.name}: model call failed`);
			activeApiSpan = null;
			return finish('failed', '', errorMessage(engineResult.error));
		}
		if (engineResult.kind === 'no-response') {
			return finish('failed', '', NO_RESPONSE_MESSAGE);
		}
		if (engineResult.kind === 'no-system-message') {
			return finish('failed', '', 'Missing review system prompt');
		}
		if (engineResult.kind === 'guard-stop') {
			return finish('failed', lastOutput, engineResult.message);
		}
		return null;
	};

	async function runTool(
		call: ToolCall,
		maxResultChars: number,
	): Promise<string> {
		const entry = toolsByName.get(call.function.name);
		const args = toolArguments(call);
		if (!entry) {
			return `Error: ${call.function.name} is not available. Use only: ${availableNames.join(', ')}.`;
		}
		const description = entry.describe(args);
		const toolSpan = activity.begin({
			source: 'tool',
			name: entry.name,
			summary: description.summary,
			args: description.args,
			parentId: span.id,
		});
		try {
			const result = await entry.run(args, signal);
			const clippedByContext =
				result.length > maxResultChars &&
				maxResultChars < MAX_TOOL_RESULT_CHARS;
			if (clippedByContext) {
				incompleteReason ??= `${run.name} truncated tool output to stay within the model context limit`;
			}
			const inspected = description.path
				? normalizeCitationPath(description.path.replace(/\/+$/, ''))
				: null;
			if (inspected && !result.startsWith('Error:')) {
				inspectedPaths.add(inspected);
				if (
					result.length <= maxResultChars &&
					entry.coversWholeFile?.(args, result)
				) {
					fullyInspectedPaths.add(inspected);
				}
			}
			if (result.startsWith('Error:')) toolSpan.fail(result.slice(7).trim());
			else toolSpan.complete(description.summary);
			return clipResult(result, maxResultChars);
		} catch (error) {
			if (isAbort(error, signal)) {
				toolCancelled = true;
				toolSpan.cancel('Cancelled by user');
				return '';
			}
			toolSpan.fail(error);
			return `Error: ${errorMessage(error)}`;
		}
	}

	const adapter: TurnEngineAdapter<ReviewStopReason> = {
		history: {
			get: () => history,
			set: messages => {
				history = messages;
			},
		},
		getSystemMessage: () => systemMessage,
		prepareTurn: ({finalTurn}) => ({
			tools: finalTurn || toolMode.disabled ? {} : sdkTools,
			availableNames: finalTurn ? [] : availableNames,
			...(toolMode.disabled
				? {
						modeOverrides: {
							nonInteractiveMode: true,
							nonInteractiveAlwaysAllow: [],
							nativeToolsDisabled: true,
						},
					}
				: {}),
		}),
		beginModelCall: ({finalTurn}) => {
			turns++;
			const purpose = finalTurn ? 'final report after budget' : `turn ${turns}`;
			activeApiSpan = activity.begin({
				source: 'api',
				name: 'model',
				summary: `${run.name}: ${purpose}`,
				parentId: span.id,
			});
			return {
				callbacks: {},
				reasoning: () => undefined,
			};
		},
		onModelResponse: response => {
			if (signal.aborted) {
				activeApiSpan?.cancel('Cancelled by user');
				activeApiSpan = null;
				return;
			}
			if (response.finishReason === 'length') {
				incompleteReason = `${run.name} output was cut off at the model output limit`;
			}
			const usage = response.usage?.totalTokens;
			activeApiSpan?.complete(
				usage === undefined
					? `${run.name}: response received`
					: `${run.name}: response received (${usage} tokens)`,
			);
			activeApiSpan = null;
		},
		onAssistantTurn: ({content}) => {
			lastOutput = content.trim();
		},
		partitionToolCalls: calls => {
			const validToolCalls: ToolCall[] = [];
			const rejectedToolCalls: ToolCall[] = [];
			const errorResults: ToolResult[] = [];
			for (const call of calls) {
				if (!call.id || !call.function?.name?.trim()) continue;
				if (!toolsByName.has(call.function.name)) {
					rejectedToolCalls.push(call);
					errorResults.push({
						tool_call_id: call.id,
						role: 'tool',
						name: call.function.name,
						content: `Error: ${call.function.name} is not available. Use only: ${availableNames.join(', ')}.`,
						isError: true,
					});
					continue;
				}
				if (call.argumentsError !== undefined) {
					rejectedToolCalls.push(call);
					errorResults.push(invalidArgumentsResult(call));
					continue;
				}
				validToolCalls.push(call);
			}
			return {validToolCalls, rejectedToolCalls, errorResults};
		},
		onRejectedToolCalls: ({rejectedToolCalls}) => {
			for (const call of rejectedToolCalls) {
				if (toolsByName.has(call.function.name)) continue;
				const unknown = activity.begin({
					source: 'tool',
					name: call.function.name,
					summary: `Unknown tool requested by ${run.name}`,
					parentId: span.id,
				});
				unknown.fail('Not a review tool');
			}
		},
		executeTools: async validToolCalls => {
			const results: ToolResult[] = [];
			let stopReason: 'tool-budget' | 'context-budget' | null = null;
			for (const call of validToolCalls) {
				if (signal.aborted) {
					return {kind: 'stop', payload: 'cancelled', results};
				}
				if (
					stopReason === 'tool-budget' ||
					toolCalls >= run.budget.maxToolCalls
				) {
					stopReason ??= 'tool-budget';
					results.push({
						tool_call_id: call.id,
						role: 'tool',
						name: call.function.name,
						content: 'Error: tool budget exhausted; this call was not run.',
						isError: true,
					});
					continue;
				}
				const remainingContext =
					maxContextChars -
					estimateHistoryChars(systemPrompt, history, results);
				if (
					stopReason === 'context-budget' ||
					remainingContext < MIN_CONTEXT_TOOL_CHARS
				) {
					stopReason = 'context-budget';
					results.push({
						tool_call_id: call.id,
						role: 'tool',
						name: call.function.name,
						content:
							'Error: model context budget exhausted; this call was not run.',
						isError: true,
					});
					continue;
				}
				const maxResultChars = Math.min(
					MAX_TOOL_RESULT_CHARS,
					remainingContext,
				);
				toolCalls++;
				const content = await runTool(call, maxResultChars);
				if (signal.aborted || toolCancelled) {
					return {kind: 'stop', payload: 'cancelled', results};
				}
				results.push({
					tool_call_id: call.id,
					role: 'tool',
					name: call.function.name,
					content,
				});
			}
			if (stopReason) {
				return {kind: 'stop', payload: stopReason, results};
			}
			if (toolCalls >= run.budget.maxToolCalls) {
				return {kind: 'stop', payload: 'tool-budget', results};
			}
			const remainingAfterBatch =
				maxContextChars - estimateHistoryChars(systemPrompt, history, results);
			if (remainingAfterBatch < MIN_CONTEXT_TOOL_CHARS) {
				return {kind: 'stop', payload: 'context-budget', results};
			}
			return {kind: 'continue', results};
		},
		onFinalAnswer: ({content, finalTurn}) => {
			finalOutput = content.trim();
			if (finalTurn) hitTurnBudget = true;
			return {kind: 'finish'};
		},
	};

	const basePolicy: TurnEnginePolicy = {
		textToolCalls: 'whenever-no-native',
		stripThinkTags: true,
		truncatedTurnGuard: false,
		onlyOfferedTextToolCalls: true,
		textToolHistory: 'text',
		autoCompact: false,
		capHistory: false,
		finalTurnInstruction: BUDGET_EXHAUSTED_PROMPT,
	};

	const retryLimits = getRetryLimits();
	const primary = await runTurnEngine({
		client: run.client,
		signal,
		maxTurns: Math.max(1, run.budget.maxTurns + 1),
		retryLimits,
		adapter,
		policy: basePolicy,
	});

	const failed = settleApiSpanOnFailure(primary);
	if (failed) return failed;

	if (primary.kind === 'completed') {
		return hitTurnBudget
			? finish('budget-exhausted', finalOutput, undefined, 'turns')
			: finish('completed', finalOutput);
	}
	if (primary.kind === 'max-turns') {
		return finish('budget-exhausted', finalOutput, undefined, 'turns');
	}
	if (primary.kind === 'adapter-stop') {
		if (primary.payload === 'cancelled') {
			return finish('cancelled', '');
		}
		const budgetReason: ReviewBudgetReason =
			primary.payload === 'context-budget' ? 'context' : 'tool-calls';
		if (budgetReason === 'context') {
			incompleteReason ??= `${run.name} reached the model context limit before finishing`;
		}
		const finalTurn = await runTurnEngine({
			client: run.client,
			signal,
			maxTurns: 1,
			retryLimits,
			adapter,
			policy: {
				...basePolicy,
				finalTurnInstruction:
					budgetReason === 'context'
						? CONTEXT_BUDGET_EXHAUSTED_PROMPT
						: BUDGET_EXHAUSTED_PROMPT,
			},
		});
		const finalFailed = settleApiSpanOnFailure(finalTurn);
		if (finalFailed) return finalFailed;
		return finish('budget-exhausted', finalOutput, undefined, budgetReason);
	}

	return finish('failed', lastOutput, 'Review agent stopped unexpectedly');
}
