/**
 * Lifetime stats ledger persistence.
 *
 * Stored under the app-data directory as `stats.json` alongside usage.json
 * and sessions/. The original `.nanocoder-stats.json` filename is migrated on
 * first read. Override with NANOCODER_DATA_DIR / XDG_DATA_HOME in tests.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {getAppDataPath} from '@/config/paths';
import {formatError} from '@/utils/error-formatter';
import {logInfo, logWarning} from '@/utils/message-queue';
import {toLocalDateKey, toMonthKey} from './date-utils';
import type {DailyStats, MonthlyStats, PairUsage, StatsLedger} from './types';
import {
	createEmptyLedger as createEmptyLedgerBase,
	makePairKey,
	STATS_LEDGER_VERSION,
} from './types';

/** Canonical stats filename, matching other files in the app-data directory. */
export const STATS_FILE_NAME = 'stats.json';

/** Filename used by the original /stats implementation. */
export const LEGACY_STATS_FILE_NAME = '.nanocoder-stats.json';

/** Keep roughly a year of daily buckets; all-time totals remain uncapped. */
const MAX_STATS_DAILY_DAYS = 400;

const SUPPORTED_STATS_LEDGER_VERSIONS = new Set([1, 2]);
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/;

function isValidDateKey(value: string): boolean {
	if (!DATE_KEY_PATTERN.test(value)) return false;
	const [year, month, day] = value.split('-').map(Number);
	if (year < 1 || month < 1 || month > 12 || day < 1) return false;
	const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const daysInMonth = [
		31,
		leapYear ? 29 : 28,
		31,
		30,
		31,
		30,
		31,
		31,
		30,
		31,
		30,
		31,
	][month - 1];
	return daysInMonth !== undefined && day <= daysInMonth;
}

function isValidMonthKey(value: string): boolean {
	if (!MONTH_KEY_PATTERN.test(value)) return false;
	const year = Number(value.slice(0, 4));
	const month = Number(value.slice(5, 7));
	return year >= 1 && month >= 1 && month <= 12;
}

export function getStatsFilePath(): string {
	return path.join(getAppDataPath(), STATS_FILE_NAME);
}

function getLegacyStatsFilePath(): string {
	return path.join(getAppDataPath(), LEGACY_STATS_FILE_NAME);
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

function nonNegativeNumber(value: unknown): number {
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizePair(raw: unknown): PairUsage {
	if (!isRecord(raw)) {
		return {tokens: 0, prompts: 0, cost: 0};
	}
	return {
		tokens: nonNegativeNumber(raw.tokens),
		prompts: nonNegativeNumber(raw.prompts),
		cost: nonNegativeNumber(raw.cost),
	};
}

function normalizeDaily(raw: unknown): DailyStats | null {
	if (
		!isRecord(raw) ||
		typeof raw.date !== 'string' ||
		!isValidDateKey(raw.date)
	)
		return null;
	const byPairRaw = isRecord(raw.byPair) ? raw.byPair : {};
	const byPair: Record<string, PairUsage> = {};
	for (const [k, v] of Object.entries(byPairRaw)) {
		byPair[k] = normalizePair(v);
	}
	return {
		date: raw.date,
		sessions: nonNegativeNumber(raw.sessions),
		prompts: nonNegativeNumber(raw.prompts),
		tokens: nonNegativeNumber(raw.tokens),
		cost: nonNegativeNumber(raw.cost),
		byPair,
	};
}

function normalizeMonthly(raw: unknown): MonthlyStats | null {
	if (
		!isRecord(raw) ||
		typeof raw.month !== 'string' ||
		!isValidMonthKey(raw.month)
	)
		return null;
	const byPairRaw = isRecord(raw.byPair) ? raw.byPair : {};
	const byPair: Record<string, PairUsage> = {};
	for (const [k, v] of Object.entries(byPairRaw)) {
		byPair[k] = normalizePair(v);
	}
	return {
		month: raw.month,
		tokens: nonNegativeNumber(raw.tokens),
		cost: nonNegativeNumber(raw.cost),
		byPair,
	};
}

function mergePair(
	target: Record<string, PairUsage>,
	key: string,
	usage: PairUsage,
): void {
	const pair = target[key] ?? (target[key] = {tokens: 0, prompts: 0, cost: 0});
	pair.tokens += usage.tokens;
	pair.prompts += usage.prompts;
	pair.cost += usage.cost;
}

function deriveMonthly(daily: DailyStats[]): MonthlyStats[] {
	const byMonth = new Map<string, MonthlyStats>();
	for (const day of daily) {
		const month = toMonthKey(day.date);
		const aggregate = byMonth.get(month) ?? {
			month,
			tokens: 0,
			cost: 0,
			byPair: {},
		};
		aggregate.tokens += day.tokens;
		aggregate.cost += day.cost;
		for (const [key, usage] of Object.entries(day.byPair)) {
			mergePair(aggregate.byPair, key, usage);
		}
		byMonth.set(month, aggregate);
	}
	return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function normalizeLedger(raw: unknown): StatsLedger {
	if (!isRecord(raw)) {
		return createEmptyLedger();
	}
	const rawVersion = raw.version === undefined ? 1 : Number(raw.version);
	if (
		!Number.isInteger(rawVersion) ||
		!SUPPORTED_STATS_LEDGER_VERSIONS.has(rawVersion)
	) {
		throw new Error(`Unsupported stats ledger version: ${String(raw.version)}`);
	}
	const daily: DailyStats[] = [];
	if (Array.isArray(raw.daily)) {
		for (const entry of raw.daily) {
			const day = normalizeDaily(entry);
			if (day) daily.push(day);
		}
	}
	daily.sort((a, b) => a.date.localeCompare(b.date));
	const storedMonthly = Array.isArray(raw.monthly)
		? raw.monthly
				.map(normalizeMonthly)
				.filter((month): month is MonthlyStats => month !== null)
		: [];
	const monthly =
		storedMonthly.length > 0 ||
		(Array.isArray(raw.monthly) && daily.length === 0)
			? storedMonthly.sort((a, b) => a.month.localeCompare(b.month))
			: deriveMonthly(daily);
	return {
		version: STATS_LEDGER_VERSION,
		createdAt: nonNegativeNumber(raw.createdAt) || Date.now(),
		totalSessions: nonNegativeNumber(raw.totalSessions),
		totalPrompts: nonNegativeNumber(raw.totalPrompts),
		totalTokens: nonNegativeNumber(raw.totalTokens),
		totalCost: nonNegativeNumber(raw.totalCost),
		daily,
		monthly,
		lastUpdated: nonNegativeNumber(raw.lastUpdated) || Date.now(),
	};
}

function resolveStatsReadPath(): {filePath: string; isLegacy: boolean} {
	const currentPath = getStatsFilePath();
	if (fs.existsSync(currentPath)) {
		return {filePath: currentPath, isLegacy: false};
	}
	const legacyPath = getLegacyStatsFilePath();
	return {
		filePath: fs.existsSync(legacyPath) ? legacyPath : currentPath,
		isLegacy: fs.existsSync(legacyPath),
	};
}

export function readStatsLedger(): StatsLedger {
	try {
		const {filePath, isLegacy} = resolveStatsReadPath();
		if (!fs.existsSync(filePath)) {
			return createEmptyLedger();
		}
		const content = fs.readFileSync(filePath, 'utf-8');
		const parsed = JSON.parse(content) as unknown;
		const ledger = normalizeLedger(parsed);
		const needsSchemaMigration =
			isRecord(parsed) &&
			(parsed.version !== STATS_LEDGER_VERSION ||
				!Array.isArray(parsed.monthly));
		if (isLegacy || needsSchemaMigration) {
			// Write the validated, current-schema ledger before removing the old
			// filename. If writing fails, the source file remains recoverable.
			if (writeStatsLedger(ledger)) {
				if (isLegacy) {
					try {
						fs.unlinkSync(filePath);
						logInfo(`Migrated stats ledger to: ${getStatsFilePath()}`);
					} catch (error) {
						logWarning(
							'Migrated stats ledger but could not remove legacy file:',
							true,
							{
								context: {error: formatError(error)},
							},
						);
					}
				} else {
					logInfo('Migrated stats ledger to the current schema.');
				}
			}
		}
		return ledger;
	} catch (error) {
		logWarning('Failed to read stats ledger:', true, {context: {error}});
		return createEmptyLedger();
	}
}

export function writeStatsLedger(ledger: StatsLedger): boolean {
	try {
		ensureAppDataDir();
		ledger.version = STATS_LEDGER_VERSION;
		ledger.lastUpdated = Date.now();
		const filePath = getStatsFilePath();
		const tmpPath = `${filePath}.${process.pid}.tmp`;
		fs.writeFileSync(tmpPath, JSON.stringify(ledger, null, 2), 'utf-8');
		fs.renameSync(tmpPath, filePath);
		return true;
	} catch (error) {
		logWarning('Failed to write stats ledger:', true, {
			context: {error: formatError(error)},
		});
		return false;
	}
}

export function clearStatsLedger(): void {
	for (const filePath of [getStatsFilePath(), getLegacyStatsFilePath()]) {
		try {
			if (fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
			}
		} catch (error) {
			logWarning('Failed to clear stats ledger:', true, {
				context: {error: formatError(error)},
			});
		}
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

function ensureMonthly(ledger: StatsLedger, month: string): MonthlyStats {
	let aggregate = ledger.monthly.find(item => item.month === month);
	if (!aggregate) {
		aggregate = {month, tokens: 0, cost: 0, byPair: {}};
		ledger.monthly.push(aggregate);
		ledger.monthly.sort((a, b) => a.month.localeCompare(b.month));
	}
	return aggregate;
}

function pruneDaily(ledger: StatsLedger): void {
	if (ledger.daily.length <= MAX_STATS_DAILY_DAYS) return;
	ledger.daily = ledger.daily.slice(-MAX_STATS_DAILY_DAYS);
}

/** Apply session creates for the given local day. */
export function applySessionIncrement(
	ledger: StatsLedger,
	dateKey: string = toLocalDateKey(),
	count = 1,
): StatsLedger {
	if (!Number.isFinite(count) || count <= 0) {
		return ledger;
	}
	const day = ensureDaily(ledger, dateKey);
	day.sessions += count;
	ledger.totalSessions += count;
	pruneDaily(ledger);
	return ledger;
}

/** Apply user prompts, attributed to provider/model. */
export function applyPromptIncrement(
	ledger: StatsLedger,
	provider: string,
	model: string,
	dateKey: string = toLocalDateKey(),
	count = 1,
): StatsLedger {
	if (!Number.isFinite(count) || count <= 0) {
		return ledger;
	}
	const day = ensureDaily(ledger, dateKey);
	day.prompts += count;
	ledger.totalPrompts += count;
	const pair = ensurePair(day, provider, model);
	pair.prompts += count;
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
	const month = ensureMonthly(ledger, toMonthKey(dateKey));
	month.tokens += tokens;
	month.cost += safeCost;
	const monthlyPair =
		month.byPair[makePairKey(provider, model)] ??
		(month.byPair[makePairKey(provider, model)] = {
			tokens: 0,
			prompts: 0,
			cost: 0,
		});
	monthlyPair.tokens += tokens;
	monthlyPair.cost += safeCost;
	pruneDaily(ledger);
	return ledger;
}
