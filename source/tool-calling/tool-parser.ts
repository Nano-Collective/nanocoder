import type {ToolCall} from '@/types/index';
import {XMLToolCallParser} from '@/tool-calling/xml-parser';
import {
	parseJSONToolCalls,
	cleanJSONToolCalls,
	detectMalformedJSONToolCall,
} from '@/tool-calling/json-parser';

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
 * Unified tool call parser that tries XML first, then falls back to JSON
 * Returns errors for malformed tool calls instead of silently failing
 */
export function parseToolCalls(content: string): ParseResult {
	// 1. Check for malformed XML patterns first (before validating with hasToolCalls)
	const xmlMalformed = XMLToolCallParser.detectMalformedToolCall(content);
	if (xmlMalformed) {
		return {
			success: false,
			error: xmlMalformed.error,
			examples: xmlMalformed.examples,
		};
	}

	// 2. Try XML parser for valid tool calls
	if (XMLToolCallParser.hasToolCalls(content)) {
		// Parse valid XML tool calls
		const parsedCalls = XMLToolCallParser.parseToolCalls(content);
		const convertedCalls = XMLToolCallParser.convertToToolCalls(parsedCalls);

		if (convertedCalls.length > 0) {
			const cleanedContent =
				XMLToolCallParser.removeToolCallsFromContent(content);
			return {
				success: true,
				toolCalls: convertedCalls,
				cleanedContent,
			};
		}
	}

	// 3. Fall back to JSON parser
	// Check for malformed JSON tool calls
	const jsonMalformed = detectMalformedJSONToolCall(content);
	if (jsonMalformed) {
		return {
			success: false,
			error: jsonMalformed.error,
			examples: jsonMalformed.examples,
		};
	}

	// Parse valid JSON tool calls
	const jsonCalls = parseJSONToolCalls(content);
	if (jsonCalls.length > 0) {
		const cleanedContent = cleanJSONToolCalls(content, jsonCalls);
		return {
			success: true,
			toolCalls: jsonCalls,
			cleanedContent,
		};
	}

	// 4. No tool calls found - still normalize whitespace in content
	return {
		success: true,
		toolCalls: [],
		cleanedContent: normalizeWhitespace(content),
	};
}
