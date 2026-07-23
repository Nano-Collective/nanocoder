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
import {getSubagentProgress} from '@/services/subagent-events';
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
			return {stopReason: 'cancelled'};
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
			return {stopReason: 'end_turn'};
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
				const answer = await handleAskUser(session, conn, toolCall);
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
				);

				if (permission === 'cancelled') {
					await emitToolCallUpdate(
						session,
						conn,
						toolCall,
						'failed',
						'Cancelled by user',
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
			if (
				toolCall.function.name === 'invoke_subagent' ||
				toolCall.function.name === 'browser_subagent'
			) {
				let agentId = '';
				try {
					const args = toolCall.function.arguments as Record<string, unknown>;
					agentId = (args.ReusedSubagentId || args.TaskName || '') as string;
				} catch (_e) {}

				pollInterval = setInterval(async () => {
					const progress = getSubagentProgress(agentId);
					if (progress && progress.toolCallCount > 0) {
						const tokens = Math.round(progress.tokenCount / 1000);
						const lastTool =
							progress.toolHistory.length > 0
								? progress.toolHistory[progress.toolHistory.length - 1]
								: '';
						const title = `${progress.subagentName || 'subagent'} • ${progress.toolCallCount} tools ${lastTool ? `• ${lastTool}` : ''} • ${tokens}k tokens`;

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

			const toolResult = await processToolUse(toolCall);
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
		}

		messages = [...messages, ...toolResults];
	}

	session.messages = messages;
	return {stopReason: 'max_turn_requests'};
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
