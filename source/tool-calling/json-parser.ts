import type {ToolCall} from '@/types/index';
import {ensureString} from '@/utils/type-helpers';

/**
 * Internal JSON tool call parser
 * Note: This is now an internal utility. Use tool-parser.ts for public API.
 * Type-preserving: Preserves object types in memory while converting to string for processing
 */

/**
 * Detects malformed JSON tool call attempts and returns error details
 * Returns null if no malformed tool calls detected
 * Type-preserving: Accepts unknown type, converts to string for processing
 */
export function detectMalformedJSONToolCall(
	content: unknown,
): {error: string; examples: string} | null {
	// Type guard: ensure content is string for processing operations
	// BUT original type is preserved in memory via the ToolCall structure
	const contentStr = ensureString(content);

	// Check for incomplete JSON structures
	// FIX: Anchor to line start (?:^|\n) to avoid matching inline text like "I tried {"name":...}"
	const patterns = [
		{
			// Incomplete JSON with name but missing arguments
			// Anchored to line start or after newline
			regex: /(?:^|\n)\s*\{\s*"name"\s*:\s*"[^"]+"\s*,?\s*\}/,
			error: 'Incomplete tool call: missing "arguments" field',
			hint: 'Tool calls must include both "name" and "arguments" fields',
		},
		{
			// Incomplete JSON with arguments but missing name
			// Anchored to line start or after newline
			regex: /(?:^|\n)\s*\{\s*"arguments"\s*:\s*\{[^}]*\}\s*\}/,
			error: 'Incomplete tool call: missing "name" field',
			hint: 'Tool calls must include both "name" and "arguments" fields',
		},
		{
			// Malformed arguments (not an object)
			// Anchored to line start or after newline
			regex:
				/(?:^|\n)\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*"[^"]*"\s*\}/,
			error: 'Invalid tool call: "arguments" must be an object, not a string',
			hint: 'Use {"name": "tool_name", "arguments": {...}} format',
		},
	];

	for (const pattern of patterns) {
		const match = contentStr.match(pattern.regex);
		if (match) {
			return {
				error: pattern.error,
				examples: getCorrectJSONFormatExamples(pattern.hint),
			};
		}
	}

	return null;
}

/**
 * Generates correct format examples for JSON error messages
 */
function getCorrectJSONFormatExamples(_specificHint: string): string {
	return `Please use the native tool calling format provided by the system. The tools are already available to you - call them directly using the function calling interface.`;
}

/**
 * Parses JSON-formatted tool calls from content
 * Type-preserving: Preserves object types in memory while converting to string for processing
 * This is an internal function - use tool-parser.ts for public API
 */
export function parseJSONToolCalls(content: unknown): ToolCall[] {
	// Convert to string for processing (this is done by the Formatter before calling this)
	const contentStr = ensureString(content);

	const extractedCalls: ToolCall[] = [];
	let trimmedContent = contentStr.trim();

	// Handle markdown code blocks
	const codeBlockMatch = trimmedContent.match(
		/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/,
	);
	if (codeBlockMatch && codeBlockMatch[1]) {
		trimmedContent = codeBlockMatch[1].trim();
	}

	// Try to parse entire content as single JSON tool call
	if (trimmedContent.startsWith('{') && trimmedContent.endsWith('}')) {
		// Skip empty or nearly empty JSON objects
		if (trimmedContent === '{}' || trimmedContent.replace(/\s/g, '') === '{}') {
			return extractedCalls;
		}

		try {
			const parsed = JSON.parse(trimmedContent) as {
				name?: string;
				arguments?: Record<string, unknown>;
			};

			if (parsed.name && parsed.arguments !== undefined) {
				// Reject null, undefined, or non-object arguments
				if (
					parsed.arguments === null ||
					typeof parsed.arguments !== 'object' ||
					Array.isArray(parsed.arguments)
				) {
					return extractedCalls;
				}
				const toolCall = {
					id: `call_${Date.now()}`,
					function: {
						name: parsed.name || '',
						arguments: parsed.arguments, // Type preserved in memory!
					},
				};
				extractedCalls.push(toolCall);
				return extractedCalls;
			}
		} catch {
			// Failed to parse - will be caught by malformed detection
		}
	}

	// Look for standalone JSON blocks in the content (multiline without code blocks)
	const jsonBlockRegex =
		/\{\s*\n\s*"name":\s*"([^"]+)",\s*\n\s*"arguments":\s*\{[\s\S]*?\}\s*\n\s*\}/g;
	let jsonMatch;
	while ((jsonMatch = jsonBlockRegex.exec(contentStr)) !== null) {
		try {
			const parsed = JSON.parse(jsonMatch[0]) as {
				name?: string;
				arguments?: Record<string, unknown>;
			};
			if (parsed.name && parsed.arguments !== undefined) {
				// Reject null, undefined, or non-object arguments
				if (
					parsed.arguments === null ||
					typeof parsed.arguments !== 'object' ||
					Array.isArray(parsed.arguments)
				) {
					continue;
				}
				const toolCall = {
					id: `call_${Date.now()}_${extractedCalls.length}`,
					function: {
						name: parsed.name || '',
						arguments: parsed.arguments, // Type preserved in memory!
					},
				};
				extractedCalls.push(toolCall);
			}
		} catch {
			// Failed to parse - will be caught by malformed detection
		}
	}

	// Look for embedded tool calls using regex patterns
	const toolCallPatterns = [
		/\{"name":\s*"([^"]+)",\s*"arguments":\s*(\{[\s\S]*?\})\}/g,
	];

	for (const pattern of toolCallPatterns) {
		let match;
		while ((match = pattern.exec(contentStr)) !== null) {
			const [, name, argsStr] = match;
			try {
				let args: Record<string, unknown> | null = null;
				// Only parse if arguments is a JSON object
				if (argsStr && argsStr.startsWith('{')) {
					const parsed = JSON.parse(argsStr || '{}');
					// Ensure arguments is a non-null object (not null, undefined, primitive, or array)
					if (
						parsed !== null &&
						typeof parsed === 'object' &&
						!Array.isArray(parsed)
					) {
						args = parsed as Record<string, unknown>; // Type preserved in memory!
					}
				}
				// Only add tool call if we have a valid object
				if (args !== null) {
					extractedCalls.push({
						id: `call_${Date.now()}_${extractedCalls.length}`,
						function: {
							name: name || '',
							arguments: args, // Type preserved in memory!
						},
					});
				}
			} catch {
				// Failed to parse - skip this tool call
			}
		}
	}

	return extractedCalls;
}

/**
 * Cleans content by removing tool call JSON blocks
 * Type-preserving: Accepts unknown type, converts to string for processing
 * This is an internal function - use tool-parser.ts for public API
 */
export function cleanJSONToolCalls(
	content: unknown,
	toolCalls: ToolCall[],
): string {
	// Type guard: ensure content is string for processing operations
	// BUT original type is preserved in memory via the ToolCall structure
	const contentStr = ensureString(content);

	if (toolCalls.length === 0) return contentStr;

	let cleanedContent = contentStr;

	// Handle markdown code blocks that contain only tool calls
	const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/g;
	cleanedContent = cleanedContent.replace(
		codeBlockRegex,
		(match, blockContent: string) => {
			const trimmedBlock = blockContent.trim();

			// Check if this block contains a tool call that we parsed
			try {
				const parsed = JSON.parse(trimmedBlock) as {
					name?: string;
					arguments?: unknown;
				};
				if (parsed.name && parsed.arguments !== undefined) {
					// This code block contains only a tool call, remove the entire block
					return '';
				}
			} catch {
				// Not valid JSON, keep the code block
			}

			// Keep the code block as-is if it doesn't contain a tool call
			return match;
		},
	);

	// Remove JSON blocks that were parsed as tool calls (for non-code-block cases)
	const toolCallPatterns = [
		/\{\s*\n\s*"name":\s*"([^"]+)",\s*\n\s*"arguments":\s*\{[\s\S]*?\}\s*\n\s*\}/g, // Multiline JSON blocks
		/\{"name":\s*"([^"]+)",\s*"arguments":\s*(\{[\s\S]*?\})\}/g, // Consolidated inline pattern
	];

	for (const pattern of toolCallPatterns) {
		cleanedContent = cleanedContent.replace(pattern, '');
	}

	// Clean up whitespace artifacts left by removed tool calls
	cleanedContent = cleanedContent
		// Remove trailing whitespace from each line
		.replace(/[ \t]+$/gm, '')
		// Collapse multiple spaces (but not at start of line for indentation)
		.replace(/([^ \t\n]) {2,}/g, '$1 ')
		// Remove lines that are only whitespace
		.replace(/^[ \t]+$/gm, '')
		// Collapse 2+ consecutive blank lines to a single blank line
		.replace(/\n{3,}/g, '\n\n')
		.trim();

	return cleanedContent;
}
