import {
	cleanJSONToolCalls,
	detectMalformedJSONToolCall,
	parseJSONToolCalls,
} from '@/tool-calling/json-parser';
import {XMLToolCallParser} from '@/tool-calling/xml-parser';
import type {ToolCall} from '@/types/index';
import {ensureString} from '@/utils/type-helpers';

/**
 * Strip  tags from content (some models output thinking that shouldn't be shown)
 */
function stripThinkTags(content: string): string {
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
 * Unified tool call parser that tries XML first, then falls back to JSON
 * Type-preserving: Accepts unknown type, converts to string for processing
 */
export function parseToolCalls(content: unknown): ParseResult {
	// 1. Safety Coercion
	const contentStr = ensureString(content);

	// Strip tags first - some models (like GLM-4) emit these for chain-of-thought
	const strippedContent = stripThinkTags(contentStr);

	// 1. Check for malformed XML patterns first (before validating with hasToolCalls)
	const xmlMalformed =
		XMLToolCallParser.detectMalformedToolCall(strippedContent);
	if (xmlMalformed) {
		return {
			success: false,
			error: xmlMalformed.error,
			examples: xmlMalformed.examples,
		};
	}

	// 2. Try XML parser for valid tool calls
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

	// 3. Fall back to JSON parser
	// FIX: Check for valid JSON tool calls FIRST (optimistic approach)
	// This prevents malformed detection from catching text that's NOT a tool call attempt
	const jsonCalls = parseJSONToolCalls(strippedContent);
	if (jsonCalls.length > 0) {
		const cleanedContent = cleanJSONToolCalls(strippedContent, jsonCalls);
		return {
			success: true,
			toolCalls: jsonCalls,
			cleanedContent,
		};
	}

	// 4. If no valid tools found, check for malformed patterns
	const jsonMalformed = detectMalformedJSONToolCall(strippedContent);
	if (jsonMalformed) {
		return {
			success: false,
			error: jsonMalformed.error,
			examples: jsonMalformed.examples,
		};
	}

	// 5. No tool calls found - still normalize whitespace in content
	return {
		success: true,
		toolCalls: [],
		cleanedContent: normalizeWhitespace(strippedContent),
	};
}
