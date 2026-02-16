// source/utils/response-formatter.ts

/**
 * TYPE PRESERVATION STRATEGY EXPLAINED
 * =====================================
 *
 * "Preserving types" does NOT mean keeping everything as objects/arrays in memory.
 * It means:
 *
 * 1. When receiving LLM responses (which can be ANY type):
 *    - We accept unknown types (string, object, array, null, undefined)
 *    - We convert to string ONLY for PARSING OPERATIONS
 *    - We preserve the original type in the tool call structure
 *
 * 2. When storing ToolCall.arguments:
 *    - MUST preserve as Record<string, unknown> (object type)
 *    - NOT convert to string
 *    - Enables direct property access without JSON.parse
 *
 * 3. When displaying/writing to disk:
 *    - Convert to string for display/storage operations
 *    - Use JSON.stringify for objects/arrays
 *    - Use String() for primitives
 *
 * The confusion comes from mixing up:
 * - "Preserve types in memory" (CRITICAL: ToolCall.arguments stays as object)
 * - "Convert to string for processing" (NECESSARY: Parser expects strings)
 *
 * This formatter handles the INCOMING data, then the parser handles the
 * conversion to ToolCall format with type preservation.
 */

import type {ToolCall} from '@/types/index';

// ============================================================================
// RESPONSE NORMALIZATION STRATEGY
// ============================================================================

/**
 * Result of normalizing an LLM response
 * Contains the raw response, processed content, extracted tool calls, and metadata
 */
export interface NormalizedResponse {
	/** The original response from the LLM (unknown type for maximum flexibility) */
	raw: unknown;

	/** The content after normalization (always a string for parsing) */
	content: string;

	/** Any tool calls extracted during normalization */
	toolCalls: ToolCall[];

	/** Metadata about the response for debugging and strategy selection */
	metadata: ResponseMetadata;
}

/**
 * Metadata about the normalized response
 * Used for:
 * - Debugging and logging
 * - Selecting the best parsing strategy
 * - Error handling and recovery
 */
export interface ResponseMetadata {
	/** Whether response contained markdown code blocks */
	hasCodeBlocks: boolean;

	/** Whether response contained XML tags */
	hasXMLTags: boolean;

	/** Whether response contained JSON tool call structures */
	hasJSONBlocks: boolean;

	/** Whether this is a streaming chunk */
	isStreaming: boolean;

	/** Confidence level in the response type classification */
	confidence: 'high' | 'medium' | 'low';

	/** Detected response format */
	detectedFormat: 'plain' | 'json' | 'xml' | 'mixed' | 'unknown';

	/** Whether response appears to be malformed */
	isMalformed: boolean;

	/** Detected error if malformed */
	malformedError?: string;
}

// ============================================================================
// NORMALIZATION FUNCTIONS
// ============================================================================

/**
 * Main entry point for normalizing LLM responses
 *
 * This function handles all possible LLM response types:
 * - Plain strings (most common)
 * - JSON objects (with/without tool_calls field)
 * - Arrays (line-based content)
 * - Null/undefined (error responses)
 * - Mixed content (text + tool calls embedded)
 *
 * @param response - The raw response from the LLM (can be any type)
 * @param options - Configuration options
 * @returns A normalized response with content and extracted tool calls
 */
export async function normalizeLLMResponse(
	response: unknown,
	options: NormalizeOptions = {},
): Promise<NormalizedResponse> {
	const {
		preserveRawTypes = false, // If true, keeps object structure instead of JSON.stringify
		allowMixedContent = true, // If true, extracts tool calls from mixed content
		detectStreaming = false, // If true, treats as streaming chunk
	} = options;

	// Step 1: Detect response type and convert to string for parsing
	const {content, detectedFormat} = convertToProcessableString(response);

	// Step 2: Extract tool calls from the content
	const {toolCalls, malformedError} = await extractToolCalls(content, {
		allowMixedContent,
		detectedFormat,
	});

	// Step 3: Detect if response is malformed
	const isMalformed = !toolCalls.length && hasMalformedPatterns(content);

	// Step 4: Build metadata for debugging and strategy selection
	// Check for JSON blocks in content - only match tool call patterns, not plain JSON objects
	const hasCodeBlocks = /```/.test(content);
	const hasJSONBlocks = /"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{/.test(
		content,
	);

	const metadata = buildMetadata(content, {
		hasCodeBlocks,
		hasXMLTags: /<[^>]+>/.test(content),
		hasJSONBlocks,
		isStreaming: detectStreaming,
		detectedFormat,
		malformedError,
		isMalformed,
	});

	return {
		raw: preserveRawTypes ? response : undefined, // Only preserve if requested
		content,
		toolCalls,
		metadata,
	};
}

/**
 * Converts any LLM response type to a string suitable for parsing
 *
 * Handles the following cases:
 * 1. string → string (identity, already processable)
 * 2. object → JSON.stringify (structured data)
 * 3. array → JSON.stringify (array data)
 * 4. null/undefined → empty string (error handling)
 * 5. number/boolean → String() (primitive types)
 *
 * This conversion is NECESSARY because our parsers expect strings.
 * The type preservation happens later in the ToolCall structure.
 *
 * @param response - Raw response from LLM (any type)
 * @returns Object with processable string content and detected format
 */
function convertToProcessableString(response: unknown): {
	content: string;
	detectedFormat: 'plain' | 'json' | 'xml' | 'mixed';
} {
	let content: string;
	let detectedFormat: 'plain' | 'json' | 'xml' | 'mixed' = 'plain';

	// CASE 1: Plain string response (most common)
	if (typeof response === 'string') {
		content = response.trim();

		// Check if it looks like a JSON structure
		if (content.startsWith('{') && content.endsWith('}')) {
			detectedFormat = 'json';
			// Don't JSON.stringify a string that's already JSON - just use it as-is
			// The parser will parse it correctly
		}
		// Check if it looks like XML
		else if (content.startsWith('<') && content.endsWith('>')) {
			detectedFormat = 'xml';
			// Don't JSON.stringify a string that's already XML - just use it as-is
			// The parser will parse it correctly
		}
		// Check for mixed content (text + tool calls)
		else if (hasEmbeddedToolCallPatterns(content)) {
			detectedFormat = 'mixed';
			// Don't JSON.stringify - keep as plain string for parser to handle
		}
	}
	// CASE 2: JSON object response (structured data)
	else if (response !== null && typeof response === 'object') {
		// Check if it has a tool_calls field (AI SDK format)
		if ('tool_calls' in response || 'function' in response) {
			detectedFormat = 'json';

			// If it's already structured, we might not need JSON.stringify
			// But for consistency with parsers, we still convert to string
			content = JSON.stringify(response);
		}
		// Regular object (not a tool_calls response)
		else {
			detectedFormat = 'json';
			content = JSON.stringify(response);
		}
	}
	// CASE 3: Array response (line-based content)
	else if (Array.isArray(response)) {
		detectedFormat = 'mixed';
		content = response.join('\n').trim();
	}
	// CASE 4: Primitives (number, boolean, null, undefined)
	else {
		// Convert primitives to strings
		content = String(response);
		// Empty string if null or undefined
		if (response === null || response === undefined) {
			content = '';
		}
	}

	return {content, detectedFormat};
}

/**
 * Extracts tool calls from normalized content
 *
 * This function uses the unified parser to extract tool calls from:
 * - Plain text with embedded JSON/XML tool calls
 * - JSON objects with tool_calls field
 * - Mixed content (text + tool calls)
 *
 * @param content - Normalized content string
 * @param options - Extraction options
 * @returns Object with extracted tool calls and any malformed error
 */
async function extractToolCalls(
	content: string,
	options: ExtractOptions,
): Promise<{toolCalls: ToolCall[]; malformedError?: string}> {
	const {allowMixedContent, detectedFormat} = options;

	// If no content, no tool calls
	if (!content) {
		return {toolCalls: []};
	}

	// CASE 1: Detected JSON format - try JSON parser
	if (detectedFormat === 'json') {
		try {
			// Import here to avoid circular dependencies
			const {parseJSONToolCalls} = await import('@/tool-calling/json-parser');
			const toolCalls = parseJSONToolCalls(content);

			if (toolCalls.length > 0) {
				return {toolCalls};
			}
		} catch (error) {
			// If JSON parsing fails, fall through to mixed content handling
			console.warn('JSON parsing failed, trying mixed content:', error);
		}
	}

	// CASE 2: Try XML parser
	try {
		const {XMLToolCallParser} = await import('@/tool-calling/xml-parser');

		// Check for malformed XML first
		const malformedError = XMLToolCallParser.detectMalformedToolCall(content);
		if (malformedError) {
			return {toolCalls: [], malformedError: malformedError.error};
		}

		// Check if has XML tool calls
		if (XMLToolCallParser.hasToolCalls(content)) {
			const parsedCalls = XMLToolCallParser.parseToolCalls(content);
			const toolCalls = XMLToolCallParser.convertToToolCalls(parsedCalls);

			if (toolCalls.length > 0) {
				return {toolCalls};
			}
		}
	} catch (error) {
		// XML parsing failed, continue
		console.warn('XML parsing failed:', error);
	}

	// CASE 3: Mixed content - use unified parser
	if (allowMixedContent) {
		try {
			const {parseToolCalls} = await import('@/tool-calling/tool-parser');
			const result = parseToolCalls(content);

			if (result.success && result.toolCalls.length > 0) {
				return {toolCalls: result.toolCalls};
			}

			if (!result.success) {
				return {toolCalls: [], malformedError: result.error};
			}
		} catch (error) {
			// Parsing failed, return empty tool calls
			console.warn('Mixed content parsing failed:', error);
		}
	}

	// No tool calls found
	return {toolCalls: []};
}

/**
 * Detects if content contains malformed patterns
 *
 * Malformed patterns include:
 * - Incomplete JSON (missing fields)
 * - Invalid XML syntax
 * - Completely invalid JSON (unquoted strings, missing colons, etc.)
 * - Non-standard tool call formats
 *
 * @param content - Content to check
 * @returns True if malformed patterns detected
 */
function hasMalformedPatterns(content: string): boolean {
	const trimmed = content.trim();

	// Check for empty JSON object (not a valid tool call)
	if (trimmed === '{}' || trimmed === '{\n}' || trimmed === '{\t}') {
		return true;
	}

	// Check for completely invalid JSON (e.g., "{invalid json}")
	// This pattern looks for JSON that has { and } but contains unquoted strings
	// or other syntax errors
	const invalidJSONRegex = /^\s*\{[^}]*\w+[^}]*\}\s*$/s;
	if (invalidJSONRegex.test(trimmed)) {
		return true;
	}

	// Check for malformed JSON patterns
	// These patterns should only match truly malformed JSON, not valid tool calls
	const malformedJSONPatterns = [
		/^\s*\{\s*"name"\s*:\s*"[^"]+"\s*\}\s*$/, // name only, no arguments
		/^\s*\{\s*"arguments"\s*:\s*\}\s*$/, // arguments only, no name
		/"arguments"\s*:\s*null\s*([,}\s]*$)/s, // arguments as JSON null (followed by comma, brace, or end)
		/^\s*\{\s*"arguments"\s*:\s*\[\s*\]\s*\}$/, // arguments as empty array
		/^\s*\{\s*"arguments"\s*:\s*""\s*\}$/, // arguments as empty string
	];

	for (const pattern of malformedJSONPatterns) {
		if (pattern.test(trimmed)) {
			return true;
		}
	}

	// Check for malformed XML patterns
	const malformedXMLPatterns = [
		/\[(?:tool_use|Tool):\s*(\w+)\]/i, // [tool_use: name] syntax
		/<function=(\w+)>/, // <function=name> syntax
		/<parameter=(\w+)>/, // <parameter=name> syntax
	];

	for (const pattern of malformedXMLPatterns) {
		if (pattern.test(content)) {
			return true;
		}
	}

	return false;
}

/**
 * Builds metadata object for debugging and strategy selection
 *
 * @param content - Normalized content
 * @param partialMetadata - Partial metadata from earlier detection
 * @returns Complete metadata object
 */
function buildMetadata(
	content: string,
	partialMetadata: Partial<ResponseMetadata>,
): ResponseMetadata {
	// Check if content looks like JSON (has { and })
	// Check if content looks like XML (has < and >)
	// Check if content has code blocks
	const hasCodeBlocks = /```/.test(content);
	// Check if content has XML tags
	const hasXMLTags = /<[^>]+>/.test(content);
	// Check if content has JSON blocks (tool call patterns only, not plain JSON objects)
	const hasJSONBlocks = /"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{/.test(
		content,
	);

	return {
		hasCodeBlocks: partialMetadata.hasCodeBlocks ?? hasCodeBlocks,
		hasXMLTags: partialMetadata.hasXMLTags ?? hasXMLTags,
		hasJSONBlocks: partialMetadata.hasJSONBlocks ?? hasJSONBlocks,
		isStreaming: partialMetadata.isStreaming ?? false,
		confidence: determineConfidence({
			...partialMetadata,
			hasCodeBlocks,
			hasXMLTags,
			hasJSONBlocks,
		}),
		detectedFormat: partialMetadata.detectedFormat ?? 'unknown',
		isMalformed: partialMetadata.isMalformed ?? hasMalformedPatterns(content),
		malformedError: partialMetadata.malformedError,
	};
}

/**
 * Determines confidence level in the response type classification
 *
 * Confidence levels:
 * - HIGH: Clear format detected (JSON with tool_calls, XML with tool calls)
 * - MEDIUM: Unclear format (plain text with possible tool calls)
 * - LOW: No format detected (plain text with no tool calls)
 *
 * @param metadata - Metadata from response
 * @returns Confidence level
 */
function determineConfidence(
	metadata: Partial<ResponseMetadata>,
): 'high' | 'medium' | 'low' {
	// High confidence if tool calls were successfully extracted
	// Note: We need to track whether tool calls were actually found, not just that content exists
	// This is determined by whether the response is malformed (no tool calls found and patterns detected)
	if (!metadata.isMalformed) {
		return 'high';
	}

	// Medium confidence if format detected but no tool calls
	if (
		metadata.detectedFormat === 'json' ||
		metadata.detectedFormat === 'xml' ||
		metadata.hasCodeBlocks
	) {
		return 'medium';
	}

	// Low confidence if plain text with no format indicators
	if (
		metadata.detectedFormat === 'plain' &&
		!metadata.hasJSONBlocks &&
		!metadata.hasXMLTags &&
		!metadata.hasCodeBlocks
	) {
		return 'low';
	}

	return 'low';
}

/**
 * Checks if content contains embedded tool call patterns
 *
 * @param content - Content to check
 * @returns True if embedded patterns detected
 */
function hasEmbeddedToolCallPatterns(content: string): boolean {
	// JSON tool call patterns (allow text before the pattern)
	const jsonPatterns = [
		/\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{/s,
		/\s*\{"name":\s*"([^"]+)",\s*"arguments":\s*\{/s,
	];

	// XML tool call patterns
	const xmlPatterns = [/<(\w+)>(.*?)<\/\1>/s];

	for (const pattern of [...jsonPatterns, ...xmlPatterns]) {
		if (pattern.test(content)) {
			return true;
		}
	}

	return false;
}

// ============================================================================
// STREAMING RESPONSE HANDLING
// ============================================================================

/**
 * Handles streaming chunks from LLM
 *
 * Streaming chunks can be:
 * - Partial strings (incomplete sentences)
 * - JSON objects (partial tool calls)
 * - Mixed content (text + partial tool calls)
 *
 * This function normalizes streaming chunks and accumulates tool calls
 *
 * @param previousResponse - Previous normalized response
 * @param newChunk - New chunk from streaming
 * @returns Updated normalized response
 */
async function _normalizeStreamingResponse(
	previousResponse: NormalizedResponse,
	newChunk: string,
): Promise<NormalizedResponse> {
	// If previous response had tool calls, accumulate them
	let accumulatedToolCalls = previousResponse.toolCalls;

	// If previous response was malformed, try to recover with new chunk
	let accumulatedContent = previousResponse.content;
	if (previousResponse.metadata.isMalformed) {
		accumulatedContent += newChunk;
	} else {
		accumulatedContent = previousResponse.content + newChunk;
	}

	// Normalize the combined content
	const normalized = await normalizeLLMResponse(accumulatedContent, {
		preserveRawTypes: false,
		allowMixedContent: true,
		detectStreaming: true,
	});

	return {
		...normalized,
		toolCalls: accumulatedToolCalls,
	};
}

/**
 * Finalizes a streaming response
 *
 * Called when streaming is complete to ensure all tool calls are captured
 *
 * @param streamingResponse - Response accumulated during streaming
 * @returns Final normalized response
 */
function _finalizeStreamingResponse(
	streamingResponse: NormalizedResponse,
): NormalizedResponse {
	// If tool calls were accumulated, ensure they're in the final response
	if (streamingResponse.toolCalls.length > 0) {
		return {
			...streamingResponse,
			metadata: {
				...streamingResponse.metadata,
				confidence: 'high',
			},
		};
	}

	return streamingResponse;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Formats a normalized response for debugging
 *
 * @param response - Normalized response to format
 * @returns Formatted string for debugging
 */
export function formatNormalizedResponse(response: NormalizedResponse): string {
	return [
		`=== Normalized Response ===`,
		`Raw Type: ${response.raw !== undefined ? typeof response.raw : 'undefined'}`,
		`Content Type: ${typeof response.content}`,
		`Content Length: ${response.content.length} chars`,
		`Detected Format: ${response.metadata.detectedFormat}`,
		`Confidence: ${response.metadata.confidence}`,
		`Has Code Blocks: ${response.metadata.hasCodeBlocks}`,
		`Has XML Tags: ${response.metadata.hasXMLTags}`,
		`Has JSON Blocks: ${response.metadata.hasJSONBlocks}`,
		`Is Malformed: ${response.metadata.isMalformed}`,
		`Tool Calls: ${response.toolCalls.length}`,
		``,
		`Content Preview:`,
		response.content.slice(0, 500) +
			(response.content.length > 500 ? '...' : ''),
		``,
		`Tool Calls:`,
		response.toolCalls
			.map(
				tc =>
					`  - ${tc.function.name}: ${JSON.stringify(tc.function.arguments)}`,
			)
			.join('\n'),
	].join('\n');
}

/**
 * Checks if a response is complete and ready for processing
 *
 * A response is complete if:
 * 1. It has content
 * 2. It has low confidence (means no tool calls were found, so no further processing needed)
 * 3. It's not malformed
 *
 * @param response - Normalized response to check
 * @returns True if response is complete
 */
export function isResponseComplete(response: NormalizedResponse): boolean {
	// Response is complete if it has content and is not malformed
	return (
		response.content.length > 0 &&
		!response.metadata.isMalformed &&
		response.metadata.confidence !== 'low'
	);
}

/**
 * Gets a human-readable error message for malformed responses
 *
 * @param response - Normalized response with metadata
 * @returns Error message or empty string
 */
function _getMalformedResponseMessage(response: NormalizedResponse): string {
	if (!response.metadata.isMalformed) {
		return '';
	}

	const messages: string[] = [];

	if (response.metadata.hasJSONBlocks) {
		messages.push('JSON tool calls detected but parsing failed');
	}

	if (response.metadata.hasXMLTags) {
		messages.push('XML tool calls detected but parsing failed');
	}

	if (response.metadata.malformedError) {
		messages.push(response.metadata.malformedError);
	}

	return messages.length > 0
		? messages.join('; ')
		: 'Response appears malformed';
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface NormalizeOptions {
	/** If true, keeps the raw object structure instead of JSON.stringify */
	preserveRawTypes?: boolean;

	/** If true, extracts tool calls from mixed content (text + tool calls) */
	allowMixedContent?: boolean;

	/** If true, treats the response as a streaming chunk */
	detectStreaming?: boolean;
}

interface ExtractOptions {
	allowMixedContent: boolean;
	detectedFormat: 'plain' | 'json' | 'xml' | 'mixed';
}
