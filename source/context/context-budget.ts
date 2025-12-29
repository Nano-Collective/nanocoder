/**
 * Context budget enforcement logic
 * Checks if messages fit within configured limits
 */

import type {ContextManagementConfig} from '@/types/config';
import type {Message} from '@/types/core';
import {estimateTokens} from './token-estimator';

export interface BudgetResult {
	maxInputTokens: number;
	currentTokens: number;
	availableTokens: number;
	withinBudget: boolean;
	utilizationPercent: number;
}

/**
 * Compute the maximum allowed input tokens
 */
export function computeMaxInputTokens(config: ContextManagementConfig): number {
	const maxContext = config.maxContextTokens ?? 128000;
	const reserved = config.reservedOutputTokens ?? 4096;
	return maxContext - reserved;
}

/**
 * Check if messages fit within budget
 */
export function checkBudget(
	messages: Message[],
	config: ContextManagementConfig,
	providerName?: string,
	model?: string,
): BudgetResult {
	const maxInputTokens = computeMaxInputTokens(config);
	const currentTokens = estimateTokens(messages, providerName, model);
	const availableTokens = maxInputTokens - currentTokens;

	return {
		maxInputTokens,
		currentTokens,
		availableTokens,
		withinBudget: currentTokens <= maxInputTokens,
		utilizationPercent: Math.round((currentTokens / maxInputTokens) * 100),
	};
}
