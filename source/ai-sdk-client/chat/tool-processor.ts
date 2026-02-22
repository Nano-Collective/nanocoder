import {XMLToolCallParser} from '@/tool-calling/xml-parser';
import type {AISDKCoreTool, StreamCallbacks, ToolCall} from '@/types/index';
import {getLogger} from '@/utils/logging';
import {normalizeLLMResponse} from '@/utils/response-formatter';

export interface XMLToolProcessingResult {
	toolCalls: ToolCall[];
	cleanedContent: string;
}

/**
 * Processes XML tool calls from response content
 */
export async function processXMLToolCalls(
	response: unknown,
	tools: Record<string, AISDKCoreTool>,
	callbacks: StreamCallbacks,
): Promise<XMLToolProcessingResult> {
	const logger = getLogger();
	const toolCalls: ToolCall[] = [];

	// NEW: Normalize response before processing
	const normalized = await normalizeLLMResponse(response);
	const content = normalized.content;

	// Only process if tools are available and no native tool calls were found
	if (Object.keys(tools).length === 0 || !content) {
		return {toolCalls, cleanedContent: content};
	}

	logger.debug('Checking for XML tool calls in response content');

	// Initialize cleanedContent with original content (preserved if no tool calls found)
	let cleanedContent = content;

	// First check for malformed XML tool calls
	const malformedError = XMLToolCallParser.detectMalformedToolCall(content);
	if (malformedError) {
		logger.warn('Malformed XML tool call detected', {
			error: malformedError.error,
		});

		// Return malformed tool call with validation error
		// This mimics how validators work - returns tool call that will show error
		const malformedCall: ToolCall = {
			id: 'malformed_xml_validation',
			function: {
				name: '__xml_validation_error__',
				arguments: {
					error: malformedError.error,
				},
			},
		};
		toolCalls.push(malformedCall);
		callbacks.onToolCall?.(malformedCall);
		cleanedContent = ''; // Clear content since it was malformed
	} else if (XMLToolCallParser.hasToolCalls(content)) {
		logger.debug('Parsing XML tool calls from content');

		// Try to parse well-formed XML tool calls
		const parsedToolCalls = XMLToolCallParser.parseToolCalls(content);
		const xmlToolCalls = XMLToolCallParser.convertToToolCalls(parsedToolCalls);
		cleanedContent = XMLToolCallParser.removeToolCallsFromContent(content);

		logger.debug('XML tool calls parsed', {
			toolCallCount: xmlToolCalls.length,
			contentLength: cleanedContent.length,
		});

		for (const tc of xmlToolCalls) {
			toolCalls.push(tc);
			callbacks.onToolCall?.(tc);
		}
	}

	return {toolCalls, cleanedContent};
}
