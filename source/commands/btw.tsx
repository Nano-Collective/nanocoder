/**
 * /btw command — quick side question, never added to conversation history.
 *
 * Runs as a StatefulCommand live component so it can capture input (Esc to
 * dismiss) without affecting the main turn. The request uses a conversation
 * snapshot with tools disabled and records usage without mutating history.
 */

import React from 'react';
import {isInternalWalkthroughMessage} from '@/artifacts/walkthrough-lifecycle';
import {BtwDisplay, type BtwRunResult} from '@/components/btw/btw-display';
import {errorMsg} from '@/components/message-factory';
import type {
	ApiCallRecord,
	LLMChatResponse,
	LLMClient,
	Message,
} from '@/types/core';
import type {StatefulCommand} from '@/types/index';
import {generateKey} from '@/utils/key-generator';

export const BTW_SYSTEM_PROMPT =
	'You are answering a quick side question during an active coding conversation. ' +
	'Use the conversation context to answer accurately and concisely. ' +
	'Do not use tools. Do not suggest tool calls. ' +
	'This exchange is ephemeral and will not be saved to the conversation history.';

function hasReportedUsage(usage: LLMChatResponse['usage']): boolean {
	return (
		!!usage &&
		(Number.isFinite(usage.inputTokens) ||
			Number.isFinite(usage.outputTokens) ||
			Number.isFinite(usage.totalTokens) ||
			Number.isFinite(usage.cacheReadTokens) ||
			Number.isFinite(usage.cacheWriteTokens))
	);
}

function sanitizeSnapshotMessage(message: Message): Message | null {
	if (isInternalWalkthroughMessage(message) || message.role === 'system') {
		return null;
	}

	// Tool-call/tool-result messages can be rejected when no tools are defined.
	// Keep conversational content and drop tool-only payloads.
	if (message.role === 'tool') {
		return null;
	}

	if (message.role === 'assistant') {
		const content =
			typeof message.content === 'string' ? message.content.trim() : '';
		if (!content) {
			return null;
		}
		return {role: 'assistant', content};
	}

	if (message.role === 'user') {
		return typeof message.content === 'string'
			? {role: 'user', content: message.content}
			: null;
	}

	return null;
}

export function buildBtwMessages(
	messages: Message[],
	question: string,
): Message[] {
	const snapshot = messages
		.map(sanitizeSnapshotMessage)
		.filter((message): message is Message => message !== null);

	return [
		{role: 'system', content: BTW_SYSTEM_PROMPT},
		...snapshot,
		{role: 'user', content: question},
	];
}

export type {BtwRunResult};

export interface RunBtwRequestOptions {
	client: LLMClient;
	messages: Message[];
	question: string;
	provider: string;
	model: string;
	signal: AbortSignal;
	onToken: (token: string) => void;
	onApiCallComplete?: (record: ApiCallRecord) => void;
}

export async function runBtwRequest(
	options: RunBtwRequestOptions,
): Promise<BtwRunResult> {
	const {
		client,
		messages,
		question,
		provider,
		model,
		signal,
		onToken,
		onApiCallComplete,
	} = options;

	const btwMessages = buildBtwMessages(messages, question);
	try {
		const response = await client.chat(btwMessages, {}, {onToken}, signal, {
			nonInteractiveMode: false,
			nonInteractiveAlwaysAllow: [],
		});

		const usage = response.usage;
		if (onApiCallComplete && hasReportedUsage(usage) && usage) {
			const baseURL = client.getProviderConfig?.().config?.baseURL;
			onApiCallComplete({
				provider,
				model,
				inputTokens: usage.inputTokens,
				outputTokens: usage.outputTokens,
				totalTokens: usage.totalTokens,
				cacheReadTokens: usage.cacheReadTokens,
				cacheWriteTokens: usage.cacheWriteTokens,
				...(baseURL ? {baseURL} : {}),
				timestamp: Date.now(),
			});
		}

		const answer = response.choices?.[0]?.message?.content?.trim() ?? '';
		return {answer};
	} catch (err) {
		if (signal.aborted) {
			return {answer: '', error: undefined};
		}
		throw err;
	}
}

export const btwCommand: StatefulCommand = {
	name: 'btw',
	description:
		'Ask a quick side question without adding it to conversation history (/btw <question>)',
	run: async context => {
		const question = context.argText.trim();
		if (!question) {
			context.addToChatQueue(
				errorMsg(
					'Usage: /btw <question>\n\nAsk a quick side question without adding it to conversation history.',
					'btw-error',
				),
			);
			return 'done';
		}

		if (!context.client) {
			context.addToChatQueue(
				errorMsg(
					'No AI client available. Select a provider and model first.',
					'btw-error',
				),
			);
			return 'done';
		}

		const client = context.client;
		const messages = context.messages;
		const provider = context.provider;
		const model = context.model;
		const onApiCallComplete = context.onApiCallComplete;
		const setPanel = context.setBtwPanel ?? context.setLiveComponent;

		context.setLiveComponentCapturesInput(true);

		const until = new Promise<void>(resolve => {
			let settled = false;
			const close = () => {
				if (settled) return;
				settled = true;
				setPanel(null);
				context.setLiveComponentCapturesInput(false);
				resolve();
			};

			setPanel(
				React.createElement(BtwDisplay, {
					key: generateKey('btw'),
					question,
					interactive: true,
					onClose: close,
					runRequest: (signal, onToken) =>
						runBtwRequest({
							client,
							messages,
							question,
							provider,
							model,
							signal,
							onToken,
							onApiCallComplete,
						}),
				}),
			);
		});

		return {until};
	},
};
