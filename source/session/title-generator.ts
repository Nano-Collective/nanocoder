import {MAX_SESSION_NAME_LENGTH} from '@/constants';
import type {LLMClient, Message} from '@/types/core';

/** Below this many characters, a first message is too thin to be a title. */
const WEAK_TITLE_THRESHOLD = 40;

const MAX_FIRST_MESSAGE_CHARS = 500;
const MAX_TOOL_SUMMARIES = 10;
const MAX_TOOL_SUMMARY_CHARS = 100;
const MAX_ASSISTANT_REPLY_CHARS = 300;

/** Argument names that usually carry the thing a tool acted on, best first. */
const PATH_ARG_KEYS = ['path', 'file_path', 'filePath', 'pattern', 'command'];

export interface TitleContext {
	firstUserMessage: string;
	/** e.g. ["read_file: source/auth/login.ts"] */
	toolSummaries: string[];
	/** Used only when toolSummaries is empty. */
	assistantReply?: string;
}

/**
 * Strip the active-file prefix the VS Code UI injects, keep the first line,
 * and collapse whitespace. Everything downstream measures this, not the raw
 * message, so a long file path can neither inflate nor rescue a short prompt.
 */
export function normalizeFirstMessage(content: string): string {
	return content
		.replace(/^\[Active file: [^\]]+\]\n\n/, '')
		.split('\n')[0]
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Length only, deliberately. An English stopword list would silently never
 * fire for non-English users, and a false positive here costs one small call
 * and yields an equal-or-better title.
 */
export function isWeakTitle(firstUserMessage: string): boolean {
	return normalizeFirstMessage(firstUserMessage).length < WEAK_TITLE_THRESHOLD;
}

/** Tool names plus what they acted on. This is what turns "fix this" into a title. */
export function extractToolSummaries(messages: Message[]): string[] {
	const summaries: string[] = [];

	for (const message of messages) {
		for (const call of message.tool_calls ?? []) {
			if (summaries.length >= MAX_TOOL_SUMMARIES) return summaries;

			const args = call.function.arguments ?? {};
			const key = PATH_ARG_KEYS.find(k => typeof args[k] === 'string');
			const detail = key ? String(args[key]) : '';

			summaries.push(
				detail ? `${call.function.name}: ${detail}` : call.function.name,
			);
		}
	}

	return summaries;
}

/**
 * Normalize whatever the model returned. Small local models routinely ignore
 * "reply with only the title", so this is required, not defensive. Returns
 * null when nothing usable is left, and null means we keep the existing title.
 */
export function sanitizeTitle(raw: string): string | null {
	const firstLine = raw.split('\n').find(line => line.trim().length > 0);
	if (!firstLine) return null;

	const cleaned = firstLine
		.trim()
		.replace(/^title\s*:\s*/i, '')
		.replace(/^[*_`]+|[*_`]+$/g, '')
		.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
		.replace(/[.!?,;:]+$/, '')
		.replace(/\s+/g, ' ')
		.trim();

	if (!cleaned) return null;
	// A model that wrote a paragraph must degrade to "no change", never to a
	// paragraph in the sidebar. Truncating would hide the failure.
	if (cleaned.length > MAX_SESSION_NAME_LENGTH) return null;

	return cleaned;
}

/** All truncation happens here, before anything reaches a provider. */
export function buildTitleRequest(ctx: TitleContext): Message[] {
	const parts = [
		`First message: ${ctx.firstUserMessage.slice(0, MAX_FIRST_MESSAGE_CHARS)}`,
	];

	if (ctx.toolSummaries.length > 0) {
		const tools = ctx.toolSummaries
			.slice(0, MAX_TOOL_SUMMARIES)
			.map(s => s.slice(0, MAX_TOOL_SUMMARY_CHARS));
		parts.push(`Actions taken:\n${tools.join('\n')}`);
	} else if (ctx.assistantReply) {
		parts.push(
			`Assistant reply: ${ctx.assistantReply.slice(0, MAX_ASSISTANT_REPLY_CHARS)}`,
		);
	}

	return [
		{
			role: 'system',
			content:
				'You name coding sessions. Reply with ONLY a title of 3 to 6 words ' +
				'describing the task worked on. No quotes, no trailing punctuation, ' +
				'no explanation, no preamble.',
		},
		{role: 'user', content: parts.join('\n\n')},
	];
}

/**
 * The one impure export. Returns null on every failure path so a titling
 * problem can never surface an error to the user or fail a turn.
 *
 * Tools are passed as {} so there is no tool-schema overhead on the request
 * and no way for the call to turn into a tool loop.
 */
export async function generateSessionTitle(
	client: LLMClient,
	ctx: TitleContext,
	signal?: AbortSignal,
): Promise<string | null> {
	try {
		const response = await client.chat(buildTitleRequest(ctx), {}, {}, signal);
		const content = response.choices[0]?.message?.content;
		if (typeof content !== 'string') return null;
		return sanitizeTitle(content);
	} catch (_error) {
		return null;
	}
}
