import type {
	AgentSideConnection,
	PromptResponse,
	ToolCallStatus,
} from '@agentclientprotocol/sdk';
import {requestToolPermission} from '@/acp/acp-permission';
import type {AcpSession} from '@/acp/acp-session';
import {processToolUse} from '@/message-handler';
import {parseToolCalls} from '@/tool-calling/index';
import type {ToolManager} from '@/tools/tool-manager';
import type {
	LLMClient,
	ModeOverrides,
	StreamCallbacks,
	ToolCall,
	ToolResult,
} from '@/types/core';
import {toolNeedsApproval} from '@/utils/tool-needs-approval';

const MAX_TURNS = 50;

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

	for (let turn = 0; turn < MAX_TURNS; turn++) {
		if (abortController.signal.aborted) {
			return {stopReason: 'cancelled'};
		}

		const availableNames = toolManager.getAvailableToolNames(
			undefined,
			developmentMode,
		);
		const tools = toolManager.getEffectiveTools(availableNames, {
			nonInteractiveAlwaysAllow,
		});

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

		const result = await client.chat(
			[systemMessage, ...messages],
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

		const xmlParse = result.toolsDisabled
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
			// Notify client about tool call
			await emitToolCall(session, conn, toolCall, 'pending');

			// Check if approval is needed
			const needsApproval = await evaluateNeedsApproval(
				toolCall,
				toolManager,
				nonInteractiveAlwaysAllow,
			);

			if (needsApproval && developmentMode !== 'yolo') {
				const permission = await requestToolPermission(session, toolCall, conn);

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
			const toolResult = await processToolUse(toolCall);

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
): Promise<void> {
	await conn.sessionUpdate({
		sessionId: session.sessionId,
		update: {
			sessionUpdate: 'tool_call',
			toolCallId: toolCall.id,
			title: toolCall.function.name,
			rawInput: toolCall.function.arguments,
			status,
		},
	});
}

async function emitToolCallUpdate(
	session: AcpSession,
	conn: AgentSideConnection,
	toolCall: ToolCall,
	status: ToolCallStatus,
	rawOutput?: unknown,
): Promise<void> {
	await conn.sessionUpdate({
		sessionId: session.sessionId,
		update: {
			sessionUpdate: 'tool_call_update',
			toolCallId: toolCall.id,
			status,
			rawOutput,
		},
	});
}

async function evaluateNeedsApproval(
	toolCall: ToolCall,
	toolManager: ToolManager,
	nonInteractiveAlwaysAllow: string[],
): Promise<boolean> {
	if (nonInteractiveAlwaysAllow.includes(toolCall.function.name)) {
		return false;
	}
	const toolEntry = toolManager.getToolEntry(toolCall.function.name);
	return toolNeedsApproval(toolEntry?.tool, toolCall.function.arguments);
}
