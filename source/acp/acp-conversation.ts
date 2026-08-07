import type {
	AgentSideConnection,
	PromptResponse,
	ToolCallStatus,
} from '@agentclientprotocol/sdk';
import {filterAcpToolNames} from '@/acp/acp-capabilities';
import {requestToolPermission} from '@/acp/acp-permission';
import {requestUserChoice} from '@/acp/acp-question';
import type {AcpSession} from '@/acp/acp-session';
import {type AcpToolCallMeta, buildToolCallMeta} from '@/acp/acp-tool-call';
import {artifactManager} from '@/artifacts/artifact-manager';
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
	DevelopmentMode,
	LLMClient,
	Message,
	ModeOverrides,
	StreamCallbacks,
	ToolCall,
	ToolResult,
} from '@/types/core';
import {capMessagesForModel} from '@/utils/message-capping';
import {createCancellationResults} from '@/utils/tool-cancellation';
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

	const maxTurns =
		getAppConfig().headless?.maxTurns ?? DEFAULT_HEADLESS_MAX_TURNS;

	for (let turn = 0; turn < maxTurns; turn++) {
		if (abortController.signal.aborted) {
			session.messages = messages;
			return {stopReason: 'cancelled'};
		}

		// On the final turn, force a tool-free wrap-up so we end with an answer
		// rather than stopping mid-task at the ceiling.
		const finalTurn = turn === maxTurns - 1;

		const availableNames = filterAcpToolNames(
			toolManager.getAvailableToolNames(undefined, developmentMode),
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
			return {stopReason: 'end_turn'};
		}

		const sessionConfig = getAppConfig().sessions;
		const maxMessages = sessionConfig?.maxMessages ?? 1000;
		const cappedMessages = capMessagesForModel(messages, maxMessages);

		const finalTurnNotice: Message[] = finalTurn
			? [{role: 'user', content: FINAL_TURN_INSTRUCTION}]
			: [];

		let result: Awaited<ReturnType<LLMClient['chat']>>;
		try {
			result = await client.chat(
				[systemMessage, ...cappedMessages, ...finalTurnNotice],
				tools,
				callbacks,
				abortController.signal,
				modeOverrides,
			);
		} catch (error) {
			if (abortController.signal.aborted) {
				session.messages = messages;
				return {stopReason: 'cancelled'};
			}
			throw error;
		}

		if (!result || !result.choices || result.choices.length === 0) {
			return {stopReason: 'end_turn'};
		}

		const message = result.choices[0].message;
		const nativeToolCalls = message.tool_calls || [];
		const fullContent = message.content || '';

		const xmlParse =
			result.toolsDisabled && !finalTurn
				? parseToolCalls(fullContent)
				: {success: true as const, toolCalls: [], cleanedContent: fullContent};

		if (!xmlParse.success) {
			return {stopReason: 'end_turn'};
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
			return {stopReason: 'end_turn'};
		}

		// Process tool calls
		const toolResults: ToolResult[] = [];
		for (const toolCall of validToolCalls) {
			// Stop was pressed: don't start any remaining queued tools. Record a
			// cancelled result for each so the assistant's tool_calls keep matched
			// results in history; the turn ends below instead of re-prompting.
			if (abortController.signal.aborted) {
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

			// Notify client about tool call
			await emitToolCall(session, conn, toolCall, 'pending', meta);

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
					toolResults.push(
						...createCancellationResults(
							validToolCalls.slice(validToolCalls.indexOf(toolCall)),
						),
					);
					session.messages = [...messages, ...toolResults];
					return {stopReason: 'cancelled'};
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
				sessionId: session.sessionId,
				workingDirectory: session.cwd,
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
			return {stopReason: 'cancelled'};
		}
	}

	session.messages = messages;
	return {stopReason: 'max_turn_requests'};
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
): Promise<void> {
	await conn.sessionUpdate({
		sessionId: session.sessionId,
		update: {
			sessionUpdate: 'tool_call',
			toolCallId: toolCall.id,
			title: meta.title,
			kind: meta.kind,
			rawInput: toolCall.function.arguments,
			status,
			content: meta.content.length > 0 ? meta.content : undefined,
			locations: meta.locations.length > 0 ? meta.locations : undefined,
		},
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
	const planArtifactPath =
		toolCall.function.name === 'write_plan' && status === 'completed'
			? artifactManager.getArtifactPath(
					session.sessionId,
					'implementation_plan',
				)
			: undefined;

	await conn.sessionUpdate({
		sessionId: session.sessionId,
		update: {
			sessionUpdate: 'tool_call_update',
			toolCallId: toolCall.id,
			status,
			rawOutput,
			title: planArtifactPath ? 'Implementation plan ready' : title,
			locations: planArtifactPath ? [{path: planArtifactPath}] : undefined,
			_meta: planArtifactPath
				? {'nanocoder/planArtifact': {path: planArtifactPath}}
				: undefined,
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
