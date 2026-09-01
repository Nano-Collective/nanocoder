import test from 'ava';
import {
	buildStatsViewModel,
	computeCumulative,
	computePeakDay,
	computeStreak,
	computeTopPairs,
	filterDailyInRange,
} from './aggregators';
import {createEmptyLedger} from './storage';
import {
	type DailyStats,
	type StatsLedger,
	makePairKey,
} from './types';

console.log('\naggregators.spec.ts');

function day(
	date: string,
	partial: Partial<DailyStats> & {
		pairs?: Array<{provider: string; model: string; tokens: number}>;
	} = {},
): DailyStats {
	const byPair: DailyStats['byPair'] = {};
	for (const p of partial.pairs ?? []) {
		byPair[makePairKey(p.provider, p.model)] = {
			tokens: p.tokens,
			prompts: 0,
			cost: 0,
		};
	}
	return {
		date,
		sessions: partial.sessions ?? 0,
		prompts: partial.prompts ?? 0,
		tokens: partial.tokens ?? 0,
		cost: partial.cost ?? 0,
		byPair: partial.byPair ?? byPair,
	};
}

const NOW = new Date(2026, 7, 25); // local Aug 25, 2026

test('filterDailyInRange keeps only 7d window', t => {
	const daily = [
		day('2026-08-10', {tokens: 100}),
		day('2026-08-19', {tokens: 200}),
		day('2026-08-25', {tokens: 300}),
	];
	const filtered = filterDailyInRange(daily, '7d', NOW);
	t.deepEqual(
		filtered.map(d => d.date),
		['2026-08-19', '2026-08-25'],
	);
});

test('filterDailyInRange keeps 3m window (~90 days)', t => {
	const daily = [
		day('2026-05-01', {tokens: 50}), // before 3m window (start ≈ May 28)
		day('2026-05-28', {tokens: 100}),
		day('2026-07-01', {tokens: 200}),
		day('2026-08-25', {tokens: 300}),
	];
	const filtered = filterDailyInRange(daily, '3m', NOW);
	t.deepEqual(
		filtered.map(d => d.date),
		['2026-05-28', '2026-07-01', '2026-08-25'],
	);
});

test('filterDailyInRange all-time respects ledger createdAt', t => {
	const createdAt = new Date(2026, 6, 1).getTime(); // Jul 1
	const daily = [
		day('2026-06-15', {tokens: 10}),
		day('2026-07-10', {tokens: 20}),
		day('2026-08-25', {tokens: 30}),
	];
	const filtered = filterDailyInRange(daily, 'all-time', NOW, createdAt);
	t.deepEqual(
		filtered.map(d => d.date),
		['2026-07-10', '2026-08-25'],
	);
});

test('computePeakDay picks hottest day; ties prefer most recent', t => {
	const peak = computePeakDay([
		day('2026-08-20', {tokens: 500}),
		day('2026-08-21', {tokens: 900}),
		day('2026-08-22', {tokens: 900}),
		day('2026-08-23', {tokens: 100}),
	]);
	t.deepEqual(peak, {date: '2026-08-22', tokens: 900});
});

test('computePeakDay returns null when no tokens', t => {
	t.is(computePeakDay([day('2026-08-20', {prompts: 3})]), null);
	t.is(computePeakDay([]), null);
});

test('computeStreak current and best', t => {
	const days = [
		day('2026-08-20', {tokens: 10}),
		day('2026-08-21', {tokens: 10}),
		day('2026-08-22', {tokens: 10}),
		// gap
		day('2026-08-24', {tokens: 10}),
		day('2026-08-25', {tokens: 10}),
	];
	const streak = computeStreak(days, NOW);
	t.is(streak.current, 2);
	t.is(streak.best, 3);
});

test('computeTopPairs ranks by tokens; one provider three models', t => {
	const days = [
		day('2026-08-25', {
			tokens: 1000,
			pairs: [
				{provider: 'OpenRouter', model: 'gpt-5', tokens: 550},
				{provider: 'OpenRouter', model: 'claude-sonnet', tokens: 300},
				{provider: 'OpenRouter', model: 'deepseek-r1', tokens: 150},
			],
		}),
	];
	const top = computeTopPairs(days, 5);
	t.is(top.length, 3);
	t.is(top[0]?.provider, 'OpenRouter');
	t.is(top[0]?.model, 'gpt-5');
	t.is(top[1]?.model, 'claude-sonnet');
	t.is(top[2]?.model, 'deepseek-r1');
	t.true(Math.abs(top[0]!.share - 0.55) < 1e-9);
});

test('computeTopPairs returns empty when no pair tokens', t => {
	t.deepEqual(computeTopPairs([day('2026-08-25', {tokens: 0})]), []);
});

test('computeCumulative 7d is daily running total', t => {
	const days = [
		day('2026-08-20', {tokens: 100}),
		day('2026-08-22', {tokens: 50}),
		day('2026-08-25', {tokens: 25}),
	];
	const points = computeCumulative(days, '7d', NOW);
	t.is(points.length, 7);
	// Aug 19..25: 19=0, 20=100 →100, …, 22=50 →150, …, 25=25 →175
	t.is(points[0]?.key, '2026-08-19');
	t.is(points[0]?.cumulativeTokens, 0);
	t.is(points[1]?.cumulativeTokens, 100);
	t.is(points.at(-1)?.cumulativeTokens, 175);
	t.is(points.at(-1)?.key, '2026-08-25');
});

test('computeCumulative all-time buckets by month', t => {
	const created = new Date(2026, 2, 1).getTime(); // Mar 1
	const days = [
		day('2026-03-15', {tokens: 100}),
		day('2026-04-01', {tokens: 200}),
		day('2026-08-25', {tokens: 50}),
	];
	const points = computeCumulative(days, 'all-time', NOW, created);
	t.true(points.length >= 3);
	t.is(points.at(-1)?.cumulativeTokens, 350);
});

test('computeCumulative 3m buckets by month inside window', t => {
	const days = [
		day('2026-05-28', {tokens: 100}),
		day('2026-06-15', {tokens: 200}),
		day('2026-08-25', {tokens: 50}),
	];
	const points = computeCumulative(days, '3m', NOW);
	t.true(points.length >= 2);
	t.is(points.at(-1)?.cumulativeTokens, 350);
	t.is(points.at(-1)?.key, '2026-08');
});

test('buildStatsViewModel all-time uses uncapped totals and since', t => {
	const ledger: StatsLedger = {
		...createEmptyLedger(new Date(2025, 7, 1).getTime()),
		totalSessions: 128,
		totalPrompts: 1402,
		totalTokens: 48_200_000,
		totalCost: 62.1,
		daily: [day('2026-08-25', {sessions: 1, prompts: 2, tokens: 100})],
	};
	const vm = buildStatsViewModel(ledger, 'all-time', NOW);
	t.is(vm.sessions, 128);
	t.is(vm.prompts, 1402);
	t.is(vm.tokens, 48_200_000);
	t.is(vm.estCost, 62.1);
	t.truthy(vm.since);
	t.false(vm.isEmpty);
});

test('buildStatsViewModel all-time chart ends at the lifetime total', t => {
	const createdAt = new Date(2026, 0, 1).getTime();
	const ledger: StatsLedger = {
		...createEmptyLedger(createdAt),
		totalTokens: 1000,
		daily: [day('2026-08-25', {tokens: 100})],
		monthly: [
			{
				month: '2026-01',
				tokens: 900,
				cost: 0,
				byPair: {},
			},
			{
				month: '2026-08',
				tokens: 100,
				cost: 0,
				byPair: {},
			},
		],
	};

	const vm = buildStatsViewModel(ledger, 'all-time', NOW);

	t.is(vm.cumulative.at(-1)?.cumulativeTokens, ledger.totalTokens);
});

test('buildStatsViewModel represents pre-rollup tokens as Earlier', t => {
	const ledger: StatsLedger = {
		...createEmptyLedger(new Date(2026, 0, 1).getTime()),
		totalTokens: 1000,
		daily: [day('2026-08-25', {tokens: 100})],
		monthly: [],
	};

	const vm = buildStatsViewModel(ledger, 'all-time', NOW);

	t.is(vm.cumulative[0]?.label, 'Earlier');
	t.is(vm.cumulative.at(-1)?.cumulativeTokens, 1000);
});

test('buildStatsViewModel clamps an over-counted rollup to the lifetime total', t => {
	const ledger: StatsLedger = {
		...createEmptyLedger(new Date(2026, 0, 1).getTime()),
		totalTokens: 1000,
		monthly: [
			{
				month: '2026-08',
				tokens: 1500,
				cost: 0,
				byPair: {},
			},
		],
	};

	const vm = buildStatsViewModel(ledger, 'all-time', NOW);

	t.is(vm.cumulative.at(-1)?.cumulativeTokens, ledger.totalTokens);
});

test('buildStatsViewModel empty ledger', t => {
	const vm = buildStatsViewModel(createEmptyLedger(NOW.getTime()), '7d', NOW);
	t.true(vm.isEmpty);
	t.is(vm.sessions, 0);
	t.is(vm.topPairs.length, 0);
	t.is(vm.peakDay, null);
});

test('buildStatsViewModel 7d uses window sums not lifetime totals', t => {
	const ledger: StatsLedger = {
		...createEmptyLedger(new Date(2026, 0, 1).getTime()),
		totalSessions: 100,
		totalPrompts: 1000,
		totalTokens: 9_000_000,
		totalCost: 10,
		daily: [
			day('2026-01-01', {sessions: 50, prompts: 500, tokens: 8_000_000}),
			day('2026-08-24', {sessions: 2, prompts: 10, tokens: 1000, cost: 1}),
			day('2026-08-25', {sessions: 1, prompts: 5, tokens: 500, cost: 0.5}),
		],
	};
	const vm = buildStatsViewModel(ledger, '7d', NOW);
	t.is(vm.sessions, 3);
	t.is(vm.prompts, 15);
	t.is(vm.tokens, 1500);
	t.is(vm.estCost, 1.5);
	t.is(vm.since, null);
});
