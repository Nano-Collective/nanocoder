import type {
	AgentSideConnection,
	PermissionOption,
	ToolCallUpdate,
} from '@agentclientprotocol/sdk';
import type {AcpSession} from '@/acp/acp-session';
import type {ToolCall} from '@/types/core';

const ALLOW_OPTION: PermissionOption = {
	optionId: 'allow',
	name: 'Allow',
	kind: 'allow_once',
};

const DENY_OPTION: PermissionOption = {
	optionId: 'deny',
	name: 'Deny',
	kind: 'reject_once',
};

export async function requestToolPermission(
	session: AcpSession,
	toolCall: ToolCall,
	conn: AgentSideConnection,
): Promise<'approved' | 'denied' | 'cancelled'> {
	const toolCallUpdate: ToolCallUpdate = {
		toolCallId: toolCall.id,
		title: toolCall.function.name,
		rawInput: toolCall.function.arguments,
		status: 'pending',
	};

	const response = await conn.requestPermission({
		sessionId: session.sessionId,
		options: [ALLOW_OPTION, DENY_OPTION],
		toolCall: toolCallUpdate,
	});

	if (response.outcome.outcome === 'cancelled') {
		return 'cancelled';
	}

	if (
		response.outcome.outcome === 'selected' &&
		response.outcome.optionId === 'allow'
	) {
		return 'approved';
	}

	return 'denied';
}
