import {FORMAT_GUIDANCE_MESSAGE} from '@/tool-calling/format-guidance';
import {normalizeWhitespace} from '@/tool-calling/whitespace';
import type {ToolCall} from '@/types/index';
import {generateToolCallId} from '@/utils/tool-call-id';
import {ensureString} from '@/utils/type-helpers';

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
	 * Type-preserving: Accepts unknown type, converts to string for processing
	 */
	static parseToolCalls(content: unknown): ParsedToolCall[] {
		const toolCalls: ParsedToolCall[] = [];
		let match;

		// Process the first fenced block as before, but also retain what follows:
		// a tool call may appear after an ordinary code example.
		let processedContent = ensureString(content);
		const codeBlockMatch = processedContent.match(
			/```(?:\w+)?\s*\n?([\s\S]*?)\n?```/,
		);
		if (
			codeBlockMatch?.[1] &&
			!this.isInsideParameterValue(processedContent, codeBlockMatch.index ?? 0)
		) {
			const afterBlock = (codeBlockMatch.index ?? 0) + codeBlockMatch[0].length;
			processedContent =
				`${codeBlockMatch[1]}\n${processedContent.slice(afterBlock)}`.trim();
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
	 * Returns `[start, end)` offsets of valid XML tool calls in the raw content.
	 */
	static findToolCallRanges(content: string): Array<[number, number]> {
		const ranges: Array<[number, number]> = [];
		const unwrapped = this.blankToolCallWrappers(content);
		const pattern = new RegExp(this.TOOL_CALL_REGEX);
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(unwrapped)) !== null) {
			const [fullMatch, toolName] = match;
			if (this.isValidToolCall(fullMatch, toolName)) {
				ranges.push([match.index, match.index + fullMatch.length]);
			} else {
				// A rejected wrapper such as <div> may still enclose a real call.
				pattern.lastIndex = match.index + 1;
			}
		}
		return ranges;
	}

	// Same-length blanking keeps offsets aligned with the caller's content.
	private static blankToolCallWrappers(content: string): string {
		return content.replace(/<\/?tool_call>/g, tag => ' '.repeat(tag.length));
	}

	private static isInsideParameterValue(
		content: string,
		index: number,
	): boolean {
		// A call around the index opens a tag before it and closes that tag
		// after it; checking this first spares most fences the full scan.
		const closedAfter = new Set(
			Array.from(content.slice(index).matchAll(/<\/(\w+)>/g), m => m[1]),
		);
		const openedBefore = Array.from(
			content.slice(0, index).matchAll(/<(\w+)>/g),
			m => m[1],
		);
		if (!openedBefore.some(name => closedAfter.has(name))) return false;
		const unwrapped = this.blankToolCallWrappers(content);
		for (const [start, end] of this.findToolCallRanges(unwrapped)) {
			if (index < start || index >= end) continue;
			const openTagLength = unwrapped.indexOf('>', start) - start + 1;
			const innerStart = start + openTagLength;
			const inner = unwrapped.slice(innerStart, end - (openTagLength + 1));
			const pattern = new RegExp(this.PARAMETER_REGEX);
			let match: RegExpExecArray | null;
			while ((match = pattern.exec(inner)) !== null) {
				const valueStart = innerStart + match.index + match[1].length + 2;
				if (index >= valueStart && index < valueStart + match[2].length) {
					return true;
				}
			}
		}
		return false;
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

		// Check if the closing tag is properly formed
		if (!fullMatch.endsWith(`</${toolName}>`)) {
			return false;
		}

		// Extract inner content between opening and closing tags
		const innerContent = fullMatch.substring(
			toolName.length + 2,
			fullMatch.length - (toolName.length + 3),
		);

		// An `=` between parameters is attribute-style syntax such as
		// <path=a.ts>; inside a parameter value it is ordinary content.
		const parameterSyntax = innerContent.replace(
			new RegExp(this.PARAMETER_REGEX),
			'',
		);
		if (parameterSyntax.includes('=')) {
			return false;
		}

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
		return parsedCalls.map(call => ({
			id: generateToolCallId(),
			function: {
				name: call.toolName,
				arguments: call.parameters,
			},
		}));
	}

	/**
	 * Removes XML tool call blocks from content, leaving only the text
	 * Type-preserving: Accepts unknown type, converts to string for processing
	 */
	static removeToolCallsFromContent(content: unknown): string {
		let cleanedContent = ensureString(content);

		// Remove all markdown code blocks that contain XML tool calls (using global flag)
		cleanedContent = cleanedContent.replace(
			/```(?:\w+)?\s*\n?([\s\S]*?)\n?```/g,
			(match, blockContent: string) => {
				if (blockContent) {
					// Reset regex and check if this block contains XML tool calls
					this.TOOL_CALL_REGEX.lastIndex = 0;
					const testResult = this.TOOL_CALL_REGEX.test(blockContent);
					this.TOOL_CALL_REGEX.lastIndex = 0; // Reset again after test
					if (testResult) {
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
		return normalizeWhitespace(cleanedContent);
	}

	/**
	 * Checks if content contains XML-formatted tool calls
	 * Type-preserving: Accepts unknown type, converts to string for processing
	 */
	static hasToolCalls(content: unknown): boolean {
		// Use parseToolCalls with validation to ensure we only detect valid tool calls
		const toolCalls = this.parseToolCalls(content);
		return toolCalls.length > 0;
	}

	/**
	 * Detects malformed XML tool call attempts and returns error details
	 * Returns null if no malformed tool calls detected
	 * Type-preserving: Accepts unknown type, converts to string for processing
	 */
	static detectMalformedToolCall(
		content: unknown,
	): {error: string; examples: string} | null {
		// Type guard: ensure content is string for processing operations
		// BUT original type is preserved in memory via the ToolCall structure
		const contentStr = ensureString(content);
		// Common malformed patterns
		const patterns = [
			{
				// [tool_use: name] or [Tool: name] syntax (common with some models like GLM)
				regex: /\[(?:tool_use|Tool):\s*(\w+)\]/i,
				error:
					'Invalid syntax: [tool_use: name] or [Tool: name] format is not supported',
			},
			{
				// <parameter=name> syntax — partial structure from a model that
				// started building a function-call wrapper but didn't include
				// JSON args. <function=name>{json}</function> is parsed as a
				// real Llama 3.x tool call before this branch runs.
				regex: /<parameter=(\w+)>/,
				error: 'Invalid syntax: <parameter=name> is not supported',
			},
			{
				// Generic closing </parameter> without proper name
				regex: /<parameter=\w+>[\s\S]*?<\/parameter>/,
				error:
					'Invalid parameter syntax: parameters must use named tags, not generic <parameter> wrapper',
			},
		];

		for (const pattern of patterns) {
			const match = contentStr.match(pattern.regex);
			if (match) {
				return {
					error: pattern.error,
					examples: FORMAT_GUIDANCE_MESSAGE,
				};
			}
		}

		return null;
	}
}
