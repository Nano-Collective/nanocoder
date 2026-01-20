import type {CompressionMode} from '@/types/config';
import type {Message} from '@/types/core';
import type {Tokenizer} from '@/types/tokenization';

export interface CompressionResult {
	compressedMessages: Message[];
	originalTokenCount: number;
	compressedTokenCount: number;
	reductionPercentage: number;
	preservedInfo: {
		keyDecisions: number;
		fileModifications: number;
		toolResults: number;
		recentMessages: number;
	};
}

export interface CompressionOptions {
	mode: CompressionMode;
	keepRecentMessages?: number;
}

/**
 * Compress message history while preserving essential information
 * @param messages - Original messages to compress
 * @param tokenizer - Tokenizer for counting tokens
 * @param options - Compression options
 * @returns Compression result with compressed messages and statistics
 */
export function compressMessages(
	messages: Message[],
	tokenizer: Tokenizer,
	options: CompressionOptions,
): CompressionResult {
	if (messages.length === 0) {
		return {
			compressedMessages: [],
			originalTokenCount: 0,
			compressedTokenCount: 0,
			reductionPercentage: 0,
			preservedInfo: {
				keyDecisions: 0,
				fileModifications: 0,
				toolResults: 0,
				recentMessages: 0,
			},
		};
	}

	const keepRecent = options.keepRecentMessages ?? 2;
	const originalTokenCount = countTotalTokens(messages, tokenizer);

	// Separate messages into: system, compressible, and recent (keep full)
	const systemMessages: Message[] = [];
	const compressibleMessages: Message[] = [];
	const recentMessages: Message[] = [];

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (msg.role === 'system') {
			systemMessages.push(msg);
		} else if (i >= messages.length - keepRecent) {
			recentMessages.push(msg);
		} else {
			compressibleMessages.push(msg);
		}
	}

	// Compress the compressible messages
	const compressed = compressMessageSegment(compressibleMessages, options.mode);

	// Combine: system + compressed + recent
	const compressedMessages = [
		...systemMessages,
		...compressed,
		...recentMessages,
	];

	const compressedTokenCount = countTotalTokens(compressedMessages, tokenizer);
	const reductionPercentage =
		originalTokenCount > 0
			? ((originalTokenCount - compressedTokenCount) / originalTokenCount) * 100
			: 0;

	// Count preserved information
	const preservedInfo = {
		keyDecisions: countKeyDecisions(compressed),
		fileModifications: countFileModifications(compressed),
		toolResults: countToolResults(compressed),
		recentMessages: recentMessages.length,
	};

	return {
		compressedMessages,
		originalTokenCount,
		compressedTokenCount,
		reductionPercentage,
		preservedInfo,
	};
}

// Compress a segment of messages excluding system and recent
function compressMessageSegment(
	messages: Message[],
	mode: CompressionMode,
): Message[] {
	if (messages.length === 0) {
		return [];
	}

	const compressed: Message[] = [];
	let i = 0;

	while (i < messages.length) {
		const msg = messages[i];

		// Handle tool messages
		if (msg.role === 'tool') {
			const compressedTool = compressToolResult(msg, mode);
			compressed.push(compressedTool);
			i++;
			continue;
		}

		// Handle assistant messages with tool calls
		if (
			msg.role === 'assistant' &&
			msg.tool_calls &&
			msg.tool_calls.length > 0
		) {
			// Keep assistant message with tool calls, but compress content if verbose
			const compressedMsg = compressAssistantMessage(msg, mode);
			compressed.push(compressedMsg);
			i++;
			continue;
		}

		// Handle user messages, summarize if verbose
		if (msg.role === 'user') {
			const compressedUser = compressUserMessage(msg, mode);
			compressed.push(compressedUser);
			i++;
			continue;
		}

		// Handle assistant messages, summarize if verbose
		if (msg.role === 'assistant') {
			const compressedAssistant = compressAssistantMessage(msg, mode);
			compressed.push(compressedAssistant);
			i++;
			continue;
		}

		// Unknown role keep
		compressed.push(msg);
		i++;
	}

	return compressed;
}

// Compress a tool result message, Keep things like facts,terminal logs, verbose JSON, etc.
function compressToolResult(msg: Message, mode: CompressionMode): Message {
	if (msg.role !== 'tool' || !msg.name) {
		return msg;
	}

	const toolName = msg.name;
	const content = msg.content || '';

	// Extract error status
	const hasError = checkForError(content);

	// Compress based on mode
	let compressedContent: string;

	if (mode === 'aggressive') {
		// Most aggressive: just outcome
		compressedContent = hasError
			? compressToolError(toolName, content)
			: `Tool: ${toolName}\nResult: success`;
	} else if (mode === 'conservative') {
		// Conservative: keep more detail
		compressedContent = compressToolResultConservative(toolName, content);
	} else {
		// Default: balanced
		compressedContent = compressToolResultDefault(toolName, content);
	}

	return {
		...msg,
		content: compressedContent,
	};
}

// Compress tool result in default mode
function compressToolResultDefault(toolName: string, content: string): string {
	const error = extractErrorInfo(content);
	if (error) {
		return `Tool: ${toolName}\nError: ${error.type}\n${error.details}\nResolved: ${error.resolved ? 'yes' : 'no'}`;
	}

	// Check for success indicators
	if (isSuccess(content)) {
		return `Tool: ${toolName}\nResult: success`;
	}

	// Extract key information like first line, key metrics, etc.
	const lines = content.split('\n');
	const firstLine = lines[0] || '';
	const keyInfo = extractKeyInfo(content);

	if (keyInfo) {
		return `Tool: ${toolName}\nResult: ${keyInfo}`;
	}

	// Fallback: truncate to first meaningful line
	return `Tool: ${toolName}\nResult: ${firstLine.substring(0, 100)}`;
}

// Compress tool result in conservative mode
function compressToolResultConservative(
	toolName: string,
	content: string,
): string {
	const error = extractErrorInfo(content);
	if (error) {
		return `Tool: ${toolName}\nError: ${error.type}\n${error.details}\nResolved: ${error.resolved ? 'yes' : 'no'}`;
	}

	// Keep first few lines and summary
	const lines = content.split('\n').filter(line => line.trim());
	const importantLines = lines.slice(0, 3);
	const summary = importantLines.join('\n');

	return `Tool: ${toolName}\nResult: ${summary}${lines.length > 3 ? '...' : ''}`;
}

// Compress tool error
function compressToolError(toolName: string, content: string): string {
	const error = extractErrorInfo(content);
	if (error) {
		return `Tool: ${toolName}\nError: ${error.type}\n${error.details}\nResolved: ${error.resolved ? 'yes' : 'no'}`;
	}

	return `Tool: ${toolName}\nError: (error occurred)`;
}

// Extract error information from tool result
function extractErrorInfo(content: string): {
	type: string;
	details: string;
	resolved: boolean;
} | null {
	// Look for common error patterns
	const errorPatterns = [/Error:\s*(\w+)/i, /(\w+Error):/i, /(\w+Exception):/i];

	for (const pattern of errorPatterns) {
		const match = content.match(pattern);
		if (match) {
			const errorType = match[1];
			// Try to extract file and line if present
			const fileMatch = content.match(/File:\s*([^\n]+)/i);
			const lineMatch = content.match(/Line:\s*(\d+)/i);

			let details = errorType;
			if (fileMatch) {
				details += ` in ${fileMatch[1]}`;
				if (lineMatch) {
					details += `:${lineMatch[1]}`;
				}
			}

			// Check if resolved
			const resolved =
				/fixed|resolved|success|working/i.test(content) &&
				!/failed|error|broken/i.test(
					content.slice(content.indexOf(match[0]) + match[0].length),
				);

			return {
				type: errorType,
				details,
				resolved,
			};
		}
	}

	return null;
}

// Check if content indicates success
function isSuccess(content: string): boolean {
	const successPatterns = [
		/^success$/i,
		/^ok$/i,
		/^done$/i,
		/completed successfully/i,
		/no errors/i,
	];
	return successPatterns.some(pattern => pattern.test(content));
}

// Check for error in content
function checkForError(content: string): boolean {
	return /error|exception|failed|failure/i.test(content);
}

// Extract key information from tool result
function extractKeyInfo(content: string): string | null {
	// Look for key metrics or summary lines
	const lines = content.split('\n').filter(line => line.trim());
	if (lines.length === 0) {
		return null;
	}

	// Prefer short, informative lines
	for (const line of lines.slice(0, 5)) {
		if (line.length < 100 && !line.includes('...') && !line.includes('node:')) {
			return line;
		}
	}

	return null;
}

// Compress user message
function compressUserMessage(msg: Message, mode: CompressionMode): Message {
	if (msg.role !== 'user') {
		return msg;
	}

	const content = msg.content || '';

	// Conservative mode: keep as is
	if (mode === 'conservative') {
		return msg;
	}

	// Default/Aggressive: summarize if very long
	if (content.length > 500) {
		const summary = summarizeText(content, mode === 'aggressive' ? 100 : 200);
		return {
			...msg,
			content: summary,
		};
	}

	return msg;
}

// Compress assistant message
function compressAssistantMessage(
	msg: Message,
	mode: CompressionMode,
): Message {
	if (msg.role !== 'assistant') {
		return msg;
	}

	const content = msg.content || '';

	// Keep tool calls as is
	if (msg.tool_calls && msg.tool_calls.length > 0) {
		// Compress content if verbose, but keep tool calls
		if (content.length > 300 && mode !== 'conservative') {
			return {
				...msg,
				content: summarizeText(content, mode === 'aggressive' ? 100 : 200),
			};
		}
		return msg;
	}

	// Conservative mode: keep as is
	if (mode === 'conservative') {
		return msg;
	}

	// Default/Aggressive: summarize if very long
	if (content.length > 500) {
		const summary = summarizeText(content, mode === 'aggressive' ? 150 : 300);
		return {
			...msg,
			content: summary,
		};
	}

	return msg;
}

// Summarize text to target length
function summarizeText(text: string, targetLength: number): string {
	if (text.length <= targetLength) {
		return text;
	}

	// Try to keep first sentence/paragraph
	const sentences = text.split(/[.!?]\s+/);
	let summary = '';

	for (const sentence of sentences) {
		if ((summary + sentence).length <= targetLength - 3) {
			summary += sentence + '. ';
		} else {
			break;
		}
	}

	if (summary) {
		return summary.trim() + '...';
	}

	// Fallback
	return text.substring(0, targetLength - 3) + '...';
}

// Count total tokens in messages
function countTotalTokens(messages: Message[], tokenizer: Tokenizer): number {
	let total = 0;
	for (const msg of messages) {
		total += tokenizer.countTokens(msg);
	}
	return total;
}

// Count key decisions in compressed messages
function countKeyDecisions(messages: Message[]): number {
	// Look for messages with decision indicators
	let count = 0;
	for (const msg of messages) {
		if (msg.role === 'user' || msg.role === 'assistant') {
			const content = (msg.content || '').toLowerCase();
			if (
				/decided|decision|chose|chosen|will use|using|selected|choose/i.test(
					content,
				)
			) {
				count++;
			}
		}
	}
	return count;
}

// Count file modifications
function countFileModifications(messages: Message[]): number {
	let count = 0;
	for (const msg of messages) {
		if (msg.role === 'tool' && msg.name) {
			const toolName = msg.name.toLowerCase();
			if (
				toolName.includes('write') ||
				toolName.includes('edit') ||
				toolName.includes('create') ||
				toolName.includes('modify')
			) {
				count++;
			}
		}
	}
	return count;
}

// Count tool results
function countToolResults(messages: Message[]): number {
	return messages.filter(msg => msg.role === 'tool').length;
}
