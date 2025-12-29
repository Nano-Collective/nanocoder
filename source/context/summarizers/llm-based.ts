/**
 * LLM-based summarization - high quality, uses model resources
 * Generates intelligent context summaries with graceful fallback to rule-based
 */

import type {LLMClient, Message} from '@/types/core';
import {
	Summarizer,
	type SummarizerOptions,
	type SummaryResult,
} from '../summarizer';
import {estimateTokens} from '../token-estimator';
import {RuleBasedSummarizer} from './rule-based';

const DEFAULT_SUMMARY_PROMPT = `You are a context summarization assistant. Summarize the following conversation context concisely in {maxTokens} tokens or less.

Focus on:
- Files read/modified and their key contents
- Operations that succeeded or failed
- Key decisions, findings, or configurations made
- Current task state and progress
- Any errors encountered and resolutions

Keep the summary factual, structured, and useful for continuation.

Context to summarize:
{context}

Summary:`;

/**
 * LLM-based summarizer using the model for intelligent summaries
 * Falls back to rule-based if context too large or errors occur
 */
export class LLMBasedSummarizer extends Summarizer {
	constructor(
		private client: LLMClient,
		private model: string,
	) {
		super();
	}

	async summarize(
		messages: Message[],
		options: SummarizerOptions,
	): Promise<SummaryResult> {
		// Build context string from messages
		const contextParts = messages.map(message => {
			const role = message.role;
			const content =
				typeof message.content === 'string'
					? message.content.slice(0, 500) // Limit per message to avoid huge context
					: '[complex content]';
			return `[${role}]: ${content}`;
		});

		const context = contextParts.join('\n\n');
		const contextTokens = estimateTokens([{role: 'user', content: context}]);

		// Safety check: if context too large relative to budget, fall back to rule-based
		// Rule-based is O(1) and doesn't use model resources
		if (contextTokens > options.maxSummaryTokens * 3) {
			const ruleBased = new RuleBasedSummarizer();
			return ruleBased.summarize(messages, {
				...options,
				mode: 'rule-based',
			});
		}

		const prompt = DEFAULT_SUMMARY_PROMPT.replace(
			'{maxTokens}',
			String(options.maxSummaryTokens),
		).replace('{context}', context);

		try {
			const response = await this.client.chat(
				[{role: 'user', content: prompt}],
				{}, // No tools for summarization
				{
					onToken: () => {
						// No streaming for background task
					},
					onFinish: () => {
						// No finish handling needed
					},
				},
				undefined, // No abort signal
			);

			if (!response?.choices?.[0]?.message?.content) {
				// Empty response, fall back to rule-based
				const ruleBased = new RuleBasedSummarizer();
				return ruleBased.summarize(messages, {
					...options,
					mode: 'rule-based',
				});
			}

			const summary = response.choices[0].message.content;
			const tokensUsed = estimateTokens([
				{role: 'assistant', content: summary},
			]);

			return {
				summary,
				tokensUsed,
				messagesProcessed: messages.length,
				mode: 'llm-based',
			};
		} catch (error) {
			// Fallback to rule-based on any error
			const logger = console; // Could use proper logger if available
			logger.error(
				'LLM summarization failed, falling back to rule-based:',
				error,
			);

			const ruleBased = new RuleBasedSummarizer();
			return ruleBased.summarize(messages, {
				...options,
				mode: 'rule-based',
			});
		}
	}
}
