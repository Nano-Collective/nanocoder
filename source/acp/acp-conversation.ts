import type {
	AgentSideConnection,
	PromptResponse,
	ToolCallStatus,
} from '@agentclientprotocol/sdk';
import {requestToolPermission} from '@/acp/acp-permission';
import {requestUserChoice} from '@/acp/acp-question';
import type {AcpSession} from '@/acp/acp-session';
import {type AcpToolCallMeta, buildToolCallMeta} from '@/acp/acp-tool-call';
import {DEFAULT_HEADLESS_MAX_TURNS, getAppConfig} from '@/config/index';
import {processToolUse} from '@/message-handler';
import {
	getAllSubagentProgress,
	type SubagentEvent,
} from '@/services/subagent-events';
import {parseToolCalls} from '@/tool-calling/index';
import {resolveToolApproval} from '@/tools/approval-policy';
import type {ToolManager} from '@/tools/tool-manager';
import type {
	ApiUsage,
	DevelopmentMode,
	LLMClient,
	Message,
	ModeOverrides,
	StreamCallbacks,
	ToolCall,
	ToolResult,
} from '@/types/core';
import {buildResponseUsage} from '@/usage/response-usage';
import {capMessagesForModel} from '@/utils/message-capping';
import {toOptionString} from '@/utils/type-helpers';

// On the last allowed turn we strip tools and inject this so the model
// finalizes cleanly instead of stopping mid-task at the turn ceiling.
const FINAL_TURN_INSTRUCTION =
	'You have reached the maximum number of tool-execution turns for this run. ' +
	'Do not call any more tools. Produce your final answer now using only the ' +
	'information you already have.';

export interface RunAcpConversationOptions {
	session: AcpSession;
	client: LLMClient;
	toolManager: ToolManager;
	conn: AgentSideConnection;
	nonInteractiveAlwaysAllow: string[];
}

export async function runAcpConversation(
	options: RunAcpConversationOptions,
): Promise<PromptResponse> {
	const {session, client, toolManager, conn, nonInteractiveAlwaysAllow} =
		options;
	const {developmentMode, abortController} = session;

	let messages = session.messages;

	// Provider-reported usage accumulated across this prompt's model calls,
	// returned on the PromptResponse (experimental ACP `usage` field) so
	// clients like the VS Code extension can show a per-response indicator.
	// Fields stay undefined until a finite value arrives: zero-filling
	// unreported input/output would route a total-only report into the
	// input/output cost branch of buildResponseUsage and price it at $0.
	const turnUsage: ApiUsage = {};

	const recordUsage = (usage: ApiUsage | undefined) => {
		if (!usage) return;
		if (Number.isFinite(usage.inputTokens)) {
			turnUsage.inputTokens =
				(turnUsage.inputTokens ?? 0) + (usage.inputTokens as number);
		}
		if (Number.isFinite(usage.outputTokens)) {
			turnUsage.outputTokens =
				(turnUsage.outputTokens ?? 0) + (usage.outputTokens as number);
		}
		// Keep the running total consistent when a call reports only
		// input/output: add their sum so mixed-report turns don't understate.
		const total = Number.isFinite(usage.totalTokens)
			? (usage.totalTokens as number)
			: Number.isFinite(usage.inputTokens) ||
					Number.isFinite(usage.outputTokens)
				? ((usage.inputTokens as number) || 0) +
					((usage.outputTokens as number) || 0)
				: undefined;
		if (total !== undefined) {
			turnUsage.totalTokens = (turnUsage.totalTokens ?? 0) + total;
		}
	};

	// Attach accumulated usage (and best-effort estimated cost via _meta) to
	// a turn-ending response. A no-op when no model call reported usage.
	const withTurnUsage = async (
		response: PromptResponse,
	): Promise<PromptResponse> => {
		const usageReported =
			turnUsage.inputTokens !== undefined ||
			turnUsage.outputTokens !== undefined ||
			turnUsage.totalTokens !== undefined;
		if (!usageReported) return response;
		// Cost is computed from the sparse accumulators so a total-only turn
		// takes the lump-sum averaging branch instead of pricing 0+0 tokens.
		const priced = await buildResponseUsage(
			turnUsage,
			client.getCurrentModel(),
		);
		const input = turnUsage.inputTokens ?? 0;
		const output = turnUsage.outputTokens ?? 0;
		return {
			...response,
			// The ACP Usage type requires all three fields, so unreported ones
			// are zero-filled here — on the wire only, after cost is computed.
			usage: {
				inputTokens: input,
				outputTokens: output,
				totalTokens: turnUsage.totalTokens ?? input + output,
			},
			...(priced?.cost != null
				? {_meta: {'nanocoder/usage': {cost: priced.cost}}}
				: {}),
		};
	};

	const maxTurns =
		getAppConfig().headless?.maxTurns ?? DEFAULT_HEADLESS_MAX_TURNS;

	for (let turn = 0; turn < maxTurns; turn++) {
		if (abortController.signal.aborted) {
			session.messages = messages;
			return withTurnUsage({stopReason: 'cancelled'});
		}

		// On the final turn, force a tool-free wrap-up so we end with an answer
		// rather than stopping mid-task at the ceiling.
		const finalTurn = turn === maxTurns - 1;

		const availableNames = toolManager.getAvailableToolNames(
			undefined,
			developmentMode,
		);
		const tools = finalTurn ? {} : toolManager.getFilteredTools(availableNames);

		const modeOverrides: ModeOverrides = {
			nonInteractiveMode: true,
			nonInteractiveAlwaysAllow,
		};

		let streamedReasoning = '';

		const callbacks: StreamCallbacks = {
			onReasoningToken: (token: string) => {
				streamedReasoning += token;
				conn.sessionUpdate({
					sessionId: session.sessionId,
					update: {
						sessionUpdate: 'agent_thought_chunk',
						content: {type: 'text', text: token},
					},
				});
			},
			onToken: (token: string) => {
				conn.sessionUpdate({
					sessionId: session.sessionId,
					update: {
						sessionUpdate: 'agent_message_chunk',
						content: {type: 'text', text: token},
					},
				});
			},
		};

		const systemMessage = session.systemMessage;
		if (!systemMessage) {
			return withTurnUsage({stopReason: 'end_turn'});
		}

		const sessionConfig = getAppConfig().sessions;
		const maxMessages = sessionConfig?.maxMessages ?? 1000;
		const cappedMessages = capMessagesForModel(messages, maxMessages);

		const finalTurnNotice: Message[] = finalTurn
			? [{role: 'user', content: FINAL_TURN_INSTRUCTION}]
			: [];

		const result = await client.chat(
			[systemMessage, ...cappedMessages, ...finalTurnNotice],
			tools,
			callbacks,
			abortController.signal,
			modeOverrides,
		);

		recordUsage(result?.usage);

		if (!result || !result.choices || result.choices.length === 0) {
			return withTurnUsage({stopReason: 'end_turn'});
		}

		const message = result.choices[0].message;
		const nativeToolCalls = message.tool_calls || [];
		const fullContent = message.content || '';

		const xmlParse =
			result.toolsDisabled && !finalTurn
				? parseToolCalls(fullContent)
				: {success: true as const, toolCalls: [], cleanedContent: fullContent};

		if (!xmlParse.success) {
			return withTurnUsage({stopReason: 'end_turn'});
		}

		const allToolCalls: ToolCall[] = [
			...nativeToolCalls,
			...xmlParse.toolCalls,
		];
		const cleanedContent = xmlParse.cleanedContent;

		const validToolCalls: ToolCall[] = [];
		const errorResults: ToolResult[] = [];
		for (const toolCall of allToolCalls) {
			if (
				toolCall.function.name === '__xml_validation_error__' ||
				!toolManager.hasTool(toolCall.function.name)
			) {
				errorResults.push({
					tool_call_id: toolCall.id,
					role: 'tool',
					name: toolCall.function.name,
					content: `Unknown tool: ${toolCall.function.name}`,
				});
				continue;
			}
			validToolCalls.push(toolCall);
		}

		messages = [
			...messages,
			{
				role: 'assistant',
				content: cleanedContent,
				tool_calls: validToolCalls.length > 0 ? validToolCalls : undefined,
				reasoning: streamedReasoning || undefined,
			},
		];

		if (errorResults.length > 0) {
			messages = [...messages, ...errorResults];
			continue;
		}

		if (validToolCalls.length === 0) {
			session.messages = messages;
			return withTurnUsage({stopReason: 'end_turn'});
		}

		const announcedBatch =
			validToolCalls.length > 1 && !abortController.signal.aborted;
		if (announcedBatch) {
			for (const toolCall of validToolCalls) {
				// withDiff: false - the announcement drops content below, so
				// there is no reason to read the file to build a diff first.
				const queuedMeta = await buildToolCallMeta(toolCall, {
					withDiff: false,
				});
				// Content is withheld until the call is about to run: the client
				// enables its "open diff" affordance off this field, and a diff
				// registered now would be stale by the time the tool executes.
				await emitToolCall(session, conn, toolCall, 'pending', {
					...queuedMeta,
					content: [],
				});
			}
		}

		// Process tool calls
		const toolResults: ToolResult[] = [];
		for (let index = 0; index < validToolCalls.length; index++) {
			const toolCall = validToolCalls[index];
			// Stop was pressed: don't start any remaining queued tools. Record a
			// cancelled result for each so the assistant's tool_calls keep matched
			// results in history; the turn ends below instead of re-prompting.
			if (abortController.signal.aborted) {
				if (announcedBatch) {
					await emitToolCallUpdate(
						session,
						conn,
						toolCall,
						'failed',
						'Cancelled by user',
					);
				}
				toolResults.push({
					tool_call_id: toolCall.id,
					role: 'tool',
					name: toolCall.function.name,
					content: 'Error: cancelled by user',
				});
				continue;
			}

			// Enrich the call with ACP metadata (kind, file locations, and a diff
			// for edits) so the client can render rich tool cards and previews.
			const meta = await buildToolCallMeta(toolCall);

			// Notify client about tool call. Already-announced calls get an
			// update rather than a second tool_call: clients that append on
			// tool_call (instead of upserting by id) would double-render it.
			await emitToolCall(
				session,
				conn,
				toolCall,
				'pending',
				meta,
				announcedBatch ? 'tool_call_update' : 'tool_call',
			);

			// ask_user is interactive: instead of executing it, surface the
			// question's options through the client and feed the choice back as
			// the tool result. We reuse this call's id (just announced) so the
			// permission request targets a known tool call.
			if (toolCall.function.name === 'ask_user') {
				const answer = await handleAskUser(
					session,
					conn,
					toolCall,
					abortController.signal,
				);
				toolResults.push(answer);
				continue;
			}

			// Check if approval is needed. resolveToolApproval is the single
			// authority shared with the interactive loop and plain shell - it
			// applies yolo and the alwaysAllow list internally.
			const needsApproval = await evaluateNeedsApproval(
				toolCall,
				toolManager,
				nonInteractiveAlwaysAllow,
				developmentMode,
			);

			if (needsApproval) {
				const permission = await requestToolPermission(
					session,
					toolCall,
					conn,
					meta,
					abortController.signal,
				);

				if (permission === 'cancelled') {
					await emitToolCallUpdate(
						session,
						conn,
						toolCall,
						'failed',
						'Cancelled by user',
					);
					// This branch returns instead of falling through to the
					// aborted check at the top of the loop, so the calls
					// announced behind this one would stay pending forever.
					if (announcedBatch) {
						for (const queued of validToolCalls.slice(index + 1)) {
							await emitToolCallUpdate(
								session,
								conn,
								queued,
								'failed',
								'Cancelled by user',
							);
						}
					}
					session.messages = [...messages, ...toolResults];
					return withTurnUsage({stopReason: 'cancelled'});
				}

				if (permission === 'denied') {
					await emitToolCallUpdate(
						session,
						conn,
						toolCall,
						'failed',
						'Denied by user',
					);
					toolResults.push({
						tool_call_id: toolCall.id,
						role: 'tool',
						name: toolCall.function.name,
						content: 'Tool call denied by user',
					});
					continue;
				}
			}

			// Execute tool
			await emitToolCallUpdate(session, conn, toolCall, 'in_progress');

			let pollInterval: ReturnType<typeof setInterval> | null = null;
			let isPolling = true;
			if (toolCall.function.name === 'agent') {
				// Progress entries are never removed from the map, so snapshot the
				// keys that exist before this call starts and ignore them while
				// polling - otherwise a finished agent from an earlier turn wins the
				// max-token scan and the card shows stale numbers.
				const preexisting = new Set(getAllSubagentProgress().keys());
				pollInterval = setInterval(async () => {
					if (!isPolling) return;
					// agentId is a randomUUID() internal to the executor — not in args.
					// Poll agents started by this call and pick the most active one.
					let best: SubagentEvent | null = null;
					for (const [id, prog] of getAllSubagentProgress()) {
						if (preexisting.has(id)) continue;
						if (!best || prog.tokenCount > best.tokenCount) {
							best = prog;
						}
					}

					if (best) {
						const tokens = Math.floor(best.tokenCount / 1000);
						const lastTool =
							best.toolHistory.length > 0
								? best.toolHistory[best.toolHistory.length - 1]
								: '';

						let title = `${best.subagentName || 'agent'} • ${tokens}k tokens`;
						if (best.toolCallCount > 0) {
							title += ` • ${best.toolCallCount} tools${lastTool ? ` (${lastTool})` : ''}`;
						} else {
							title += ` • thinking...`;
						}

						if (!isPolling) return;
						await emitToolCallUpdate(
							session,
							conn,
							toolCall,
							'in_progress',
							undefined,
							title,
						);
					}
				}, 1500);
			}

			const toolResult = await processToolUse(toolCall, {
				abortSignal: abortController.signal,
			});
			isPolling = false;
			if (pollInterval) clearInterval(pollInterval);

			const status: ToolCallStatus = toolResult.content.startsWith('Error')
				? 'failed'
				: 'completed';
			await emitToolCallUpdate(
				session,
				conn,
				toolCall,
				status,
				toolResult.content,
			);
			toolResults.push(toolResult);

			// write_tasks replaces the whole task list; mirror it to the client
			// as an ACP plan update so GUIs can render a live checklist.
			if (toolCall.function.name === 'write_tasks' && status === 'completed') {
				await emitPlanUpdate(session, conn, toolCall);
			}
		}

		messages = [...messages, ...toolResults];

		// End the turn here when cancelled - without this the loop would issue
		// another LLM request before the top-of-turn abort check runs.
		if (abortController.signal.aborted) {
			session.messages = messages;
			return withTurnUsage({stopReason: 'cancelled'});
		}
	}

	session.messages = messages;
	return withTurnUsage({stopReason: 'max_turn_requests'});
}

/**
 * Mirror a successful `write_tasks` call to the client as an ACP `plan`
 * session update. The tool's args carry the complete replacement task list
 * (TodoWrite-style), which maps 1:1 onto ACP plan entries; tasks have no
 * priority concept, so entries are reported as `medium`.
 */
async function emitPlanUpdate(
	session: AcpSession,
	conn: AgentSideConnection,
	toolCall: ToolCall,
): Promise<void> {
	const args = toolCall.function.arguments as {
		tasks?: Array<{title?: unknown; status?: unknown}>;
	};
	const tasks = Array.isArray(args?.tasks) ? args.tasks : [];
	const validStatuses = ['pending', 'in_progress', 'completed'] as const;

	await conn.sessionUpdate({
		sessionId: session.sessionId,
		update: {
			sessionUpdate: 'plan',
			entries: tasks
				.filter(t => typeof t?.title === 'string')
				.map(t => ({
					content: t.title as string,
					priority: 'medium' as const,
					status: validStatuses.includes(
						t.status as (typeof validStatuses)[number],
					)
						? (t.status as (typeof validStatuses)[number])
						: 'pending',
				})),
		},
	});
}

async function emitToolCall(
	session: AcpSession,
	conn: AgentSideConnection,
	toolCall: ToolCall,
	status: ToolCallStatus,
	meta: AcpToolCallMeta,
	sessionUpdate: 'tool_call' | 'tool_call_update' = 'tool_call',
): Promise<void> {
	// Spelled out per branch: the union of both literals does not narrow
	// SessionUpdate's discriminant.
	const payload = {
		toolCallId: toolCall.id,
		title: meta.title,
		kind: meta.kind,
		rawInput: toolCall.function.arguments,
		status,
		content: meta.content.length > 0 ? meta.content : undefined,
		locations: meta.locations.length > 0 ? meta.locations : undefined,
	};
	await conn.sessionUpdate({
		sessionId: session.sessionId,
		update:
			sessionUpdate === 'tool_call'
				? {...payload, sessionUpdate: 'tool_call'}
				: {...payload, sessionUpdate: 'tool_call_update'},
	});
}

async function emitToolCallUpdate(
	session: AcpSession,
	conn: AgentSideConnection,
	toolCall: ToolCall,
	status: ToolCallStatus,
	rawOutput?: unknown,
	title?: string,
): Promise<void> {
	await conn.sessionUpdate({
		sessionId: session.sessionId,
		update: {
			sessionUpdate: 'tool_call_update',
			toolCallId: toolCall.id,
			status,
			rawOutput,
			title,
		},
	});
}

async function handleAskUser(
	session: AcpSession,
	conn: AgentSideConnection,
	toolCall: ToolCall,
	abortSignal?: AbortSignal,
): Promise<ToolResult> {
	const args = toolCall.function.arguments ?? {};
	const question = typeof args.question === 'string' ? args.question : '';
	const options = normalizeQuestionOptions(args.options);

	let content: string;
	if (!question || options.length < 2 || options.length > 4) {
		content = 'Error: ask_user requires a question and 2-4 string options.';
		await emitToolCallUpdate(session, conn, toolCall, 'failed', content);
	} else {
		await emitToolCallUpdate(session, conn, toolCall, 'in_progress');
		content = await requestUserChoice(
			conn,
			session.sessionId,
			toolCall.id,
			question,
			options,
			abortSignal,
		);
		const status: ToolCallStatus = content.startsWith('Error')
			? 'failed'
			: 'completed';
		await emitToolCallUpdate(session, conn, toolCall, status, content);
	}

	return {
		tool_call_id: toolCall.id,
		role: 'tool',
		name: toolCall.function.name,
		content,
	};
}

/**
 * Coerce the model's `options` into display strings. Most models pass an array
 * of strings, but some send objects (e.g. `{label}`, `{description}`), so we
 * extract a sensible label - via the same `toOptionString` the ask_user tool
 * uses - rather than dropping them and failing the call.
 */
function normalizeQuestionOptions(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.map(toOptionString).filter(option => option.length > 0);
}

async function evaluateNeedsApproval(
	toolCall: ToolCall,
	toolManager: ToolManager,
	nonInteractiveAlwaysAllow: string[],
	mode: DevelopmentMode,
): Promise<boolean> {
	const toolEntry = toolManager.getToolEntry(toolCall.function.name);
	return resolveToolApproval(
		toolCall.function.name,
		toolEntry,
		toolCall.function.arguments,
		{mode, alwaysAllow: nonInteractiveAlwaysAllow},
	);
}
