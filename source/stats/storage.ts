/**
 * Lifetime stats ledger persistence.
 *
 * Stored under the app-data directory as `.nanocoder-stats.json` (issue #933
 * name; app-data matches other runtime data like usage.json — config dir is
 * for preferences). Override with NANOCODER_DATA_DIR / XDG_DATA_HOME in tests.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {getAppDataPath} from '@/config/paths';
import {formatError} from '@/utils/error-formatter';
import {logWarning} from '@/utils/message-queue';
import {toLocalDateKey} from './date-utils';
import type {DailyStats, PairUsage, StatsLedger} from './types';
import {
	createEmptyLedger as createEmptyLedgerBase,
	makePairKey,
	STATS_LEDGER_VERSION,
} from './types';

export const STATS_FILE_NAME = '.nanocoder-stats.json';

/** Keep roughly a year of daily buckets; all-time totals remain uncapped. */
export const MAX_STATS_DAILY_DAYS = 400;

export function getStatsFilePath(): string {
	return path.join(getAppDataPath(), STATS_FILE_NAME);
}

function ensureAppDataDir(): void {
	const dir = getAppDataPath();
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, {recursive: true});
	}
}

export function createEmptyLedger(now = Date.now()): StatsLedger {
	return createEmptyLedgerBase(now);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePair(raw: unknown): PairUsage {
	if (!isRecord(raw)) {
		return {tokens: 0, prompts: 0, cost: 0};
	}
	return {
		tokens: Number(raw.tokens) || 0,
		prompts: Number(raw.prompts) || 0,
		cost: Number(raw.cost) || 0,
	};
}

function normalizeDaily(raw: unknown): DailyStats | null {
	if (!isRecord(raw) || typeof raw.date !== 'string') return null;
	const byPairRaw = isRecord(raw.byPair) ? raw.byPair : {};
	const byPair: Record<string, PairUsage> = {};
	for (const [k, v] of Object.entries(byPairRaw)) {
		byPair[k] = normalizePair(v);
	}
	return {
		date: raw.date,
		sessions: Number(raw.sessions) || 0,
		prompts: Number(raw.prompts) || 0,
		tokens: Number(raw.tokens) || 0,
		cost: Number(raw.cost) || 0,
		byPair,
	};
}

function normalizeLedger(raw: unknown): StatsLedger {
	if (!isRecord(raw)) {
		return createEmptyLedger();
	}
	const daily: DailyStats[] = [];
	if (Array.isArray(raw.daily)) {
		for (const entry of raw.daily) {
			const day = normalizeDaily(entry);
			if (day) daily.push(day);
		}
	}
	daily.sort((a, b) => a.date.localeCompare(b.date));
	return {
		version: STATS_LEDGER_VERSION,
		createdAt: Number(raw.createdAt) || Date.now(),
		totalSessions: Number(raw.totalSessions) || 0,
		totalPrompts: Number(raw.totalPrompts) || 0,
		totalTokens: Number(raw.totalTokens) || 0,
		totalCost: Number(raw.totalCost) || 0,
		daily,
		lastUpdated: Number(raw.lastUpdated) || Date.now(),
	};
}

export function readStatsLedger(): StatsLedger {
	try {
		const filePath = getStatsFilePath();
		if (!fs.existsSync(filePath)) {
			return createEmptyLedger();
		}
		const content = fs.readFileSync(filePath, 'utf-8');
		return normalizeLedger(JSON.parse(content) as unknown);
	} catch (error) {
		logWarning('Failed to read stats ledger:', true, {context: {error}});
		return createEmptyLedger();
	}
}

export function writeStatsLedger(ledger: StatsLedger): void {
	try {
		ensureAppDataDir();
		ledger.lastUpdated = Date.now();
		const filePath = getStatsFilePath();
		const tmpPath = `${filePath}.${process.pid}.tmp`;
		fs.writeFileSync(tmpPath, JSON.stringify(ledger, null, 2), 'utf-8');
		fs.renameSync(tmpPath, filePath);
	} catch (error) {
		logWarning('Failed to write stats ledger:', true, {
			context: {error: formatError(error)},
		});
	}
}

export function clearStatsLedger(): void {
	try {
		const filePath = getStatsFilePath();
		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath);
		}
	} catch (error) {
		logWarning('Failed to clear stats ledger:', true, {context: {error}});
	}
}

function ensureDaily(ledger: StatsLedger, dateKey: string): DailyStats {
	let day = ledger.daily.find(d => d.date === dateKey);
	if (!day) {
		day = {
			date: dateKey,
			sessions: 0,
			prompts: 0,
			tokens: 0,
			cost: 0,
			byPair: {},
		};
		ledger.daily.push(day);
		ledger.daily.sort((a, b) => a.date.localeCompare(b.date));
	}
	return day;
}

function ensurePair(
	day: DailyStats,
	provider: string,
	model: string,
): PairUsage {
	const key = makePairKey(provider, model);
	let pair = day.byPair[key];
	if (!pair) {
		pair = {tokens: 0, prompts: 0, cost: 0};
		day.byPair[key] = pair;
	}
	return pair;
}

function pruneDaily(ledger: StatsLedger): void {
	if (ledger.daily.length <= MAX_STATS_DAILY_DAYS) return;
	ledger.daily = ledger.daily.slice(-MAX_STATS_DAILY_DAYS);
}

/** Apply a session create (+1) for the given local day. */
export function applySessionIncrement(
	ledger: StatsLedger,
	dateKey: string = toLocalDateKey(),
): StatsLedger {
	const day = ensureDaily(ledger, dateKey);
	day.sessions += 1;
	ledger.totalSessions += 1;
	pruneDaily(ledger);
	return ledger;
}

/** Apply a user prompt (+1), attributed to provider/model. */
export function applyPromptIncrement(
	ledger: StatsLedger,
	provider: string,
	model: string,
	dateKey: string = toLocalDateKey(),
): StatsLedger {
	const day = ensureDaily(ledger, dateKey);
	day.prompts += 1;
	ledger.totalPrompts += 1;
	const pair = ensurePair(day, provider, model);
	pair.prompts += 1;
	pruneDaily(ledger);
	return ledger;
}

/** Apply token (+ optional cost) usage for a provider/model. */
export function applyTokenIncrement(
	ledger: StatsLedger,
	provider: string,
	model: string,
	tokens: number,
	cost = 0,
	dateKey: string = toLocalDateKey(),
): StatsLedger {
	if (!Number.isFinite(tokens) || tokens <= 0) {
		return ledger;
	}
	const safeCost = Number.isFinite(cost) && cost > 0 ? cost : 0;
	const day = ensureDaily(ledger, dateKey);
	day.tokens += tokens;
	day.cost += safeCost;
	ledger.totalTokens += tokens;
	ledger.totalCost += safeCost;
	const pair = ensurePair(day, provider, model);
	pair.tokens += tokens;
	pair.cost += safeCost;
	pruneDaily(ledger);
	return ledger;
}
