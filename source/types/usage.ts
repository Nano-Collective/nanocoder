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
 * Session usage data
 */
export interface SessionUsage {
	id: string;
	timestamp: number;
	provider: string;
	model: string;
	tokens: TokenBreakdown;
	messageCount: number;
	duration?: number; // Session duration in milliseconds
}

/**
 * Daily aggregate usage
 */
export interface DailyAggregate {
	date: string; // YYYY-MM-DD format
	sessions: number;
	totalTokens: number;
	providers: Record<string, number>; // Provider name -> token count
	models: Record<string, number>; // Model name -> token count
}

/**
 * Persistent usage data structure
 */
export interface UsageData {
	sessions: SessionUsage[]; // Last 100 sessions
	dailyAggregates: DailyAggregate[]; // Last 30 days
	totalLifetime: number;
	lastUpdated: number;
}
