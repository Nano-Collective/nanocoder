import type {ApiUsageSnapshot, ContextSource} from '@/types/core';

export interface ContextUsageResult {
	percent: number;
	source: ContextSource;
}

/**
 * Decide the context-usage percentage and whether it is API-reported or
 * estimated.
 *
 * API usage is preferred only while it is "fresh" — that is, no new messages
 * have been appended since it was captured (`atMessageCount` still matches the
 * current conversation length) and at least one token field was reported.
 * Otherwise we fall back to the live client-side estimate so the figure never
 * lags the conversation (e.g. right after the user types a new message, before
 * the next response refreshes the snapshot).
 *
 * The API numerator is `inputTokens + outputTokens`: the prompt the model saw
 * plus the assistant reply that was just appended to history, which together
 * equal the context now occupied.
 */
export function resolveContextUsage(params: {
	estimatedTotalTokens: number;
	apiSnapshot: ApiUsageSnapshot | null;
	currentMessageCount: number;
	contextLimit: number;
}): ContextUsageResult {
	const {estimatedTotalTokens, apiSnapshot, currentMessageCount, contextLimit} =
		params;

	const apiFresh =
		apiSnapshot !== null &&
		apiSnapshot.atMessageCount === currentMessageCount &&
		(apiSnapshot.inputTokens !== undefined ||
			apiSnapshot.outputTokens !== undefined);

	if (apiFresh) {
		const apiTotal =
			(apiSnapshot.inputTokens ?? 0) + (apiSnapshot.outputTokens ?? 0);
		return {
			percent: Math.round((apiTotal / contextLimit) * 100),
			source: 'api',
		};
	}

	return {
		percent: Math.round((estimatedTotalTokens / contextLimit) * 100),
		source: 'estimate',
	};
}
