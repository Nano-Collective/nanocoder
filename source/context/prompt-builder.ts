/**
 * Final prompt assembly with context overflow protection
 * Enforces hard safety rule: never send request exceeding context budget
 * Optionally summarizes dropped messages to preserve context continuity
 */

import type {ContextManagementConfig} from '@/types/config';
import type {Message} from '@/types/core';
import {computeMaxInputTokens} from './context-budget';
import {enforceContextLimit} from './context-trimmer';
import type {Summarizer, SummarizerOptions} from './summarizer';
import type {SummaryStore} from './summary-store';
import {estimateTokens} from './token-estimator';

export class ContextOverflowError extends Error {
	constructor(
		message: string,
		public currentTokens: number,
		public maxTokens: number,
	) {
		super(message);
		this.name = 'ContextOverflowError';
	}
}

export interface PromptResult {
	messages: Message[];
	tokenCount: number;
	withinBudget: boolean;
	wasTrimmed: boolean;
	droppedCount: number;
	summarized?: boolean;
}

/**
 * Build final prompt, ensuring it fits within budget
 * Optionally summarizes dropped messages if configured
 * Throws ContextOverflowError if cannot fit after trimming
 */
export async function buildFinalPrompt(
	messages: Message[],
	config: ContextManagementConfig,
	providerName?: string,
	model?: string,
	summarizer?: Summarizer,
	summaryStore?: SummaryStore,
): Promise<PromptResult> {
	const maxInputTokens = computeMaxInputTokens(config);

	// Account for existing summary if present
	const summaryMessage = summaryStore?.getSummaryMessage();
	const summaryTokens = summaryMessage
		? estimateTokens([summaryMessage], providerName, model)
		: 0;

	const availableTokens = maxInputTokens - summaryTokens;
	const originalTokens = estimateTokens(messages, providerName, model);

	// Already within budget
	if (originalTokens + summaryTokens <= maxInputTokens) {
		// Inject existing summary if available
		let finalMessages = messages;
		if (summaryMessage) {
			finalMessages = [summaryMessage, ...messages];
		}

		return {
			messages: finalMessages,
			tokenCount: estimateTokens(finalMessages, providerName, model),
			withinBudget: true,
			wasTrimmed: false,
			droppedCount: 0,
		};
	}

	// Try to trim to fit
	const result = enforceContextLimit(messages, availableTokens, {
		maxAge: config.preserveRecentTurns,
		preserveRecentTurns: config.preserveRecentTurns,
		strategy: config.trimStrategy,
		providerName,
		model,
	});

	// Generate summary for dropped messages if configured
	let summarized = false;
	if (
		summarizer &&
		summaryStore &&
		result.droppedMessages &&
		config.summarizeOnTruncate
	) {
		try {
			const summarizerOptions: SummarizerOptions = {
				maxSummaryTokens: config.maxSummaryTokens || 500,
				preserveErrorDetails: config.preserveErrorDetails ?? true,
				mode: config.summarizationMode || 'rule-based',
			};

			await summaryStore.updateSummary(
				result.droppedMessages,
				summarizer,
				summarizerOptions,
			);
			summarized = true;
		} catch (error) {
			// Log error but don't fail - conversation can continue without summary
			console.error('Failed to summarize dropped messages:', error);
		}
	}

	// Build final messages with summary
	let finalMessages = result.messages;
	const updatedSummaryMessage = summaryStore?.getSummaryMessage();
	if (updatedSummaryMessage) {
		finalMessages = [updatedSummaryMessage, ...finalMessages];
	}

	// Verify we're now within budget
	const finalTokens = estimateTokens(finalMessages, providerName, model);
	if (finalTokens > maxInputTokens) {
		throw new ContextOverflowError(
			`Cannot fit request within context limit. ` +
				`After trimming: ${finalTokens} tokens, Max: ${maxInputTokens} tokens. ` +
				`Please narrow the scope or start a new session.`,
			finalTokens,
			maxInputTokens,
		);
	}

	return {
		messages: finalMessages,
		tokenCount: finalTokens,
		withinBudget: true,
		wasTrimmed: true,
		droppedCount: result.droppedCount,
		summarized,
	};
}
