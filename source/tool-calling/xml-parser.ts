import type {ToolCall} from '@/types/index';

interface ParsedToolCall {
	toolName: string;
	parameters: Record<string, unknown>;
}

/**
 * Parses XML-formatted tool calls from non-function-calling models
 * Expected format: <tool_name><param1>value1</param1><param2>value2</param2></tool_name>
 */
export class XMLToolCallParser {
	private static readonly TOOL_CALL_REGEX = /<(\w+)>(.*?)<\/\1>/gs;
	private static readonly PARAMETER_REGEX = /<(\w+)>(.*?)<\/\1>/gs;

	/**
	 * Extracts tool calls from text content containing XML-formatted tool calls
	 */
	static parseToolCalls(content: string): ParsedToolCall[] {
		const toolCalls: ParsedToolCall[] = [];
		let match;

		// Handle content that might be wrapped in markdown code blocks
		let processedContent = content;
		const codeBlockMatch = content.match(/```(?:\w+)?\s*\n?([\s\S]*?)\n?```/);
		if (codeBlockMatch && codeBlockMatch[1]) {
			processedContent = codeBlockMatch[1].trim();
		}

		// Remove <tool_call> wrapper tags if present
		processedContent = processedContent.replace(/<\/?tool_call>/g, '').trim();

		// Find all tool call blocks
		this.TOOL_CALL_REGEX.lastIndex = 0; // Reset regex state
		while ((match = this.TOOL_CALL_REGEX.exec(processedContent)) !== null) {
			const [fullMatch, toolName, innerXml] = match;

			// Skip if this is a generic "tool_call" tag that slipped through
			if (toolName === 'tool_call') {
				continue;
			}

			// Validate that this is a properly formed tool call
			if (!this.isValidToolCall(fullMatch, toolName)) {
				continue;
			}

			const parameters = this.parseParameters(innerXml);

			toolCalls.push({
				toolName,
				parameters,
			});
		}

		return toolCalls;
	}

	/**
	 * Validates that a matched string is a proper tool call
	 * Rejects partial matches, malformed syntax, and invalid structures
	 */
	private static isValidToolCall(fullMatch: string, toolName: string): boolean {
		// Reject common HTML tags that might be in model output
		const htmlTags = [
			'div',
			'span',
			'p',
			'a',
			'ul',
			'ol',
			'li',
			'table',
			'tr',
			'td',
			'th',
			'thead',
			'tbody',
			'h1',
			'h2',
			'h3',
			'h4',
			'h5',
			'h6',
			'br',
			'hr',
			'strong',
			'em',
			'code',
			'pre',
			'blockquote',
			'img',
			'section',
			'article',
			'header',
			'footer',
			'nav',
			'aside',
		];
		if (htmlTags.includes(toolName.toLowerCase())) {
			return false;
		}

		// Check for malformed attribute-style syntax like <function=name> or <parameter=name>
		if (fullMatch.includes('=')) {
			return false;
		}

		// Check if the closing tag is properly formed
		if (!fullMatch.endsWith(`</${toolName}>`)) {
			return false;
		}

		// Extract inner content between opening and closing tags
		const innerContent = fullMatch.substring(
			toolName.length + 2,
			fullMatch.length - (toolName.length + 3),
		);

		// Valid tool calls should contain parameter tags (other XML tags inside)
		// This prevents matching on standalone parameter tags from malformed XML
		const hasNestedTags = /<\w+>/.test(innerContent);

		// Tool names should contain underscores (snake_case convention for tools)
		// or be reasonably long compound words
		const hasUnderscore = toolName.includes('_');

		// Allow if it has nested tags OR follows naming convention
		if (!hasNestedTags && !hasUnderscore) {
			return false;
		}

		return true;
	}

	/**
	 * Parses parameters from inner XML content
	 */
	private static parseParameters(innerXml: string): Record<string, unknown> {
		const parameters: Record<string, unknown> = {};
		let match;

		// Reset regex state
		this.PARAMETER_REGEX.lastIndex = 0;

		while ((match = this.PARAMETER_REGEX.exec(innerXml)) !== null) {
			const [, paramName, paramValue] = match;

			// Trim whitespace from parameter value
			const trimmedValue = paramValue.trim();

			// Try to parse as JSON for complex objects/arrays
			try {
				parameters[paramName] = JSON.parse(trimmedValue) as unknown;
			} catch {
				// If not valid JSON, use as string (preserving internal whitespace/newlines)
				parameters[paramName] = trimmedValue;
			}
		}

		return parameters;
	}

	/**
	 * Converts parsed tool calls to the standard ToolCall format
	 */
	static convertToToolCalls(parsedCalls: ParsedToolCall[]): ToolCall[] {
		return parsedCalls.map((call, index) => ({
			id: `xml_call_${index}`,
			function: {
				name: call.toolName,
				arguments: call.parameters,
			},
		}));
	}

	/**
	 * Removes XML tool call blocks from content, leaving only the text
	 */
	static removeToolCallsFromContent(content: string): string {
		let cleanedContent = content;

		// Remove all markdown code blocks that contain XML tool calls (using global flag)
		cleanedContent = cleanedContent.replace(
			/```(?:\w+)?\s*\n?([\s\S]*?)\n?```/g,
			(match, blockContent: string) => {
				if (blockContent) {
					// Reset regex and check if this block contains XML tool calls
					this.TOOL_CALL_REGEX.lastIndex = 0;
					if (this.TOOL_CALL_REGEX.test(blockContent)) {
						// This code block contains XML tool calls, remove it entirely
						return '';
					}
				}
				// Keep blocks that don't contain XML tool calls
				return match;
			},
		);

		// Remove XML tool calls that aren't in code blocks
		this.TOOL_CALL_REGEX.lastIndex = 0;
		cleanedContent = cleanedContent.replace(this.TOOL_CALL_REGEX, '');

		// Remove any <tool_call> wrapper tags that may be left behind
		cleanedContent = cleanedContent.replace(/<\/?tool_call>/g, '');

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

	/**
	 * Checks if content contains XML-formatted tool calls
	 */
	static hasToolCalls(content: string): boolean {
		// Use parseToolCalls with validation to ensure we only detect valid tool calls
		const toolCalls = this.parseToolCalls(content);
		return toolCalls.length > 0;
	}

	/**
	 * Detects malformed XML tool call attempts and returns error details
	 * Returns null if no malformed tool calls detected
	 */
	static detectMalformedToolCall(
		content: string,
	): {error: string; examples: string} | null {
		// Common malformed patterns
		const patterns = [
			{
				// [tool_use: name] or [Tool: name] syntax (common with some models like GLM)
				regex: /\[(?:tool_use|Tool):\s*(\w+)\]/i,
				error:
					'Invalid syntax: [tool_use: name] or [Tool: name] format is not supported',
			},
			{
				// <function=name> syntax
				regex: /<function=(\w+)>/,
				error: 'Invalid syntax: <function=name> is not supported',
			},
			{
				// <parameter=name> syntax
				regex: /<parameter=(\w+)>/,
				error: 'Invalid syntax: <parameter=name> is not supported',
			},
			{
				// Generic closing </parameter> without proper name
				regex: /<parameter=\w+>[\s\S]*?<\/parameter>/,
				error:
					'Invalid parameter syntax: parameters must use named tags, not generic <parameter> wrapper',
			},
			{
				// Generic closing </function> when <function=name> was used
				regex: /<function=\w+>[\s\S]*?<\/function>/,
				error:
					'Invalid function syntax: use simple named tags, not <function=name> wrapper',
			},
		];

		for (const pattern of patterns) {
			const match = content.match(pattern.regex);
			if (match) {
				return {
					error: pattern.error,
					examples: this.getCorrectFormatExamples(),
				};
			}
		}

		return null;
	}

	/**
	 * Generates correct format examples for error messages
	 */
	private static getCorrectFormatExamples(): string {
		return `Please use the native tool calling format provided by the system. The tools are already available to you - call them directly using the function calling interface.`;
	}
}
