import type {Message} from '@/types/core';

export interface SubagentSession {
	agentId: string;
	subagentName: string;
	messages: Message[];
	streamingText: string;
	streamingReasoning: string;
}

const sessionStore = new Map<string, SubagentSession>();

export function getSubagentSession(
	agentId: string,
): SubagentSession | undefined {
	return sessionStore.get(agentId);
}

export function initSubagentSession(
	agentId: string,
	subagentName: string,
	initialMessages: Message[],
): void {
	sessionStore.set(agentId, {
		agentId,
		subagentName,
		messages: [...initialMessages],
		streamingText: '',
		streamingReasoning: '',
	});
}

export function updateSubagentSessionMessages(
	agentId: string,
	messages: Message[],
): void {
	const session = sessionStore.get(agentId);
	if (session) {
		// Create a shallow copy so React detects the update if needed
		session.messages = [...messages];
	}
}

export function updateSubagentSessionStreaming(
	agentId: string,
	streamingText: string,
	streamingReasoning: string,
): void {
	const session = sessionStore.get(agentId);
	if (session) {
		session.streamingText = streamingText;
		session.streamingReasoning = streamingReasoning;
	}
}

export function cleanupSubagentSession(agentId: string): void {
	sessionStore.delete(agentId);
}
