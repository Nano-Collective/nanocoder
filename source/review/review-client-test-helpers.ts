import type {
	AISDKCoreTool,
	LLMChatResponse,
	LLMClient,
	Message,
} from '@/types/core';

export type ReviewAgentRole = 'finder' | 'verifier' | 'other';

export interface ScriptedReviewCall {
	role: ReviewAgentRole;
	messages: Message[];
	tools: Record<string, AISDKCoreTool>;
	signal?: AbortSignal;
}

export interface ScriptedReviewReply {
	content?: string;
	toolCalls?: Array<{name: string; args: Record<string, unknown>}>;
	finishReason?: LLMChatResponse['finishReason'];
}

export type ReviewScript = (
	call: ScriptedReviewCall,
	index: number,
) => ScriptedReviewReply | Promise<ScriptedReviewReply>;

function roleOf(messages: Message[]): ReviewAgentRole {
	const system = messages[0]?.content ?? '';
	if (system.startsWith('You are a meticulous code reviewer')) return 'finder';
	if (system.startsWith('You independently verify')) return 'verifier';
	return 'other';
}

/** A fake LLM client whose replies come from a script, recording every call. */
export function createScriptedReviewClient(
	script: ReviewScript,
	options: {contextSize?: number} = {},
): {client: LLMClient; calls: ScriptedReviewCall[]} {
	const calls: ScriptedReviewCall[] = [];
	let toolCallId = 0;
	const client: LLMClient = {
		getCurrentModel: () => 'review-test-model',
		setModel: () => undefined,
		getContextSize: () => options.contextSize ?? 0,
		getAvailableModels: async () => ['review-test-model'],
		getProviderConfig: () => ({}) as never,
		clearContext: async () => undefined,
		getTimeout: () => undefined,
		chat: async (messages, tools, _callbacks, signal) => {
			const call: ScriptedReviewCall = {
				role: roleOf(messages),
				messages: [...messages],
				tools,
				...(signal ? {signal} : {}),
			};
			calls.push(call);
			const reply = await script(call, calls.length - 1);
			const response: LLMChatResponse = {
				...(reply.finishReason ? {finishReason: reply.finishReason} : {}),
				choices: [
					{
						message: {
							role: 'assistant',
							content: reply.content ?? '',
							...(reply.toolCalls
								? {
										tool_calls: reply.toolCalls.map(entry => ({
											id: `call_${++toolCallId}`,
											function: {name: entry.name, arguments: entry.args},
										})),
									}
								: {}),
						},
					},
				],
			};
			return response;
		},
	};
	return {client, calls};
}

export function findingBlock(input: {
	file: string;
	line: number | string;
	severity?: string;
	issue?: string;
	evidence?: string;
}): string {
	return [
		'FINDING',
		`FILE: ${input.file}`,
		`LINE: ${input.line}`,
		`SEVERITY: ${input.severity ?? 'high'}`,
		`ISSUE: ${input.issue ?? 'Division by zero when count is 0'}`,
		`EVIDENCE: ${input.evidence ?? 'return total / count;'}`,
		'END',
	].join('\n');
}

export function verdictBlock(input: {
	id?: string;
	verdict?: string;
	confidence?: number;
	reason?: string;
}): string {
	return [
		`ID: ${input.id ?? 'F1'}`,
		`VERDICT: ${input.verdict ?? 'CONFIRM'}`,
		`CONFIDENCE: ${input.confidence ?? 90}`,
		`REASON: ${input.reason ?? 'count comes straight from the caller with no guard'}`,
	].join('\n');
}
