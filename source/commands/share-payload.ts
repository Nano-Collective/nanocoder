import {isApprovedPlanMessage} from '@/artifacts/approved-plan';
import {isInternalWalkthroughMessage} from '@/artifacts/walkthrough-lifecycle';
import {BASH_OUTPUT_PREFIX} from '@/constants';
import {isAutoDiagnosticsMessage} from '@/hooks/chat-handler/conversation/auto-diagnostics';
import type {Message} from '@/types/core';
import {REDACTED, redactSecrets} from '@/verify/redact-secrets';

/**
 * The `/share` payload: the part of a session worth showing someone else, in
 * a shape that serialises to the same bytes every time for the same session.
 *
 * Determinism rules:
 * - no timestamps or other per-call values (the date lives only in the
 *   generated filename);
 * - fixed key order for every object built here, and sorted keys inside tool
 *   arguments, whose order is whatever the model emitted;
 * - optional fields are omitted rather than written as `null`.
 *
 * System messages are left out: they are nanocoder's prompt scaffolding, not
 * part of the conversation. Image data is left out too (only the media type
 * is kept), so the file stays small and no screenshot is shared by accident.
 */

const SHARE_FORMAT = 'nanocoder-share';
const SHARE_FORMAT_VERSION = 1;

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| {[key: string]: JsonValue};

export interface SharedToolCall {
	id: string;
	name: string;
	arguments: JsonValue;
}

export interface SharedMessage {
	role: 'user' | 'assistant' | 'tool';
	content: string;
	reasoning?: string;
	toolCalls?: SharedToolCall[];
	toolCallId?: string;
	name?: string;
	images?: {mediaType: string}[];
	outcome?: 'completed' | 'cancelled' | 'failed';
	/** Harness notices (errors, cancellations) the model never saw. */
	displayOnly?: true;
}

export interface SharePayload {
	format: typeof SHARE_FORMAT;
	version: typeof SHARE_FORMAT_VERSION;
	provider: string;
	model: string;
	redacted: boolean;
	messages: SharedMessage[];
}

export interface SharePayloadOptions {
	/** Mask secrets in every message string (the default for `/share`). */
	redact: boolean;
	/** Environment scanned for secret-looking values. Defaults to process.env. */
	env?: NodeJS.ProcessEnv;
	/** Literal secrets that may not be in the environment (config API keys). */
	extraSecrets?: readonly string[];
}

export interface SharePayloadResult {
	payload: SharePayload;
	/** How many `[REDACTED]` markers redaction added. */
	redactionCount: number;
}

type Transform = (text: string) => string;

function countMarkers(text: string): number {
	return text.split(REDACTED).length - 1;
}

/**
 * Normalise a tool-argument value: sort object keys so the output does not
 * depend on the order the model emitted them, apply `transform` to string
 * leaves (keys are schema field names, not user data), and drop anything JSON
 * cannot represent.
 */
function normaliseJson(value: unknown, transform: Transform): JsonValue {
	if (typeof value === 'string') {
		return transform(value);
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === 'boolean' || value === null) {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(item => normaliseJson(item, transform));
	}
	if (typeof value === 'object') {
		const result: {[key: string]: JsonValue} = {};
		for (const key of Object.keys(value).sort()) {
			const item = (value as Record<string, unknown>)[key];
			if (item === undefined || typeof item === 'function') continue;
			result[key] = normaliseJson(item, transform);
		}
		return result;
	}
	return null;
}

function hasSomethingToShow(message: SharedMessage): boolean {
	return (
		// A tool result with empty output still answers its call.
		message.role === 'tool' ||
		message.content.trim() !== '' ||
		Boolean(message.reasoning?.trim()) ||
		Boolean(message.toolCalls?.length) ||
		Boolean(message.images?.length)
	);
}

function toSharedMessage(
	message: Message,
	transform: Transform,
): SharedMessage | null {
	if (message.role === 'system') {
		return null;
	}

	const shared: SharedMessage = {
		role: message.role,
		content: transform(message.content ?? ''),
	};
	if (message.reasoning?.trim()) {
		shared.reasoning = transform(message.reasoning);
	}
	if (message.role === 'assistant' && message.tool_calls?.length) {
		shared.toolCalls = message.tool_calls.map(call => ({
			id: call.id,
			name: call.function.name,
			arguments: normaliseJson(call.function.arguments ?? {}, transform),
		}));
	}
	if (message.role === 'tool') {
		if (message.tool_call_id) shared.toolCallId = message.tool_call_id;
		if (message.name) shared.name = message.name;
	}
	if (message.images?.length) {
		shared.images = message.images.map(image => ({
			mediaType: image.mediaType,
		}));
	}
	if (message.outcome) {
		shared.outcome = message.outcome;
	}
	if (message.displayOnly) {
		shared.displayOnly = true;
	}

	return hasSomethingToShow(shared) ? shared : null;
}

export function buildSharePayload(
	messages: readonly Message[],
	meta: {provider: string; model: string},
	options: SharePayloadOptions,
): SharePayloadResult {
	let redactionCount = 0;
	const env = options.env ?? process.env;
	const extraSecrets = options.extraSecrets ?? [];
	const transform: Transform = options.redact
		? text => {
				const redacted = redactSecrets(text, env, extraSecrets);
				if (redacted !== text) {
					redactionCount += countMarkers(redacted) - countMarkers(text);
				}
				return redacted;
			}
		: text => text;

	const shared: SharedMessage[] = [];
	for (const message of messages) {
		const item = toSharedMessage(message, transform);
		if (item) shared.push(item);
	}

	return {
		payload: {
			format: SHARE_FORMAT,
			version: SHARE_FORMAT_VERSION,
			provider: meta.provider,
			model: meta.model,
			redacted: options.redact,
			messages: shared,
		},
		redactionCount,
	};
}

/**
 * The message that says what the session was about: the first user turn the
 * user actually wrote. Both the generated filename and the page title come
 * from it, so they always describe the same turn. Skipped:
 * - display-only notices (errors, cancellations, an ACP slash command);
 * - the turns nanocoder sends as `role: 'user'` itself: an approved plan, the
 *   internal walkthrough request, post-edit diagnostics and `!bash` output.
 *   They are protocol, not requests, and session titles skip them too.
 */
export function firstUserRequest(
	messages: readonly SharedMessage[],
): SharedMessage | undefined {
	return messages.find(message => {
		if (message.role !== 'user' || message.displayOnly) return false;
		const asMessage: Message = {role: 'user', content: message.content};
		return !(
			isApprovedPlanMessage(asMessage) ||
			isInternalWalkthroughMessage(asMessage) ||
			isAutoDiagnosticsMessage(asMessage) ||
			message.content.startsWith(BASH_OUTPUT_PREFIX)
		);
	});
}

export function serializeSharePayload(payload: SharePayload): string {
	return `${JSON.stringify(payload, null, 2)}\n`;
}
