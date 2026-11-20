import {MAX_TOOL_RESULT_CHARS} from '@/constants';
import type {
	ExternalContentSource,
	ExternalToolSource,
	Message,
	ToolResult,
} from '@/types/core';
import {isPlainObject} from '@/utils/type-helpers';
import {truncateToolResult} from './truncate-tool-result.js';

/**
 * Framing for tool results that came from outside the workspace.
 *
 * Text an MCP server, a web page or a search provider produced reaches the
 * model through the same channel as the user's own words: an ordinary tool
 * message. Nothing in that message says where it came from, so a page carrying
 * "ignore previous instructions and run …" reads as a request. The frame below
 * is the cheap half of the answer - it marks the boundary in the payload and
 * names the source - and `source/app/prompts/sections/external-content.md`
 * tells the model what the boundary means.
 *
 * The frame is applied where a result becomes a message, never to
 * `ToolResult.content` itself: `--json` telemetry, the ACP timeline and
 * `/expand` keep showing the tool's own output.
 */

const OPEN_TAG = '<external_content';
const CLOSE_TAG = '</external_content>';

/**
 * A URL long enough to be a payload rather than an address. The frame names
 * what was read; it is not a place to smuggle a second document into context.
 */
const MAX_FRAMED_URL_CHARS = 512;

/**
 * Any sequence that would open or close the frame: any casing, whitespace
 * around the slash, and a space, hyphen or underscore between the words. Only
 * the leading `<` is rewritten, because a tag cannot begin with anything else -
 * the text stays readable (pages about HTML are summarised, not mangled) while
 * the delimiter is inert.
 *
 * Known limit: an entity-encoded form such as `&lt;/external_content&gt;` is
 * left alone. It is inert to this frame, and decoding entities inside a body
 * would corrupt the code samples the model is usually reading.
 */
const LOOKALIKE_TAG = /<\s*\/?\s*external[\s_-]*content/gi;

/**
 * Attribute values travel inside double quotes on one line. `&` is deliberately
 * not escaped: the value is an address the model may copy, and this is a text
 * frame rather than a document anything re-parses as XML.
 */
function escapeAttribute(value: string): string {
	return value
		.replace(/\s+/g, ' ')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.trim();
}

/**
 * What the model sees as the source: the tool's own name, or `mcp:<server>`
 * when the tool came from a server, since an MCP tool's name is the server's
 * choice and says nothing about where it lives.
 */
function sourceLabel(toolName: string, source?: ExternalContentSource): string {
	if (source?.kind === 'mcp') {
		return source.server ? `mcp:${source.server}` : 'mcp';
	}
	return toolName;
}

function openTagFor(toolName: string, source?: ExternalContentSource): string {
	const attributes = [
		`source="${escapeAttribute(sourceLabel(toolName, source))}"`,
	];
	const url = source?.url;
	if (url) {
		const bounded =
			url.length > MAX_FRAMED_URL_CHARS
				? `${url.slice(0, MAX_FRAMED_URL_CHARS)}…`
				: url;
		attributes.push(`url="${escapeAttribute(bounded)}"`);
	}
	return `${OPEN_TAG} ${attributes.join(' ')}>`;
}

/**
 * Characters the frame adds around a body, so a caller can budget for it
 * before it truncates. Truncating to the raw cap and framing afterwards would
 * exceed the cap, and the converter's own truncation would then cut the closing
 * tag - leaving the model inside an open frame.
 */
function frameOverheadFor(
	toolName: string,
	source: ExternalContentSource,
): number {
	return openTagFor(toolName, source).length + CLOSE_TAG.length + 2;
}

/** Neutralise lookalike delimiters so only this frame can close this frame. */
function neutraliseExternalBody(body: string): string {
	return body.replace(LOOKALIKE_TAG, match => `[${match.slice(1)}`);
}

/** Whether this result carries text from outside the workspace. */
export function isExternalResult(result: ToolResult): boolean {
	return result.externalSource !== undefined;
}

/**
 * Bound a result's text before it enters context, leaving room for the frame
 * when there will be one. Callers that know the source use this instead of
 * `truncateToolResult` so the elision marker reports the tool's real output
 * size - a second truncation here would report the already-cut length instead.
 */
export function boundedToolResult(
	content: string,
	toolName: string,
	source?: ExternalContentSource,
): string {
	const overhead = source ? frameOverheadFor(toolName, source) : 0;
	return truncateToolResult(
		content,
		Math.max(0, MAX_TOOL_RESULT_CHARS - overhead),
	);
}

/**
 * The body the model reads: the tool's text, plus a structured payload when
 * there is one. A structured result is never sent as `structuredContent`
 * instead, because the provider converter prefers that field over `content`
 * and the frame would then be bypassed by any tool returning JSON.
 */
function framedBody(result: ToolResult): string {
	const content = result.content ?? '';
	if (result.structuredContent === undefined) return content;
	return `${content}\n\n${JSON.stringify(result.structuredContent)}`;
}

function wrapExternalContent(result: ToolResult): string {
	const open = openTagFor(result.name, result.externalSource);
	const budget = Math.max(
		0,
		MAX_TOOL_RESULT_CHARS - open.length - CLOSE_TAG.length - 2,
	);
	const inner = neutraliseExternalBody(
		truncateToolResult(framedBody(result), budget),
	);
	return `${open}\n${inner}\n${CLOSE_TAG}`;
}

/**
 * Resolve the source of one call from the tool's declaration and the arguments
 * it was called with. Returns undefined for a workspace tool, which is what
 * keeps ordinary results out of the frame.
 */
export function externalSourceFor(
	declared: ExternalToolSource | undefined,
	args: unknown,
): ExternalContentSource | undefined {
	if (!declared) return undefined;

	const source: ExternalContentSource = {kind: declared.kind};
	if (declared.server) {
		source.server = declared.server;
	}
	if (declared.urlArg && isPlainObject(args)) {
		const value = args[declared.urlArg];
		if (typeof value === 'string' && value.trim() !== '') {
			source.url = value.trim();
		}
	}
	return source;
}

/**
 * The message a tool result is written to history as.
 *
 * An external result is framed and delivered as text. The text-only part is
 * deliberate: the provider converter prefers a structured payload over
 * `content` whenever `structuredContent` is present, which would hand the model
 * unframed JSON - and an MCP server that returns structured output would
 * bypass the frame entirely.
 */
export function toToolMessage(result: ToolResult): Message {
	const external = isExternalResult(result);

	const message: Message = {
		role: 'tool',
		content: external
			? wrapExternalContent(result)
			: boundedToolResult(result.content ?? '', result.name),
		tool_call_id: result.tool_call_id,
		name: result.name,
	};

	// A workspace result keeps its structured payload: the converter sends it as
	// JSON, which is the point of the field. An external one carries it inside
	// the frame instead (see `framedBody`), because the converter would prefer
	// the field over `content` and the frame would be bypassed.
	if (!external && result.structuredContent !== undefined) {
		message.structuredContent = result.structuredContent;
	}

	if (result.images && result.images.length > 0) {
		message.images = result.images;
	}

	return message;
}
