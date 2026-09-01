/**
 * Lifetime stats ledger types for `/stats`.
 */

export type StatsRange = '7d' | '3m' | 'all-time';

export const STATS_RANGES: StatsRange[] = ['7d', '3m', 'all-time'];

/** Version 2 adds lifetime monthly token rollups. */
export const STATS_LEDGER_VERSION = 2 as const;

/** Provider + model pair key separator (unlikely in names). */
const PAIR_KEY_SEP = '\u0000';

export interface PairUsage {
	tokens: number;
	prompts: number;
	cost: number;
}

export interface DailyStats {
	/** Local calendar date YYYY-MM-DD */
	date: string;
	sessions: number;
	prompts: number;
	tokens: number;
	cost: number;
	/** Keyed by `${provider}${PAIR_KEY_SEP}${model}` */
	byPair: Record<string, PairUsage>;
}

/** Unpruned lifetime token history used by the all-time chart. */
export interface MonthlyStats {
	/** Local calendar month YYYY-MM */
	month: string;
	tokens: number;
	cost: number;
	/** Keyed by `${provider}${PAIR_KEY_SEP}${model}` */
	byPair: Record<string, PairUsage>;
}

export interface StatsLedger {
	version: typeof STATS_LEDGER_VERSION;
	/** First time the ledger was created (ms since epoch). */
	createdAt: number;
	totalSessions: number;
	totalPrompts: number;
	totalTokens: number;
	totalCost: number;
	daily: DailyStats[];
	/** Complete monthly token history; unlike daily, this is never pruned. */
	monthly: MonthlyStats[];
	lastUpdated: number;
}

export interface CumulativePoint {
	/** Label for the x-axis (day or month). */
	label: string;
	/** Inclusive date key used for ordering (YYYY-MM-DD or YYYY-MM). */
	key: string;
	/** Running total tokens up to this bucket. */
	cumulativeTokens: number;
}

export interface PeakDay {
	date: string;
	tokens: number;
}

export interface StreakInfo {
	current: number;
	best: number;
}

export interface TopPair {
	provider: string;
	model: string;
	tokens: number;
	share: number;
}

export interface StatsViewModel {
	range: StatsRange;
	sessions: number;
	prompts: number;
	tokens: number;
	/** Estimated USD cost; null when unknown / zero. */
	estCost: number | null;
	peakDay: PeakDay | null;
	streak: StreakInfo;
	/** Present only for all-time. */
	since: {createdAt: number; days: number} | null;
	cumulative: CumulativePoint[];
	topPairs: TopPair[];
	isEmpty: boolean;
}

export function makePairKey(provider: string, model: string): string {
	return `${provider}${PAIR_KEY_SEP}${model}`;
}

export function parsePairKey(key: string): {provider: string; model: string} {
	const sep = key.indexOf(PAIR_KEY_SEP);
	if (sep === -1) {
		return {provider: key || 'unknown', model: 'unknown'};
	}
	return {
		provider: key.slice(0, sep) || 'unknown',
		model: key.slice(sep + PAIR_KEY_SEP.length) || 'unknown',
	};
}

export function createEmptyLedger(now: number = Date.now()): StatsLedger {
	return {
		version: STATS_LEDGER_VERSION,
		createdAt: now,
		totalSessions: 0,
		totalPrompts: 0,
		totalTokens: 0,
		totalCost: 0,
		daily: [],
		monthly: [],
		lastUpdated: now,
	};
}
