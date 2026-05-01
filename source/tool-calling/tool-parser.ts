import {XMLToolCallParser} from '@/tool-calling/xml-parser';
import type {ToolCall} from '@/types/index';
import {ensureString} from '@/utils/type-helpers';

type JSONValue =
	| string
	| number
	| boolean
	| null
	| JSONValue[]
	| {[key: string]: JSONValue};

/**
 * Strip <think> tags from content (some models output thinking that shouldn't be shown)
 */
function stripThinkTags(content: string): string {
	return (
		content
			// Strip complete <think> blocks
			.replace(/<think>[\s\S]*?<\/think>/gi, '')
			// Strip orphaned/incomplete think tags
			.replace(/<think>[\s\S]*$/gi, '')
			.replace(/<\/think>/gi, '')
	);
}

/**
 * Normalize whitespace in content to remove excessive blank lines and spacing
 */
function normalizeWhitespace(content: string): string {
	return (
		content
			// Remove trailing whitespace from each line
			.replace(/[ \t]+$/gm, '')
			// Collapse multiple spaces (but not at start of line for indentation)
			.replace(/([^ \t\n]) {2,}/g, '$1 ')
			// Remove lines that are only whitespace
			.replace(/^[ \t]+$/gm, '')
			// Collapse 3+ consecutive newlines to exactly 2 (one blank line)
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeToolName(name: string): string {
	switch (name) {
		case 'create_file':
		case 'write':
		case 'write_tool':
		case 'write_file_text':
		case 'write_to_file_text':
			return 'write_file';
		default:
			return name;
	}
}

function normalizeArguments(
	args: Record<string, unknown>,
): Record<string, unknown> {
	const normalized = {...args};

	if (!('path' in normalized) && typeof normalized.file_path === 'string') {
		normalized.path = normalized.file_path;
	}

	if (!('content' in normalized) && typeof normalized.contents === 'string') {
		normalized.content = normalized.contents;
	}

	delete normalized.file_path;
	delete normalized.contents;

	return normalized;
}

function convertJSONToolCall(
	name: string,
	args: Record<string, unknown>,
	index: number,
): ToolCall {
	return {
		id: `json_call_${index}`,
		function: {
			name: normalizeToolName(name),
			arguments: normalizeArguments(args),
		},
	};
}

function extractToolCallsFromJSONObject(
	value: unknown,
	toolCalls: ToolCall[],
): void {
	if (Array.isArray(value)) {
		for (const item of value) {
			extractToolCallsFromJSONObject(item, toolCalls);
		}
		return;
	}

	if (!isRecord(value)) {
		return;
	}

	if (Array.isArray(value.tool_calls)) {
		extractToolCallsFromJSONObject(value.tool_calls, toolCalls);
		return;
	}

	if (Array.isArray(value.functions)) {
		extractToolCallsFromJSONObject(value.functions, toolCalls);
		return;
	}

	if (isRecord(value.function)) {
		const functionName =
			typeof value.function.name === 'string' ? value.function.name : null;
		const functionArgs = isRecord(value.function.arguments)
			? value.function.arguments
			: null;

		if (functionName && functionArgs) {
			toolCalls.push(
				convertJSONToolCall(functionName, functionArgs, toolCalls.length),
			);
			return;
		}
	}

	if (typeof value.name === 'string') {
		if (isRecord(value.arguments)) {
			toolCalls.push(
				convertJSONToolCall(value.name, value.arguments, toolCalls.length),
			);
			return;
		}

		if (isRecord(value.parameters)) {
			if (
				typeof value.parameters.function === 'string' &&
				isRecord(value.parameters.parameters)
			) {
				toolCalls.push(
					convertJSONToolCall(
						value.parameters.function,
						value.parameters.parameters,
						toolCalls.length,
					),
				);
				return;
			}

			toolCalls.push(
				convertJSONToolCall(value.name, value.parameters, toolCalls.length),
			);
			return;
		}
	}

	if (typeof value.function === 'string' && isRecord(value.parameters)) {
		toolCalls.push(
			convertJSONToolCall(value.function, value.parameters, toolCalls.length),
		);
		return;
	}

	if (typeof value.tool === 'string') {
		const {tool, ...args} = value;
		toolCalls.push(convertJSONToolCall(tool, args, toolCalls.length));
	}
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractJSONToolCalls(content: string): {
	toolCalls: ToolCall[];
	cleanedContent: string;
} | null {
	const toolCalls: ToolCall[] = [];
	const trimmed = content.trim();
	const candidates: Array<{raw: string; inCodeBlock: boolean}> = [];
	const seen = new Set<string>();

	const addCandidate = (raw: string, inCodeBlock: boolean) => {
		const normalized = raw.trim();
		if (!normalized || seen.has(normalized)) {
			return;
		}
		seen.add(normalized);
		candidates.push({raw: normalized, inCodeBlock});
	};

	for (const match of content.matchAll(
		/```(?:json|javascript|js)?\s*\n?([\s\S]*?)\n?```/g,
	)) {
		if (match[1]) {
			addCandidate(match[1], true);
		}
	}

	if (
		(trimmed.startsWith('{') && trimmed.endsWith('}')) ||
		(trimmed.startsWith('[') && trimmed.endsWith(']'))
	) {
		addCandidate(trimmed, false);
	}

	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate.raw) as JSONValue;
			extractToolCallsFromJSONObject(parsed, toolCalls);
			if (toolCalls.length > 0) {
				const cleanedContent = candidate.inCodeBlock
					? normalizeWhitespace(
							content.replace(
								new RegExp(
									`\`\`\`(?:json|javascript|js)?\\s*\\n?${escapeRegExp(candidate.raw)}\\n?\`\`\``,
								),
								'',
							),
						)
					: '';

				return {toolCalls, cleanedContent};
			}
		} catch {
			// Ignore invalid JSON candidates and continue trying others.
		}
	}

	return null;
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

/**
 * Parses XML tool calls from content (used for non-tool-calling models).
 * Only runs on the XML fallback path when native tool calling is disabled.
 * Type-preserving: Accepts unknown type, converts to string for processing.
 */
export function parseToolCalls(content: unknown): ParseResult {
	// 1. Safety Coercion
	const contentStr = ensureString(content);

	// Strip think tags first - some models (like GLM-4) emit these for chain-of-thought
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

	// 2.5 Try structured JSON fallback for local models that ignore the XML-only prompt.
	const jsonResult = extractJSONToolCalls(strippedContent);
	if (jsonResult && jsonResult.toolCalls.length > 0) {
		return {
			success: true,
			toolCalls: jsonResult.toolCalls,
			cleanedContent: jsonResult.cleanedContent,
		};
	}

	// 3. Check for malformed XML patterns (DEFENSIVE: Error second!)
	const xmlMalformed =
		XMLToolCallParser.detectMalformedToolCall(strippedContent);
	if (xmlMalformed) {
		return {
			success: false,
			error: xmlMalformed.error,
			examples: xmlMalformed.examples,
		};
	}

	// 4. No tool calls found - normalize whitespace in content
	return {
		success: true,
		toolCalls: [],
		cleanedContent: normalizeWhitespace(strippedContent),
	};
}
