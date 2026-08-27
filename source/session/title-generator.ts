import {MAX_SESSION_NAME_LENGTH} from '@/constants';
import type {LLMClient, Message} from '@/types/core';

/** Below this many characters, a first message is too thin to be a title. */
const WEAK_TITLE_THRESHOLD = 40;

const MAX_USER_MESSAGE_CHARS = 500;

/** How many opening user turns shape the title. */
const MAX_USER_MESSAGES = 3;
const MAX_TOOL_SUMMARIES = 10;
const MAX_TOOL_SUMMARY_CHARS = 100;
const MAX_ASSISTANT_REPLY_CHARS = 300;

const MAX_HEURISTIC_TITLE_CHARS = 50;

/** Prepended by the VS Code UI, so it is plumbing rather than the request. */
const ACTIVE_FILE_PREFIX = /^\[Active file: [^\]]+\]\n\n/;

/** Argument names that usually carry the thing a tool acted on, best first. */
const PATH_ARG_KEYS = ['path', 'file_path', 'filePath', 'pattern', 'command'];

export interface TitleContext {
	/** The opening user turns, in order. The first one anchors the title. */
	userMessages: string[];
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
		.replace(ACTIVE_FILE_PREFIX, '')
		.split('\n')[0]
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * The plain title used until a generated one lands. Shared by the ACP save
 * path and the CLI autosave, which write to the same store. Null, never '',
 * so a message opening with a newline cannot persist a nameless session.
 */
export function deriveTitleFromFirstMessage(content: string): string | null {
	const firstLine = content
		.replace(ACTIVE_FILE_PREFIX, '')
		.split('\n')[0]
		.trim();
	if (!firstLine) return null;
	return firstLine.slice(0, MAX_HEURISTIC_TITLE_CHARS);
}

/**
 * Length only, deliberately. An English stopword list would silently never
 * fire for non-English users, and a false positive here costs one small call
 * and yields an equal-or-better title.
 */
export function isWeakTitle(firstUserMessage: string): boolean {
	return normalizeFirstMessage(firstUserMessage).length < WEAK_TITLE_THRESHOLD;
}

/**
 * The opening user turns, in order, blanks dropped. Titling waits for a second
 * turn or a tool call, so those later turns are usually where the actual task
 * is stated - taking only the first would discard the context we waited for.
 */
export function extractUserMessages(messages: Message[]): string[] {
	const turns: string[] = [];

	for (const message of messages) {
		if (turns.length >= MAX_USER_MESSAGES) break;
		if (message.role !== 'user') continue;
		if (typeof message.content !== 'string') continue;

		const trimmed = message.content.replace(ACTIVE_FILE_PREFIX, '').trim();
		if (trimmed) turns.push(trimmed);
	}

	return turns;
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
	const turns = ctx.userMessages
		.slice(0, MAX_USER_MESSAGES)
		.map(turn => turn.slice(0, MAX_USER_MESSAGE_CHARS));

	const parts = [
		turns.length > 1
			? `Conversation so far:\n${turns.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
			: `User request: ${turns[0] ?? ''}`,
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
				'You name coding sessions. Summarise the whole exchange into ONLY a ' +
				'title of 3 to 6 words describing the task worked on. The first ' +
				'request is what the session is about; later ones add detail. ' +
				'No quotes, no trailing punctuation, no explanation, no preamble.',
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
