import {XMLToolCallParser} from '@/tool-calling/xml-parser';
import type {ToolCall} from '@/types/index';
import {ensureString} from '@/utils/type-helpers';
import {
	cleanJSONToolCalls,
	detectMalformedJSONToolCall,
	parseJSONToolCalls,
} from './json-parser';

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

	// 3. Try targeted JSON fallback for panicked native-tool models
	const jsonToolCalls = parseJSONToolCalls(strippedContent);
	if (jsonToolCalls.length > 0) {
		return {
			success: true,
			toolCalls: jsonToolCalls,
			cleanedContent: cleanJSONToolCalls(strippedContent, jsonToolCalls),
		};
	}

	// 4. Check for malformed JSON or XML patterns (DEFENSIVE: Error second!)
	const jsonMalformed = detectMalformedJSONToolCall(strippedContent);
	if (jsonMalformed) {
		return {
			success: false,
			error: jsonMalformed.error,
			examples: jsonMalformed.examples,
		};
	}

	const xmlMalformed =
		XMLToolCallParser.detectMalformedToolCall(strippedContent);
	if (xmlMalformed) {
		return {
			success: false,
			error: xmlMalformed.error,
			examples: xmlMalformed.examples,
		};
	}

	// 5. No tool calls found - normalize whitespace in content
	return {
		success: true,
		toolCalls: [],
		cleanedContent: normalizeWhitespace(strippedContent),
	};
}

function getToolCallKey(toolCall: ToolCall): string {
	return `${toolCall.function.name}:${JSON.stringify(toolCall.function.arguments)}`;
}

export function dedupeToolCalls(toolCalls: ToolCall[]): ToolCall[] {
	const seen = new Set<string>();
	return toolCalls.filter(toolCall => {
		const key = getToolCallKey(toolCall);
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}
