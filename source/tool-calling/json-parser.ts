import type {ToolCall} from '@/types/index';

/**
 * Internal JSON tool call parser
 * Note: This is now an internal utility. Use tool-parser.ts for public API.
 */

/**
 * Detects malformed JSON tool call attempts and returns error details
 * Returns null if no malformed tool calls detected
 */
export function detectMalformedJSONToolCall(
	content: string,
): {error: string; examples: string} | null {
	// Check for incomplete JSON structures
	const patterns = [
		{
			// Incomplete JSON with name but missing arguments
			regex: /\{\s*"name"\s*:\s*"[^"]+"\s*,?\s*\}/,
			error: 'Incomplete tool call: missing "arguments" field',
			hint: 'Tool calls must include both "name" and "arguments" fields',
		},
		{
			// Incomplete JSON with arguments but missing name
			regex: /\{\s*"arguments"\s*:\s*\{[^}]*\}\s*\}/,
			error: 'Incomplete tool call: missing "name" field',
			hint: 'Tool calls must include both "name" and "arguments" fields',
		},
		{
			// Malformed arguments (not an object)
			regex: /\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*"[^"]*"\s*\}/,
			error: 'Invalid tool call: "arguments" must be an object, not a string',
			hint: 'Use {"name": "tool_name", "arguments": {...}} format',
		},
	];

	for (const pattern of patterns) {
		const match = content.match(pattern.regex);
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
 * This is an internal function - use tool-parser.ts for public API
 */
export function parseJSONToolCalls(content: string): ToolCall[] {
	const extractedCalls: ToolCall[] = [];
	let trimmedContent = content.trim();

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
				const toolCall = {
					id: `call_${Date.now()}`,
					function: {
						name: parsed.name || '',
						arguments: parsed.arguments || {},
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
	while ((jsonMatch = jsonBlockRegex.exec(content)) !== null) {
		try {
			const parsed = JSON.parse(jsonMatch[0]) as {
				name?: string;
				arguments?: Record<string, unknown>;
			};
			if (parsed.name && parsed.arguments !== undefined) {
				const toolCall = {
					id: `call_${Date.now()}_${extractedCalls.length}`,
					function: {
						name: parsed.name || '',
						arguments: parsed.arguments || {},
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
		/\{"name":\s*"([^"]+)",\s*"arguments":\s*\{[\s\S]*?\}\}/g,
	];

	for (const pattern of toolCallPatterns) {
		let match;
		while ((match = pattern.exec(content)) !== null) {
			const [, name, argsStr] = match;
			try {
				let args: Record<string, unknown> | string;
				if (argsStr && argsStr.startsWith('{')) {
					args = JSON.parse(argsStr || '{}') as Record<string, unknown>;
				} else {
					args = argsStr || '';
				}
				extractedCalls.push({
					id: `call_${Date.now()}_${extractedCalls.length}`,
					function: {
						name: name || '',
						arguments: args as Record<string, unknown>,
					},
				});
			} catch {
				// Failed to parse - will be caught by malformed detection
			}
		}
	}

	return extractedCalls;
}

/**
 * Cleans content by removing tool call JSON blocks
 * This is an internal function - use tool-parser.ts for public API
 */
export function cleanJSONToolCalls(
	content: string,
	toolCalls: ToolCall[],
): string {
	if (toolCalls.length === 0) return content;

	let cleanedContent = content;

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
		/\{"name":\s*"([^"]+)",\s*"arguments":\s*(\{[^}]*\})\}/g,
		/\{"name":\s*"([^"]+)",\s*"arguments":\s*(\{[^}]+\})\}/g,
		/\{"name":\s*"([^"]+)",\s*"arguments":\s*"([^"]+)"\}/g,
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
