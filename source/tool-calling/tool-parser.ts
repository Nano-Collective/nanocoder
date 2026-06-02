import {normalizeWhitespace, removeRanges} from '@/tool-calling/whitespace';
import {XMLToolCallParser} from '@/tool-calling/xml-parser';
import type {ToolCall} from '@/types/index';
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
const JSON_INLINE_REGEX =
	/\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/g;

function tryParseJSONToolCall(raw: string, index: number): ToolCall | null {
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
			id: `call_${Date.now()}_${index}`,
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
 * blocks and bare `{"name":..., "arguments":...}` objects. Only runs when the
 * XML parser found no tool calls.
 */
function parseJSONToolCalls(content: string): {
	toolCalls: ToolCall[];
	cleanedContent: string;
} {
	const toolCalls: ToolCall[] = [];
	const matchedRanges: Array<[number, number]> = [];

	let fenceMatch: RegExpExecArray | null;
	const fencePattern = new RegExp(JSON_FENCE_REGEX);
	while ((fenceMatch = fencePattern.exec(content)) !== null) {
		const inner = (fenceMatch[1] ?? '').trim();
		const call = tryParseJSONToolCall(inner, toolCalls.length);
		if (call) {
			toolCalls.push(call);
			matchedRanges.push([
				fenceMatch.index,
				fenceMatch.index + fenceMatch[0].length,
			]);
		}
	}

	let inlineMatch: RegExpExecArray | null;
	const inlinePattern = new RegExp(JSON_INLINE_REGEX);
	while ((inlineMatch = inlinePattern.exec(content)) !== null) {
		const start = inlineMatch.index;
		if (matchedRanges.some(([s, e]) => start >= s && start < e)) continue;
		const call = tryParseJSONToolCall(inlineMatch[0], toolCalls.length);
		if (call) {
			toolCalls.push(call);
			matchedRanges.push([start, start + inlineMatch[0].length]);
		}
	}

	if (toolCalls.length === 0) {
		return {toolCalls, cleanedContent: content};
	}

	return {toolCalls, cleanedContent: removeRanges(content, matchedRanges)};
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
			id: `call_${Date.now()}_${toolCalls.length}`,
			function: {name, arguments: args},
		});
		matchedRanges.push([match.index, match.index + match[0].length]);
	}

	if (toolCalls.length === 0) {
		return {toolCalls, cleanedContent: content};
	}

	return {toolCalls, cleanedContent: removeRanges(content, matchedRanges)};
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

const JSON_FORMAT_GUIDANCE =
	'Please use the native tool calling format provided by the system. The tools are already available to you - call them directly using the function calling interface.';

function detectMalformedJSONToolCall(
	content: string,
): {error: string; examples: string} | null {
	for (const {regex, error} of JSON_MALFORMED_PATTERNS) {
		if (regex.test(content)) {
			return {error, examples: JSON_FORMAT_GUIDANCE};
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

	// 2. Try XML parser for valid tool calls (OPTIMISTIC: Success first!)
	if (XMLToolCallParser.hasToolCalls(strippedContent)) {
		// Parse valid XML tool calls
		const parsedCalls = XMLToolCallParser.parseToolCalls(strippedContent);
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
	const fnTagResult = parseFunctionTagToolCalls(strippedContent);
	if (fnTagResult.toolCalls.length > 0) {
		return {
			success: true,
			toolCalls: fnTagResult.toolCalls,
			cleanedContent: normalizeWhitespace(fnTagResult.cleanedContent),
		};
	}

	// 4. Try JSON fallback (open-weights models that emit JSON-shaped tool calls)
	const jsonResult = parseJSONToolCalls(strippedContent);
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
