/**
 * Summary store for managing persistent conversation summaries
 * Accumulates and versions summaries across session boundaries
 */

import type {Message} from '@/types/core';
import type {Summarizer, SummarizerOptions} from './summarizer';
import {estimateTokens} from './token-estimator';

export interface ConversationSummary {
	createdAt: number;
	updatedAt: number;
	content: string;
	tokensUsed: number;
	messagesIncluded: number;
	version: number;
}

/**
 * Manages conversation summaries persistently across sessions
 * Accumulates multiple summaries while respecting token budgets
 */
export class SummaryStore {
	private summary: ConversationSummary | null = null;

	/**
	 * Update store with newly summarized messages
	 * Combines with existing summary if present, respecting token budget
	 */
	async updateSummary(
		droppedMessages: Message[],
		summarizer: Summarizer,
		options: SummarizerOptions,
	): Promise<void> {
		const result = await summarizer.summarize(droppedMessages, options);

		// Merge with existing summary
		let newContent = result.summary;
		let newTokensUsed = result.tokensUsed;

		if (this.summary) {
			// Combine with existing summary
			const combined = `${this.summary.content}\n\n[Update ${this.summary.version + 1}]\n${newContent}`;
			const combinedTokens = estimateTokens([
				{role: 'system', content: combined},
			]);

			// If combined summary exceeds reasonable bounds, keep only latest
			// This prevents unbounded growth while maintaining continuity
			if (combinedTokens > options.maxSummaryTokens * 2) {
				// Too large, mark as condensed
				newContent = `[Conversation History Summary]\n${newContent}`;
				newTokensUsed = estimateTokens([{role: 'system', content: newContent}]);
			} else {
				// Fits within bounds, use combined summary
				newContent = combined;
				newTokensUsed = combinedTokens;
			}
		}

		this.summary = {
			createdAt: this.summary?.createdAt || Date.now(),
			updatedAt: Date.now(),
			content: newContent,
			tokensUsed: newTokensUsed,
			messagesIncluded:
				droppedMessages.length + (this.summary?.messagesIncluded || 0),
			version: (this.summary?.version || 0) + 1,
		};
	}

	/**
	 * Get summary as a system message for injection into prompts
	 */
	getSummaryMessage(): Message | null {
		if (!this.summary) return null;

		return {
			role: 'system',
			content: `[Previous Conversation Summary]\n${this.summary.content}`,
		};
	}

	/**
	 * Clear all stored summaries (e.g., on new session)
	 */
	clear(): void {
		this.summary = null;
	}

	/**
	 * Get metadata about current summary
	 */
	getSummaryInfo(): ConversationSummary | null {
		return this.summary ? {...this.summary} : null;
	}

	/**
	 * Check if we have an accumulated summary
	 */
	hasSummary(): boolean {
		return this.summary !== null;
	}
}
