import {jsonSchema, tool} from 'ai';
import {appendToolDefinitionsToPrompt} from '@/ai-sdk-client/tools/system-prompt-assembler';
import {parseToolCalls, stripThinkTags} from '@/tool-calling/index';
import type {AISDKCoreTool, LLMClient, Message, ToolCall} from '@/types/core';
import type {ReviewActivityStore} from './review-activity';
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

export interface ReviewAgentOutcome {
	status: ReviewAgentStatus;
	output: string;
	error?: string;
	/** A model output limit made this run partial, even if the text parses. */
	incompleteReason?: string;
	turns: number;
	toolCalls: number;
	/** Paths passed to tools that read file content or diffs. */
	inspectedPaths: Set<string>;
	/** Paths whose entire diff or file content reached the model without clipping. */
	fullyInspectedPaths: Set<string>;
}

const MAX_TOOL_RESULT_CHARS = 12_000;
const MAX_MALFORMED_RETRIES = 2;

const BUDGET_EXHAUSTED_PROMPT =
	'Your tool budget for this review is exhausted. Do not call any more tools. Report now in the required output format, using only what you have already verified.';

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

function clipResult(result: string): string {
	return result.length > MAX_TOOL_RESULT_CHARS
		? `${result.slice(0, MAX_TOOL_RESULT_CHARS)}\n[output truncated]`
		: result;
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
	return (
		signal?.aborted === true ||
		error instanceof ReviewCancelledError ||
		(error instanceof Error && error.name === 'AbortError')
	);
}

/**
 * Run one review agent: a bounded model/tool loop over read-only snapshot
 * tools. The budget is enforced here, not requested from the model; when it
 * runs out the agent gets one tool-free turn to report and the outcome is
 * marked `budget-exhausted` so callers can label the review incomplete.
 */
export async function runReviewAgent(
	run: ReviewAgentRun,
): Promise<ReviewAgentOutcome> {
	const {activity, signal, toolMode} = run;
	const toolsByName = new Map(run.tools.map(entry => [entry.name, entry]));
	const sdkTools = toSdkTools(run.tools);
	const systemPrompt = appendToolDefinitionsToPrompt(
		run.systemPrompt,
		toolMode.disabled,
		toolMode.format,
		sdkTools,
	);
	const messages: Message[] = [
		{role: 'system', content: systemPrompt},
		{role: 'user', content: run.userPrompt},
	];
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
	let malformedRetries = 0;
	let incompleteReason: string | undefined;

	const callModel = async (
		purpose: string,
		withTools: boolean,
	): Promise<{
		content: string;
		calls: ToolCall[];
		asText: boolean;
		malformed?: string;
	}> => {
		if (signal?.aborted) throw new ReviewCancelledError();
		turns++;
		const apiSpan = activity.begin({
			source: 'api',
			name: 'model',
			summary: `${run.name}: ${purpose}`,
			parentId: span.id,
		});
		try {
			const response = await run.client.chat(
				messages,
				withTools && !toolMode.disabled ? sdkTools : {},
				{},
				signal,
			);
			if (signal?.aborted) throw new ReviewCancelledError();
			if (response.finishReason === 'length') {
				incompleteReason = `${run.name} output was cut off at the model output limit`;
			}
			const message = response.choices[0]?.message;
			const rawContent = stripThinkTags(message?.content ?? '').trim();
			const usage = response.usage?.totalTokens;
			apiSpan.complete(
				usage === undefined
					? `${run.name}: response received`
					: `${run.name}: response received (${usage} tokens)`,
			);
			if (!withTools) return {content: rawContent, calls: [], asText: false};
			const native = message?.tool_calls ?? [];
			if (native.length > 0) {
				return {content: rawContent, calls: native, asText: false};
			}
			const parsed = parseToolCalls(rawContent);
			if (!parsed.success) {
				return {
					content: rawContent,
					calls: [],
					asText: true,
					malformed: parsed.error,
				};
			}
			if (!toolMode.disabled) {
				// Native-tool models sometimes regress to writing calls as text.
				// Only accept that when every call names a review tool, so code
				// quoted in a report (JSX, XML) is not mistaken for a call.
				const recovered =
					parsed.success &&
					parsed.toolCalls.length > 0 &&
					parsed.toolCalls.every(call => toolsByName.has(call.function.name));
				return recovered
					? {
							content: parsed.cleanedContent.trim(),
							calls: parsed.toolCalls,
							asText: true,
						}
					: {content: rawContent, calls: [], asText: false};
			}
			return {
				content: parsed.cleanedContent.trim(),
				calls: parsed.toolCalls,
				asText: true,
			};
		} catch (error) {
			if (isAbort(error, signal)) {
				apiSpan.cancel('Cancelled by user');
				throw new ReviewCancelledError();
			}
			apiSpan.fail(error, `${run.name}: model call failed`);
			throw error;
		}
	};

	const finish = (
		status: ReviewAgentStatus,
		output: string,
		error?: string,
	): ReviewAgentOutcome => {
		const counts = `${turns} model call${turns === 1 ? '' : 's'}, ${toolCalls} tool call${toolCalls === 1 ? '' : 's'}`;
		if (status === 'completed') span.complete(`Finished (${counts})`);
		else if (status === 'budget-exhausted')
			span.complete(`Stopped at its budget (${counts})`);
		else if (status === 'cancelled') span.cancel('Cancelled by user');
		else span.fail(error ?? 'failed', `Failed (${counts})`);
		return {
			status,
			output,
			...(error ? {error} : {}),
			...(incompleteReason ? {incompleteReason} : {}),
			turns,
			toolCalls,
			inspectedPaths,
			fullyInspectedPaths,
		};
	};

	const reportWithoutTools = async (): Promise<ReviewAgentOutcome> => {
		messages.push({role: 'user', content: BUDGET_EXHAUSTED_PROMPT});
		const final = await callModel('final report after budget', false);
		return finish('budget-exhausted', final.content);
	};

	try {
		while (true) {
			if (turns >= run.budget.maxTurns) return await reportWithoutTools();
			const response = await callModel(`turn ${turns + 1}`, true);

			if (response.malformed) {
				if (malformedRetries >= MAX_MALFORMED_RETRIES) {
					return finish(
						'failed',
						response.content,
						`Malformed tool calls: ${response.malformed}`,
					);
				}
				malformedRetries++;
				messages.push(
					{role: 'assistant', content: response.content},
					{
						role: 'user',
						content: `Your previous response contained a malformed tool call: ${response.malformed}. Use the documented format or answer without tools.`,
					},
				);
				continue;
			}

			if (response.calls.length === 0) {
				return finish('completed', response.content);
			}

			const results: Array<{call: ToolCall; content: string}> = [];
			let budgetHit = false;
			for (const call of response.calls) {
				if (signal?.aborted) throw new ReviewCancelledError();
				if (budgetHit || toolCalls >= run.budget.maxToolCalls) {
					budgetHit = true;
					results.push({
						call,
						content: 'Error: tool budget exhausted; this call was not run.',
					});
					continue;
				}
				toolCalls++;
				results.push({call, content: await runTool(call)});
			}

			if (response.asText) {
				messages.push(
					{role: 'assistant', content: response.content},
					{
						role: 'user',
						content: results
							.map(
								({call, content}) =>
									`Result of ${call.function.name}:\n${content}`,
							)
							.join('\n\n'),
					},
				);
			} else {
				messages.push({
					role: 'assistant',
					content: response.content,
					tool_calls: response.calls,
				});
				for (const {call, content} of results) {
					messages.push({
						role: 'tool',
						content,
						tool_call_id: call.id,
						name: call.function.name,
					});
				}
			}

			if (budgetHit || toolCalls >= run.budget.maxToolCalls) {
				return await reportWithoutTools();
			}
		}
	} catch (error) {
		if (isAbort(error, signal)) return finish('cancelled', '');
		const message = error instanceof Error ? error.message : String(error);
		return finish('failed', '', message);
	}

	async function runTool(call: ToolCall): Promise<string> {
		const entry = toolsByName.get(call.function.name);
		const args = toolArguments(call);
		if (!entry) {
			const unknown = activity.begin({
				source: 'tool',
				name: call.function.name,
				summary: `Unknown tool requested by ${run.name}`,
				parentId: span.id,
			});
			unknown.fail('Not a review tool');
			return `Error: ${call.function.name} is not available. Use only: ${[...toolsByName.keys()].join(', ')}.`;
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
			const inspected = description.path
				? normalizeCitationPath(description.path.replace(/\/+$/, ''))
				: null;
			if (inspected && !result.startsWith('Error:')) {
				inspectedPaths.add(inspected);
				if (
					result.length <= MAX_TOOL_RESULT_CHARS &&
					entry.coversWholeFile?.(args, result)
				) {
					fullyInspectedPaths.add(inspected);
				}
			}
			if (result.startsWith('Error:')) toolSpan.fail(result.slice(7).trim());
			else toolSpan.complete(description.summary);
			return clipResult(result);
		} catch (error) {
			if (isAbort(error, signal)) {
				toolSpan.cancel('Cancelled by user');
				throw new ReviewCancelledError();
			}
			toolSpan.fail(error);
			return `Error: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
}
