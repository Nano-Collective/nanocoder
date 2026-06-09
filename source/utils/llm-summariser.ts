import type {LLMClient, Message} from '@/types/core';
import type {Tokenizer} from '@/types/tokenization';
import {COMPRESSION_CONSTANTS} from './message-compression';

export interface SummariseWithLLMParams {
	messages: Message[];
	systemMessage: Message;
	client: LLMClient;
	tokenizer: Tokenizer;
	keepRecentMessages?: number;
	signal?: AbortSignal;
}

const SUMMARISER_SYSTEM_PROMPT = `You compact coding-agent conversations without losing information that future turns will need.

Output a single markdown summary of the segment below. Use exactly these sections, omit any that are empty:

## Context
One or two sentences: what the user is working on and the current state.

## Decisions
Choices made by the user or agent that should not be revisited (libraries, approaches, naming, architecture, scope cuts). One bullet each, with the reason if stated.

## Files modified
Each touched file as a bullet: \`path/to/file\` — short description of what changed.

## Tools used
Notable tool invocations and their outcomes (commands run, searches performed, errors encountered). Skip trivial reads.

## Open questions / TODO
Anything unresolved, blocked, or explicitly deferred.

Rules:
- Be terse. Every sentence must add information a future turn needs.
- Preserve exact identifiers (file paths, function names, error messages, version numbers).
- Do not invent details. If something is uncertain, omit it.
- Do not address the user. Write in third person.
- Output only the summary, no preamble or sign-off.`;

/**
 * Summarise the compressible portion of a conversation using the active LLM.
 *
 * Splits `messages` into a compressible segment and a tail of recent messages
 * (kept verbatim), asks the model to produce a structured summary of the
 * compressible segment, then returns `[summary, ...recent]`. The system
 * message is intentionally not included in the return value — the chat
 * handler re-injects it on each call.
 *
 * Returns null when there is nothing meaningful to summarise (segment empty
 * or model returned an empty response).
 */
export async function summariseWithLLM(
	params: SummariseWithLLMParams,
): Promise<Message[] | null> {
	const {
		messages,
		systemMessage,
		client,
		tokenizer,
		keepRecentMessages = COMPRESSION_CONSTANTS.DEFAULT_KEEP_RECENT_MESSAGES,
		signal,
	} = params;

	// Determine where the verbatim "recent" tail begins. Walk the boundary
	// backward while it would land on a `tool` message: keeping a tool result
	// while summarising away its owning assistant(tool_calls) turn orphans the
	// result (a `tool` message whose tool_call_id matches no preceding tool
	// call). OpenAI-compatible providers reject that sequence — or, worse,
	// answer with an empty completion — which is the failure this guards.
	// Moving the boundary back pulls the owning assistant (and its sibling
	// tool results) into `recent` so the pairing stays intact.
	let splitIndex = Math.max(0, messages.length - keepRecentMessages);
	while (splitIndex > 0 && messages[splitIndex]?.role === 'tool') {
		splitIndex--;
	}

	const compressible: Message[] = [];
	const recent: Message[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (msg.role === 'system') continue;
		if (i >= splitIndex) {
			recent.push(msg);
		} else {
			compressible.push(msg);
		}
	}

	if (compressible.length === 0) {
		return null;
	}

	const transcript = serialiseTranscript(compressible);

	const summariserMessages: Message[] = [
		{role: 'system', content: SUMMARISER_SYSTEM_PROMPT},
		{
			role: 'user',
			content: `Summarise the following conversation segment.\n\nOriginal task context (system prompt, for reference only):\n<original-system>\n${truncate(systemMessage.content || '', 1500)}\n</original-system>\n\nConversation segment to compact:\n<segment>\n${transcript}\n</segment>`,
		},
	];

	let response;
	try {
		response = await client.chat(summariserMessages, {}, {}, signal);
	} catch {
		return null;
	}

	const summaryContent = response?.choices?.[0]?.message?.content?.trim();
	if (!summaryContent) {
		return null;
	}

	const summaryMessage: Message = {
		role: 'user',
		content: `<conversation-summary>\n${summaryContent}\n</conversation-summary>\n\n(The above is an automated summary of earlier conversation. Continue from the most recent message.)`,
	};

	// Recompute token count to verify we actually saved space; if the
	// summary is somehow larger than the original, return null so the
	// caller falls back to mechanical.
	const originalTokens = compressible.reduce(
		(sum, msg) => sum + tokenizer.countTokens(msg),
		0,
	);
	const summaryTokens = tokenizer.countTokens(summaryMessage);
	if (summaryTokens >= originalTokens) {
		return null;
	}

	return [summaryMessage, ...recent];
}

function serialiseTranscript(messages: Message[]): string {
	const lines: string[] = [];
	for (const msg of messages) {
		if (msg.role === 'user') {
			lines.push(`## user\n${msg.content || ''}`);
		} else if (msg.role === 'assistant') {
			const parts: string[] = [];
			if (msg.content) parts.push(msg.content);
			if (msg.tool_calls && msg.tool_calls.length > 0) {
				const calls = msg.tool_calls
					.map(tc => {
						const args =
							typeof tc.function.arguments === 'string'
								? tc.function.arguments
								: JSON.stringify(tc.function.arguments);
						return `- ${tc.function.name}(${truncate(args, 400)})`;
					})
					.join('\n');
				parts.push(`[tool calls]\n${calls}`);
			}
			lines.push(`## assistant\n${parts.join('\n\n')}`);
		} else if (msg.role === 'tool') {
			lines.push(
				`## tool: ${msg.name ?? 'unknown'}\n${truncate(msg.content || '', 1200)}`,
			);
		}
	}
	return lines.join('\n\n');
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}... [truncated ${text.length - max} chars]`;
}
