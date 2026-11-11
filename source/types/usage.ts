/**
 * Token breakdown by category
 */
export interface TokenBreakdown {
	system: number;
	userMessages: number;
	assistantMessages: number;
	toolDefinitions: number;
	toolResults: number;
	total: number;
}

/**
 * Provider-reported usage for a single API response, plus the estimated
 * cost when pricing data is available. Rendered as the per-response
 * indicator under each assistant message.
 */
export interface ResponseUsage {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	/** Estimated cost of this API call in USD; omitted when pricing is unknown. */
	cost?: number;
}

/**
 * Estimated cost breakdown in USD
 */
export interface CostBreakdown {
	currentContext: number; // Cost of current context window
	cumulativeSession: number; // Session total spend
	perProvider?: Record<string, number>; // Per-provider subtotals
}
