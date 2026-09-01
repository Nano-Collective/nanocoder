/**
 * Pure aggregation for `/stats` view models.
 */

import {
	addLocalDays,
	eachLocalDate,
	monthLabel,
	toLocalDateKey,
	toMonthKey,
	weekdayLabel,
} from './date-utils';
import {
	type CumulativePoint,
	type DailyStats,
	type MonthlyStats,
	type PairUsage,
	type PeakDay,
	parsePairKey,
	type StatsLedger,
	type StatsRange,
	type StatsViewModel,
	type StreakInfo,
	type TopPair,
} from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Resolve the inclusive start date key for a range (local). */
function rangeStartKey(
	range: StatsRange,
	now: Date = new Date(),
	ledgerCreatedAt?: number,
): string {
	const today = toLocalDateKey(now);
	if (range === '7d') {
		return addLocalDays(today, -6);
	}
	if (range === '3m') {
		return addLocalDays(today, -89);
	}
	if (ledgerCreatedAt != null && Number.isFinite(ledgerCreatedAt)) {
		return toLocalDateKey(new Date(ledgerCreatedAt));
	}
	return today;
}

export function filterDailyInRange(
	daily: DailyStats[],
	range: StatsRange,
	now: Date = new Date(),
	ledgerCreatedAt?: number,
): DailyStats[] {
	const start = rangeStartKey(range, now, ledgerCreatedAt);
	const end = toLocalDateKey(now);
	return daily.filter(d => d.date >= start && d.date <= end);
}

function sumField(
	days: DailyStats[],
	field: 'sessions' | 'prompts' | 'tokens' | 'cost',
): number {
	return days.reduce((sum, d) => sum + (d[field] || 0), 0);
}

export function computePeakDay(days: DailyStats[]): PeakDay | null {
	if (days.length === 0) return null;
	let best: DailyStats | null = null;
	for (const day of days) {
		if (day.tokens <= 0) continue;
		if (
			!best ||
			day.tokens > best.tokens ||
			(day.tokens === best.tokens && day.date > best.date)
		) {
			best = day;
		}
	}
	if (!best || best.tokens <= 0) return null;
	return {date: best.date, tokens: best.tokens};
}

/** A day is "active" when it has prompts or tokens. */
function isActiveDay(day: DailyStats | undefined): boolean {
	return !!day && (day.prompts > 0 || day.tokens > 0);
}

export function computeStreak(
	days: DailyStats[],
	now: Date = new Date(),
): StreakInfo {
	const byDate = new Map(days.map(d => [d.date, d]));
	const today = toLocalDateKey(now);

	// Best streak across the provided days (sorted)
	const sortedKeys = [...byDate.keys()].sort();
	let best = 0;
	let run = 0;
	let prev: string | null = null;
	for (const key of sortedKeys) {
		if (!isActiveDay(byDate.get(key))) {
			run = 0;
			prev = key;
			continue;
		}
		if (prev && addLocalDays(prev, 1) === key) {
			run += 1;
		} else {
			run = 1;
		}
		best = Math.max(best, run);
		prev = key;
	}

	// Current streak: walk backward from today (or yesterday if today quiet)
	let current = 0;
	let cursor = today;
	if (!isActiveDay(byDate.get(today))) {
		cursor = addLocalDays(today, -1);
	}
	while (isActiveDay(byDate.get(cursor))) {
		current += 1;
		cursor = addLocalDays(cursor, -1);
	}

	return {current, best: Math.max(best, current)};
}

export function computeTopPairs(
	days: DailyStats[],
	limit = 5,
	monthly?: MonthlyStats[],
): TopPair[] {
	const totals = new Map<string, number>();
	let grand = 0;
	const groups: Array<{byPair: Record<string, PairUsage>}> =
		monthly && monthly.length > 0 ? monthly : days;
	for (const group of groups) {
		for (const [key, usage] of Object.entries(group.byPair ?? {})) {
			const tokens = usage.tokens || 0;
			if (tokens <= 0) continue;
			totals.set(key, (totals.get(key) ?? 0) + tokens);
			grand += tokens;
		}
	}
	if (grand <= 0) return [];

	return [...totals.entries()]
		.sort((a, b) => {
			if (b[1] !== a[1]) return b[1] - a[1];
			const pa = parsePairKey(a[0]);
			const pb = parsePairKey(b[0]);
			const pCmp = pa.provider.localeCompare(pb.provider);
			if (pCmp !== 0) return pCmp;
			return pa.model.localeCompare(pb.model);
		})
		.slice(0, limit)
		.map(([key, tokens]) => {
			const {provider, model} = parsePairKey(key);
			return {
				provider,
				model,
				tokens,
				share: tokens / grand,
			};
		});
}

/**
 * Build cumulative series for the chart.
 * - 7d: one point per day
 * - 3m / all-time: one point per month in the window
 */
export function computeCumulative(
	days: DailyStats[],
	range: StatsRange,
	now: Date = new Date(),
	ledgerCreatedAt?: number,
	monthly?: MonthlyStats[],
	lifetimeTokens?: number,
): CumulativePoint[] {
	const start = rangeStartKey(range, now, ledgerCreatedAt);
	const end = toLocalDateKey(now);
	const byDate = new Map(days.map(d => [d.date, d.tokens]));

	if (range === '7d') {
		const keys = eachLocalDate(start, end);
		let running = 0;
		return keys.map(key => {
			running += byDate.get(key) ?? 0;
			return {
				key,
				label: weekdayLabel(key),
				cumulativeTokens: running,
			};
		});
	}

	// Monthly buckets for 3m and all-time
	const monthTokens = new Map<string, number>();
	if (range === 'all-time' && monthly && monthly.length > 0) {
		const startMonth = toMonthKey(start);
		const endMonth = toMonthKey(end);
		for (const aggregate of monthly) {
			if (aggregate.month >= startMonth && aggregate.month <= endMonth) {
				monthTokens.set(aggregate.month, aggregate.tokens);
			}
		}
	} else {
		for (const key of eachLocalDate(start, end)) {
			const mk = toMonthKey(key);
			monthTokens.set(mk, (monthTokens.get(mk) ?? 0) + (byDate.get(key) ?? 0));
		}
	}
	const monthKeys = [...new Set(eachLocalDate(start, end).map(toMonthKey))];
	const chartTokens = monthKeys.reduce(
		(sum, month) => sum + Math.max(0, monthTokens.get(month) ?? 0),
		0,
	);
	const targetLifetimeTokens = Number.isFinite(lifetimeTokens)
		? Math.max(0, lifetimeTokens as number)
		: undefined;
	const missingLifetimeTokens =
		range === 'all-time' &&
		targetLifetimeTokens !== undefined &&
		targetLifetimeTokens > chartTokens
			? targetLifetimeTokens - chartTokens
			: 0;
	let running = missingLifetimeTokens;
	const points = monthKeys.map(mk => {
		running += Math.max(0, monthTokens.get(mk) ?? 0);
		if (targetLifetimeTokens !== undefined) {
			running = Math.min(targetLifetimeTokens, running);
		}
		return {
			key: mk,
			label: monthLabel(mk),
			cumulativeTokens: running,
		};
	});
	if (missingLifetimeTokens > 0) {
		return [
			{
				key: `${start}:earlier`,
				label: 'Earlier',
				cumulativeTokens: missingLifetimeTokens,
			},
			...points,
		];
	}
	return points;
}

export function buildStatsViewModel(
	ledger: StatsLedger,
	range: StatsRange,
	now: Date = new Date(),
): StatsViewModel {
	const days = filterDailyInRange(ledger.daily, range, now, ledger.createdAt);

	const sessions =
		range === 'all-time' ? ledger.totalSessions : sumField(days, 'sessions');
	const prompts =
		range === 'all-time' ? ledger.totalPrompts : sumField(days, 'prompts');
	const tokens =
		range === 'all-time' ? ledger.totalTokens : sumField(days, 'tokens');
	const costSum =
		range === 'all-time' ? ledger.totalCost : sumField(days, 'cost');

	const sinceDays = Math.max(
		1,
		Math.floor((now.getTime() - ledger.createdAt) / MS_PER_DAY) + 1,
	);

	const isEmpty = sessions === 0 && prompts === 0 && tokens === 0;

	return {
		range,
		sessions,
		prompts,
		tokens,
		estCost: costSum > 0 ? costSum : null,
		peakDay: computePeakDay(days),
		streak: computeStreak(days, now),
		since:
			range === 'all-time'
				? {createdAt: ledger.createdAt, days: sinceDays}
				: null,
		cumulative: computeCumulative(
			days,
			range,
			now,
			ledger.createdAt,
			range === 'all-time' ? ledger.monthly : undefined,
			ledger.totalTokens,
		),
		topPairs: computeTopPairs(
			days,
			5,
			range === 'all-time' ? ledger.monthly : undefined,
		),
		isEmpty,
	};
}
