/**
 * Base abstractions for context summarization
 * Provides interfaces for rule-based and LLM-based summarization strategies
 */

import type {Message} from '@/types/core';

/**
 * Options for summarization process
 */
export interface SummarizerOptions {
	maxSummaryTokens: number;
	preserveErrorDetails: boolean;
	mode: 'rule-based' | 'llm-based';
}

/**
 * Result of a summarization operation
 */
export interface SummaryResult {
	summary: string;
	tokensUsed: number;
	messagesProcessed: number;
	mode: 'rule-based' | 'llm-based';
}

/**
 * Abstract base class for message summarizers
 */
export abstract class Summarizer {
	/**
	 * Summarize a set of messages
	 */
	abstract summarize(
		messages: Message[],
		options: SummarizerOptions,
	): Promise<SummaryResult>;
}
