/**
 * Deterministic context trimming algorithm
 * Removes old content while preserving important context
 * Uses priority-based selection with file awareness
 */

import type {Message} from '@/types/core';
import {estimateMessageTokens, estimateTokens} from './token-estimator';

/**
 * Represents a file reference extracted from tool calls
 */
interface FileReference {
	path: string;
	tool: 'read_file' | 'write_file' | 'string_replace';
	step: number;
	wasModified: boolean;
}

export interface TrimOptions {
	maxAge?: number; // Steps before truncation (default: 5)
	maxTokensPerOutput?: number; // Max tokens per tool result (default: 2000)
	placeholder?: string; // Replacement text template
	preserveErrors?: boolean; // Always keep error content (default: true)
	preserveSmallOutputs?: boolean; // Don't truncate outputs under threshold (default: true)
	smallOutputThreshold?: number; // Token threshold for "small" (default: 100)
	preserveRecentTurns?: number; // Number of recent turns to always preserve (default: 5)
	strategy?: 'age-based' | 'priority-based'; // Trimming strategy (default: 'priority-based')
	providerName?: string;
	model?: string;
}

const DEFAULT_TRIM_OPTIONS: Required<TrimOptions> = {
	maxAge: 5,
	maxTokensPerOutput: 2000,
	placeholder: '[content truncated - {age} steps ago, {tokens} tokens]',
	preserveErrors: true,
	preserveSmallOutputs: true,
	smallOutputThreshold: 100,
	preserveRecentTurns: 5,
	strategy: 'priority-based',
	providerName: '',
	model: '',
};

interface TaggedMessage {
	message: Message;
	step: number;
	originalIndex: number;
}

interface ScoredMessage {
	message: Message;
	step: number;
	originalIndex: number;
	priority: number;
}

/**
 * Extract file paths from tool calls in messages
 * Builds a map of message index -> file references
 */
function extractFileReferences(
	messages: Message[],
): Map<number, FileReference[]> {
	const references = new Map<number, FileReference[]>();
	let currentStep = 0;

	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];

		// Track steps
		if (message.role === 'assistant' && message.tool_calls?.length) {
			currentStep++;

			// Extract file paths from tool calls
			for (const call of message.tool_calls) {
				const toolName = call.function.name;
				if (['read_file', 'write_file', 'string_replace'].includes(toolName)) {
					const args = call.function.arguments as Record<string, unknown>;
					const path = args.path || args.file_path;
					if (typeof path === 'string') {
						const wasModified = toolName !== 'read_file';

						const refs = references.get(i) || [];
						refs.push({
							path,
							tool: toolName as 'read_file' | 'write_file' | 'string_replace',
							step: currentStep,
							wasModified,
						});
						references.set(i, refs);
					}
				}
			}
		}
	}

	return references;
}

/**
 * Build set of "active" files from recent file references
 * Files that were modified or read recently are considered "active"
 */
function buildActiveFileSet(
	fileRefs: Map<number, FileReference[]>,
	recentSteps: number,
): Set<string> {
	const activeFiles = new Set<string>();
	const allRefs: FileReference[] = [];

	// Collect all references
	for (const refs of fileRefs.values()) {
		allRefs.push(...refs);
	}

	// Sort by step (most recent first)
	allRefs.sort((a, b) => b.step - a.step);

	// Take recent references, prioritizing modified files
	const recentModified = allRefs
		.filter(ref => ref.wasModified)
		.slice(0, recentSteps * 2); // 2 files per step

	const recentRead = allRefs
		.filter(ref => !ref.wasModified)
		.slice(0, recentSteps * 3); // 3 files per step

	for (const ref of [...recentModified, ...recentRead]) {
		activeFiles.add(ref.path);
	}

	return activeFiles;
}

/**
 * Calculate priority score for a message based on content and context
 * Higher scores = more important (preserve first)
 */
function calculatePriority(
	message: Message,
	_index: number,
	totalSteps: number,
	currentStep: number,
	_fileRefs: Map<number, FileReference[]>,
	_activeFiles: Set<string>,
	options: Required<TrimOptions>,
): number {
	// System messages are always highest priority
	if (message.role === 'system') {
		return 100;
	}

	const age = totalSteps - currentStep;

	// Recent user messages
	if (message.role === 'user' && age <= options.preserveRecentTurns) {
		return 85;
	}

	// Recent assistant messages
	if (message.role === 'assistant' && age <= options.preserveRecentTurns) {
		return 80;
	}

	// Tool results
	if (message.role === 'tool') {
		const content = typeof message.content === 'string' ? message.content : '';

		// High priority for errors
		if (options.preserveErrors && containsError(content)) {
			return 75;
		}

		// Age-based priority for tool results
		if (age <= 2) return 55;
		if (age <= 5) return 35;
		return 20;
	}

	// Older messages get lower priority
	if (age > 10) return 15;
	if (age > 5) return 30;
	return 40;
}

/**
 * Count conversation steps (assistant turns with tool calls)
 */
function countSteps(messages: Message[]): number {
	return messages.filter(m => m.role === 'assistant' && m.tool_calls?.length)
		.length;
}

/**
 * Tag each message with its step number and original index
 */
function tagMessagesWithStep(messages: Message[]): TaggedMessage[] {
	const tagged: TaggedMessage[] = [];
	let currentStep = 0;

	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		if (message.role === 'assistant' && message.tool_calls?.length) {
			currentStep++;
		}
		tagged.push({message, step: currentStep, originalIndex: i});
	}

	return tagged;
}

/**
 * Check if content contains error indicators
 */
function containsError(content: string): boolean {
	const errorPatterns = [
		/error/i,
		/exception/i,
		/failed/i,
		/fatal/i,
		/cannot/i,
		/unable to/i,
	];
	return errorPatterns.some(pattern => pattern.test(content));
}

/**
 * Determine if a tool result should be truncated
 */
function shouldTruncate(
	message: Message,
	options: Required<TrimOptions>,
): boolean {
	const content = typeof message.content === 'string' ? message.content : '';

	// Preserve error messages
	if (options.preserveErrors && containsError(content)) {
		return false;
	}

	// Preserve small outputs
	if (options.preserveSmallOutputs) {
		const tokens = estimateMessageTokens(
			message,
			// For fallback estimation in shouldTruncate
			{
				encode: (text: string) => Math.ceil(text.length / 3.5),
				countTokens: (msg: Message) =>
					Math.ceil(
						(typeof msg.content === 'string' ? msg.content : '').length / 3.5,
					),
				getName: () => 'fallback',
			},
		);
		if (tokens < options.smallOutputThreshold) {
			return false;
		}
	}

	return true;
}

/**
 * Create a placeholder for truncated content
 */
function createPlaceholder(
	message: Message,
	age: number | string,
	options: Required<TrimOptions>,
): Message {
	const originalContent =
		typeof message.content === 'string' ? message.content : '';
	const tokens = Math.ceil(originalContent.length / 3.5);

	const placeholder = options.placeholder
		.replace('{age}', String(age))
		.replace('{tokens}', String(tokens));

	return {
		...message,
		content: placeholder,
	};
}

/**
 * Trim conversation to fit within target token budget
 * Uses priority-based approach: replaces low-priority tool results with placeholders,
 * then removes entire low-priority messages if needed
 */
export function trimConversation(
	messages: Message[],
	targetTokens: number,
	options: Partial<TrimOptions> = {},
): Message[] {
	const config = {...DEFAULT_TRIM_OPTIONS, ...options};
	const totalSteps = countSteps(messages);
	const taggedMessages = tagMessagesWithStep(messages);

	// Extract file references and build active file set
	const fileRefs = extractFileReferences(messages);
	const activeFiles = buildActiveFileSet(fileRefs, config.preserveRecentTurns);

	// Score each message by priority
	const scoredMessages: ScoredMessage[] = taggedMessages.map(
		({message, step, originalIndex}) => ({
			message,
			step,
			originalIndex,
			priority: calculatePriority(
				message,
				originalIndex,
				totalSteps,
				step,
				fileRefs,
				activeFiles,
				config,
			),
		}),
	);

	// Check if already within budget
	let currentTokens = estimateTokens(
		scoredMessages.map(m => m.message),
		config.providerName,
		config.model,
	);
	if (currentTokens <= targetTokens) {
		return scoredMessages.map(m => m.message);
	}

	// First pass: Replace large low-priority tool results with placeholders
	let processed = scoredMessages.map(scored => {
		if (scored.message.role !== 'tool') return scored;

		const age = totalSteps - scored.step;
		const messageTokens = estimateMessageTokens(scored.message, {
			encode: (text: string) => Math.ceil(text.length / 3.5),
			countTokens: (msg: Message) =>
				Math.ceil(
					(typeof msg.content === 'string' ? msg.content : '').length / 3.5,
				),
			getName: () => 'fallback',
		});

		// Replace tool results with placeholders if:
		// 1. They're large enough to be worth truncating (> 200 tokens)
		// 2. AND they're not high-priority
		// This preserves conversation structure while saving tokens
		if (
			messageTokens > 200 &&
			scored.priority < 60 &&
			shouldTruncate(scored.message, config)
		) {
			return {
				...scored,
				message: createPlaceholder(scored.message, age, config),
			};
		}
		return scored;
	});

	// Re-estimate tokens after placeholder replacement
	currentTokens = estimateTokens(
		processed.map(m => m.message),
		config.providerName,
		config.model,
	);
	if (currentTokens <= targetTokens) {
		return processed.map(m => m.message);
	}

	// Sort by priority (lowest first for removal)
	const sortedByPriority = [...processed].sort(
		(a, b) => a.priority - b.priority,
	);

	// Track which messages to keep
	const toKeep = new Set(processed.map((_, i) => i));

	// Second pass: Remove lowest priority messages until we fit within budget
	for (const scored of sortedByPriority) {
		if (currentTokens <= targetTokens) break;

		// Never remove system messages
		if (scored.message.role === 'system') continue;

		// Calculate tokens for this message
		const messageTokens = estimateMessageTokens(scored.message, {
			encode: (text: string) => Math.ceil(text.length / 3.5),
			countTokens: (msg: Message) =>
				Math.ceil(
					(typeof msg.content === 'string' ? msg.content : '').length / 3.5,
				),
			getName: () => 'fallback',
		});

		// Mark for removal
		toKeep.delete(scored.originalIndex);
		currentTokens -= messageTokens;
	}

	// Return messages in original order, preserving sequence
	return processed.filter((_, i) => toKeep.has(i)).map(m => m.message);
}

/**
 * Enforce context limit with trimming if necessary
 */
export function enforceContextLimit(
	messages: Message[],
	maxInputTokens: number,
	options: Partial<TrimOptions> = {},
): {
	messages: Message[];
	truncated: boolean;
	droppedCount: number;
	originalTokens: number;
	finalTokens: number;
	droppedMessages?: Message[];
} {
	const originalTokens = estimateTokens(
		messages,
		options.providerName,
		options.model,
	);

	if (originalTokens <= maxInputTokens) {
		return {
			messages,
			truncated: false,
			droppedCount: 0,
			originalTokens,
			finalTokens: originalTokens,
		};
	}

	// Trim messages to fit within budget
	const trimmed = trimConversation(messages, maxInputTokens, options);

	// Identify which messages were dropped (for summarization)
	const trimmedSet = new Set<Message>();
	for (const msg of trimmed) {
		// Create a unique key for each message to track which ones were kept
		trimmedSet.add(msg);
	}

	const droppedMessages: Message[] = [];
	for (const msg of messages) {
		if (!trimmedSet.has(msg)) {
			droppedMessages.push(msg);
		}
	}

	const finalTokens = estimateTokens(
		trimmed,
		options.providerName,
		options.model,
	);

	return {
		messages: trimmed,
		truncated: true,
		droppedCount: messages.length - trimmed.length,
		originalTokens,
		finalTokens,
		droppedMessages,
	};
}
