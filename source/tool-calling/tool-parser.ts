import {FORMAT_GUIDANCE_MESSAGE} from '@/tool-calling/format-guidance';
import {normalizeWhitespace, removeRanges} from '@/tool-calling/whitespace';
import {XMLToolCallParser} from '@/tool-calling/xml-parser';
import type {ToolCall} from '@/types/index';
import {generateToolCallId} from '@/utils/tool-call-id';
import {ensureString} from '@/utils/type-helpers';

/**
 * Strip  tags from content (some models output thinking that shouldn't be shown)
 */
export function stripThinkTags(content: string): string {
	return (
		content
			// Strip complete  blocks
			.replace(/<think>[\s\S]*?<\/think>/gi, '')
			// Strip orphaned/incomplete think tags
			.replace(/<think>[\s\S]*$/gi, '')
			.replace(/<\/think>/gi, '')
	);
}

/**
 * Result of parsing tool calls from content
 */
type ParseResult =
	| {
			success: true;
			toolCalls: ToolCall[];
			cleanedContent: string;
	  }
	| {
			success: false;
			error: string;
			examples: string;
	  };

const JSON_FENCE_REGEX = /```(?:json)?\s*\n?([\s\S]*?)\n?```/gi;
const JSON_OBJECT_START_REGEX = /\{\s*"(?:name|arguments)"\s*:/g;

// Total characters the inline scans of one reply may read. Scans that fall
// out of step with the quotes of cut-off calls can't be cached and would each
// read to the end of the reply.
const JSON_SCAN_BUDGET_BASE = 1_000_000;
const JSON_SCAN_BUDGET_PER_CHAR = 4;

type JSONScanState = {
	// Where each object a scan has passed ends (null if it never closes), so
	// many unclosed openers cost one scan instead of one each.
	ends: Map<number, number | null>;
	budget: number;
	exhausted: boolean;
};

// Braces inside JSON strings must not end the enclosing tool call.
function findJSONObjectEnd(
	content: string,
	start: number,
	state: JSONScanState,
): number | null {
	const known = state.ends.get(start);
	if (known !== undefined) return known;

	const limit = Math.min(content.length, start + state.budget);
	const openers: number[] = [];
	let inString = false;
	let escaped = false;
	let index = start;

	for (; index < limit; index++) {
		const char = content[index];
		if (inString) {
			if (char === '\n' || char === '\r') {
				// JSON strings can't hold a raw line break, even escaped, so no
				// open object here can parse.
				break;
			}
			if (escaped) {
				escaped = false;
			} else if (char === '\\') {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
		} else if (char === '{') {
			openers.push(index);
		} else if (char === '}') {
			const opener = openers.pop();
			if (opener !== undefined) state.ends.set(opener, index + 1);
			if (openers.length === 0) {
				state.budget -= index + 1 - start;
				return index + 1;
			}
		}
	}

	state.budget -= index - start;
	if (index === limit && limit < content.length) {
		state.exhausted = true;
		return null;
	}
	for (const opener of openers) state.ends.set(opener, null);
	return null;
}

function tryParseJSONToolCall(raw: string): ToolCall | null {
	try {
		const parsed = JSON.parse(raw) as {
			name?: unknown;
			arguments?: unknown;
		};
		if (
			typeof parsed.name !== 'string' ||
			!parsed.name ||
			parsed.arguments === null ||
			typeof parsed.arguments !== 'object' ||
			Array.isArray(parsed.arguments)
		) {
			return null;
		}
		return {
			id: generateToolCallId(),
			function: {
				name: parsed.name,
				arguments: parsed.arguments as Record<string, unknown>,
			},
		};
	} catch {
		return null;
	}
}

/**
 * JSON fallback parser for open-weights models that emit JSON-shaped tool calls
 * instead of XML (the panicked-into-JSON failure mode). Handles markdown-fenced
 * blocks and bare `{"name":..., "arguments":...}` objects. Its calls are only
 * used when the XML and function-tag parsers found none.
 */
function parseJSONToolCalls(content: string): {
	toolCalls: ToolCall[];
	cleanedContent: string;
	ranges: Array<[number, number]>;
	// The scan budget ran out, so calls later in the reply may be missed.
	exhausted: boolean;
} {
	const toolCalls: ToolCall[] = [];
	const matchedRanges: Array<[number, number]> = [];

	let fenceMatch: RegExpExecArray | null;
	const fencePattern = new RegExp(JSON_FENCE_REGEX);
	while ((fenceMatch = fencePattern.exec(content)) !== null) {
		const inner = (fenceMatch[1] ?? '').trim();
		const call = tryParseJSONToolCall(inner);
		if (call) {
			toolCalls.push(call);
			matchedRanges.push([
				fenceMatch.index,
				fenceMatch.index + fenceMatch[0].length,
			]);
		}
	}

	const scan: JSONScanState = {
		ends: new Map(),
		budget: JSON_SCAN_BUDGET_BASE + content.length * JSON_SCAN_BUDGET_PER_CHAR,
		exhausted: false,
	};
	let inlineMatch: RegExpExecArray | null;
	const inlinePattern = new RegExp(JSON_OBJECT_START_REGEX);
	while ((inlineMatch = inlinePattern.exec(content)) !== null) {
		const start = inlineMatch.index;
		if (matchedRanges.some(([s, e]) => start >= s && start < e)) continue;
		const end = findJSONObjectEnd(content, start, scan);
		if (scan.exhausted) break;
		if (end === null) continue;
		const call = tryParseJSONToolCall(content.slice(start, end));
		if (call) {
			toolCalls.push(call);
			matchedRanges.push([start, end]);
			// Skip only past parsed calls: a non-call object can still
			// contain one.
			inlinePattern.lastIndex = end;
		}
	}

	if (toolCalls.length === 0) {
		return {
			toolCalls,
			cleanedContent: content,
			ranges: matchedRanges,
			exhausted: scan.exhausted,
		};
	}

	return {
		toolCalls,
		cleanedContent: removeRanges(content, matchedRanges),
		ranges: matchedRanges,
		exhausted: scan.exhausted,
	};
}

const FUNCTION_TAG_REGEX = /<function=(\w+)>([\s\S]*?)<\/function>/g;

/**
 * Parses Llama 3.x-style `<function=name>{json}</function>` tool calls.
 * Llama 3.1/3.2/3.3 emits this format for zero-shot custom function calling.
 * The opening tag carries the function name; the body is a JSON object with
 * the arguments. Skips matches whose body isn't valid JSON so we don't
 * accidentally consume unrelated text wrapped in similar-looking tags.
 */
function parseFunctionTagToolCalls(content: string): {
	toolCalls: ToolCall[];
	cleanedContent: string;
	ranges: Array<[number, number]>;
} {
	const toolCalls: ToolCall[] = [];
	const matchedRanges: Array<[number, number]> = [];
	const pattern = new RegExp(FUNCTION_TAG_REGEX);

	let match: RegExpExecArray | null;
	while ((match = pattern.exec(content)) !== null) {
		const name = match[1];
		const body = (match[2] ?? '').trim();
		if (!name) continue;

		let args: Record<string, unknown> = {};
		if (body) {
			try {
				const parsed = JSON.parse(body);
				if (
					parsed === null ||
					typeof parsed !== 'object' ||
					Array.isArray(parsed)
				) {
					continue;
				}
				args = parsed as Record<string, unknown>;
			} catch {
				continue;
			}
		}

		toolCalls.push({
			id: generateToolCallId(),
			function: {name, arguments: args},
		});
		matchedRanges.push([match.index, match.index + match[0].length]);
	}

	if (toolCalls.length === 0) {
		return {toolCalls, cleanedContent: content, ranges: matchedRanges};
	}

	return {
		toolCalls,
		cleanedContent: removeRanges(content, matchedRanges),
		ranges: matchedRanges,
	};
}

/**
 * Blank out valid function-tag / JSON tool calls before the XML scan, so XML
 * quoted inside their arguments (e.g. a write_file of docs containing
 * `<execute_bash>...`) is not mistaken for a separate call. Spans enclosed by
 * an XML call are kept: there the JSON is that call's argument.
 */
function maskEmbeddedCalls(
	content: string,
	ranges: Array<[number, number]>,
): string {
	if (ranges.length === 0) return content;
	const xmlRanges = XMLToolCallParser.findToolCallRanges(content);
	let result = content;
	for (const [start, end] of ranges) {
		if (xmlRanges.some(([s, e]) => s <= start && end <= e)) continue;
		result =
			result.slice(0, start) + ' '.repeat(end - start) + result.slice(end);
	}
	return result;
}

const JSON_MALFORMED_PATTERNS: Array<{regex: RegExp; error: string}> = [
	{
		regex:
			/(?:^|\n)\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*"[^"]*"\s*\}/,
		error: 'Invalid tool call: "arguments" must be an object, not a string',
	},
	{
		regex: /(?:^|\n)\s*\{\s*"name"\s*:\s*"[^"]+"\s*,?\s*\}/,
		error: 'Incomplete tool call: missing "arguments" field',
	},
	{
		regex: /(?:^|\n)\s*\{\s*"arguments"\s*:\s*\{[^}]*\}\s*\}/,
		error: 'Incomplete tool call: missing "name" field',
	},
];

function detectMalformedJSONToolCall(
	content: string,
): {error: string; examples: string} | null {
	for (const {regex, error} of JSON_MALFORMED_PATTERNS) {
		if (regex.test(content)) {
			return {error, examples: FORMAT_GUIDANCE_MESSAGE};
		}
	}
	return null;
}

/**
 * Strips XML- and JSON-shaped tool call text from content. Used on the native
 * path when the model emits tool calls via the SDK protocol AND echoes the
 * same call back as text in the assistant message ("Ghost Echo").
 *
 * Caller is expected to gate this on `toolCalls.length > 0` so legitimate
 * prose discussing tool call shapes doesn't get silently erased on turns
 * where the model never actually called a tool.
 */
export function stripEmbeddedToolCallText(content: unknown): string {
	const contentStr = ensureString(content);
	const afterXml = XMLToolCallParser.removeToolCallsFromContent(contentStr);
	const {cleanedContent: afterFnTag} = parseFunctionTagToolCalls(afterXml);
	const {cleanedContent} = parseJSONToolCalls(afterFnTag);
	return normalizeWhitespace(cleanedContent);
}

/**
 * Parses XML tool calls from content (used for non-tool-calling models).
 * Falls back to JSON parsing for open-weights models that revert to JSON-shaped
 * tool calls under reasoning pressure. Only runs on the XML fallback path when
 * native tool calling is disabled.
 * Type-preserving: Accepts unknown type, converts to string for processing.
 */
export function parseToolCalls(content: unknown): ParseResult {
	// 1. Safety Coercion
	const contentStr = ensureString(content);

	// Strip tags first - some models (like GLM-4) emit these for chain-of-thought
	const strippedContent = stripThinkTags(contentStr);

	const fnTagResult = parseFunctionTagToolCalls(strippedContent);
	const jsonResult = parseJSONToolCalls(strippedContent);
	// Unscanned JSON calls can't be masked, so XML quoted in their arguments
	// would run as calls of its own.
	if (jsonResult.exhausted) {
		return {
			success: false,
			error:
				'Too many incomplete JSON tool calls to parse. Send only complete tool calls.',
			examples: FORMAT_GUIDANCE_MESSAGE,
		};
	}
	const xmlContent = maskEmbeddedCalls(strippedContent, [
		...fnTagResult.ranges,
		...jsonResult.ranges,
	]);

	// 2. Try XML parser for valid tool calls (OPTIMISTIC: Success first!)
	if (XMLToolCallParser.hasToolCalls(xmlContent)) {
		// Parse valid XML tool calls
		const parsedCalls = XMLToolCallParser.parseToolCalls(xmlContent);
		const convertedCalls = XMLToolCallParser.convertToToolCalls(parsedCalls);

		if (convertedCalls.length > 0) {
			const cleanedContent =
				XMLToolCallParser.removeToolCallsFromContent(strippedContent);
			return {
				success: true,
				toolCalls: convertedCalls,
				cleanedContent,
			};
		}
	}

	// 3. Try Llama 3.x function-tag fallback: <function=name>{json}</function>
	if (fnTagResult.toolCalls.length > 0) {
		return {
			success: true,
			toolCalls: fnTagResult.toolCalls,
			cleanedContent: normalizeWhitespace(fnTagResult.cleanedContent),
		};
	}

	// 4. Try JSON fallback (open-weights models that emit JSON-shaped tool calls)
	if (jsonResult.toolCalls.length > 0) {
		return {
			success: true,
			toolCalls: jsonResult.toolCalls,
			cleanedContent: normalizeWhitespace(jsonResult.cleanedContent),
		};
	}

	// 4. Check for malformed XML patterns (DEFENSIVE: Error second!)
	const xmlMalformed =
		XMLToolCallParser.detectMalformedToolCall(strippedContent);
	if (xmlMalformed) {
		return {
			success: false,
			error: xmlMalformed.error,
			examples: xmlMalformed.examples,
		};
	}

	// 5. Check for malformed JSON tool call attempts
	const jsonMalformed = detectMalformedJSONToolCall(strippedContent);
	if (jsonMalformed) {
		return {
			success: false,
			error: jsonMalformed.error,
			examples: jsonMalformed.examples,
		};
	}

	// 6. No tool calls found - normalize whitespace in content
	return {
		success: true,
		toolCalls: [],
		cleanedContent: normalizeWhitespace(strippedContent),
	};
}
