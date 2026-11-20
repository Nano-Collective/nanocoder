import type {
	AgentSideConnection,
	PermissionOption,
	RequestPermissionResponse,
	ToolCallUpdate,
} from '@agentclientprotocol/sdk';
import type {AcpSession} from '@/acp/acp-session';
import type {AcpToolCallMeta} from '@/acp/acp-tool-call';
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
	meta?: AcpToolCallMeta,
	abortSignal?: AbortSignal,
	requestMeta?: Record<string, unknown>,
	/**
	 * Why this prompt is up, when the answer is not self-evident - reading
	 * external content escalated the call. Appended to the card title, which is
	 * the only text this protocol lets a server attach to a permission request.
	 */
	escalationReason?: string,
): Promise<'approved' | 'denied' | 'cancelled'> {
	const title = meta?.title ?? toolCall.function.name;
	const toolCallUpdate: ToolCallUpdate = {
		toolCallId: toolCall.id,
		title: escalationReason ? `${title} (${escalationReason})` : title,
		kind: meta?.kind,
		rawInput: toolCall.function.arguments,
		status: 'pending',
		content: meta && meta.content.length > 0 ? meta.content : undefined,
		locations: meta && meta.locations.length > 0 ? meta.locations : undefined,
	};

	const requestPromise = conn.requestPermission({
		sessionId: session.sessionId,
		options: [ALLOW_OPTION, DENY_OPTION],
		toolCall: toolCallUpdate,
		...(requestMeta ? {_meta: requestMeta} : {}),
	});

	let response: RequestPermissionResponse;
	if (abortSignal) {
		response = await Promise.race([
			requestPromise,
			new Promise<RequestPermissionResponse>(resolve => {
				if (abortSignal.aborted) {
					resolve({outcome: {outcome: 'cancelled'}});
				} else {
					abortSignal.addEventListener('abort', () => {
						resolve({outcome: {outcome: 'cancelled'}});
					});
				}
			}),
		]);
	} else {
		response = await requestPromise;
	}

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
