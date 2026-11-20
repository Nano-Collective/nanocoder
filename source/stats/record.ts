/**
 * Non-blocking stats increment API.
 *
 * Mutations update an in-memory ledger immediately and schedule a debounced
 * atomic disk flush so chat rendering is never blocked on I/O.
 *
 * Because the debounce timer is `unref()`'d (so idle CLIs can exit), callers
 * MUST flush on process exit: `ensureStatsFlushOnShutdown()` registers with
 * ShutdownManager, and plain/headless paths call `finalizeStatsForExit()`.
 */

import type {ModelInfo} from '@/models/models-types';
import {notifyWarning} from '@/utils/message-queue-core';
import {getShutdownManager} from '@/utils/shutdown';
import {toLocalDateKey} from './date-utils';
import {
	applyPromptIncrement,
	applySessionIncrement,
	applyTokenIncrement,
	backupStatsLedgerFile,
	clearStatsLedger,
	createEmptyLedger,
	readStatsLedger,
	readStatsLedgerResult,
	type StatsLedgerReadResult,
	writeStatsLedger,
} from './storage';
import {parsePairKey, type StatsLedger} from './types';

const FLUSH_DEBOUNCE_MS = 400;
export const STATS_SHUTDOWN_HANDLER_NAME = 'stats-ledger-flush';

let cached: StatsLedger | null = null;
let pending: StatsLedger | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
let shutdownRegistered = false;
let resetGeneration = 0;
/** Warn once per process about a ledger file we refuse to overwrite. */
let blockedLedgerReported = false;

/** Test/helpers: reset module state. */
export function _resetStatsRecorderForTests(): void {
	resetGeneration += 1;
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	cached = null;
	pending = null;
	dirty = false;
	blockedLedgerReported = false;
	if (shutdownRegistered) {
		try {
			getShutdownManager().unregister(STATS_SHUTDOWN_HANDLER_NAME);
		} catch {
			// ignore
		}
		shutdownRegistered = false;
	}
}

/** Cancel pending debounce without writing (tests simulate early exit). */
export function _cancelPendingFlushForTests(): void {
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
}

function getLedger(): StatsLedger {
	if (!cached) {
		cached = readStatsLedger();
	}
	return cached;
}

/**
 * Register a shutdown handler once so TUI quit / SIGINT still persists
 * the ledger after the unref'd debounce timer is dropped.
 */
export function ensureStatsFlushOnShutdown(): void {
	if (shutdownRegistered) return;
	shutdownRegistered = true;
	try {
		getShutdownManager().register({
			name: STATS_SHUTDOWN_HANDLER_NAME,
			// Before TUI teardown (0), after session autosave (-10).
			priority: -5,
			handler: async () => {
				finalizeStatsForExit();
			},
		});
	} catch {
		shutdownRegistered = false;
	}
}

function scheduleFlush(): void {
	dirty = true;
	ensureStatsFlushOnShutdown();
	if (flushTimer) return;
	flushTimer = setTimeout(() => {
		flushTimer = null;
		flushStatsLedgerSync();
	}, FLUSH_DEBOUNCE_MS);
	// Don't keep the process alive solely for stats flush — exit paths
	// must call finalizeStatsForExit / shutdown handler instead.
	if (typeof flushTimer === 'object' && 'unref' in flushTimer) {
		flushTimer.unref();
	}
}

/**
 * An existing ledger file that is corrupt or was written by a newer Nanocoder
 * must never be replaced: keep the data on disk, tell the user once, and leave
 * this session's totals in memory.
 */
function handleBlockedLedger(read: StatsLedgerReadResult): void {
	// Stop retrying: every flush would hit the same unreadable file.
	dirty = false;
	if (blockedLedgerReported) return;
	blockedLedgerReported = true;
	const backupPath = read.sourcePath
		? backupStatsLedgerFile(read.sourcePath)
		: null;
	const reason =
		read.blockedBy === 'unsupported-version'
			? 'was written by a newer Nanocoder'
			: 'could not be read';
	notifyWarning(
		`Stats ledger ${reason}; leaving it untouched${backupPath ? ` (backup: ${backupPath})` : ''}.`,
	);
}

/** Force a synchronous flush (tests / shutdown). */
export function flushStatsLedgerSync(): void {
	if (!dirty || !pending) return;

	const read = readStatsLedgerResult();
	if (!read.writable) {
		handleBlockedLedger(read);
		return;
	}
	const merged = read.ledger;
	for (const day of pending.daily) {
		if (day.sessions > 0) {
			applySessionIncrement(merged, day.date, day.sessions);
		}
		for (const [key, usage] of Object.entries(day.byPair)) {
			const {provider, model} = parsePairKey(key);
			if (usage.prompts > 0) {
				applyPromptIncrement(merged, provider, model, day.date, usage.prompts);
			}
			if (usage.tokens > 0) {
				applyTokenIncrement(
					merged,
					provider,
					model,
					usage.tokens,
					usage.cost,
					day.date,
				);
			}
		}
	}
	if (!writeStatsLedger(merged)) {
		return;
	}
	cached = merged;
	pending = null;
	dirty = false;
}

/**
 * Cancel debounce and flush immediately. Call at the end of plain/headless
 * runs and from the shutdown handler.
 */
export function finalizeStatsForExit(): void {
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	flushStatsLedgerSync();
}

/** Clear persisted and in-memory lifetime stats. */
export function resetStatsLedger(): void {
	resetGeneration += 1;
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	cached = null;
	pending = null;
	dirty = false;
	blockedLedgerReported = false;
	if (shutdownRegistered) {
		try {
			getShutdownManager().unregister(STATS_SHUTDOWN_HANDLER_NAME);
		} catch {
			// ignore
		}
		shutdownRegistered = false;
	}
	clearStatsLedger();
}

export function recordSessionCreated(dateKey?: string): void {
	const key = dateKey ?? toLocalDateKey();
	applySessionIncrement(getLedger(), key);
	applySessionIncrement((pending ??= createEmptyLedger()), key);
	scheduleFlush();
}

export function recordUserPrompt(
	provider: string,
	model: string,
	dateKey?: string,
): void {
	const safeProvider = provider || 'unknown';
	const safeModel = model || 'unknown';
	const key = dateKey ?? toLocalDateKey();
	applyPromptIncrement(getLedger(), safeProvider, safeModel, key);
	applyPromptIncrement(
		(pending ??= createEmptyLedger()),
		safeProvider,
		safeModel,
		key,
	);
	scheduleFlush();
}

export function recordTokenUsage(params: {
	provider: string;
	model: string;
	tokens: number;
	cost?: number;
	dateKey?: string;
}): void {
	const {provider, model, tokens, cost = 0, dateKey} = params;
	if (!Number.isFinite(tokens) || tokens <= 0) return;
	const safeProvider = provider || 'unknown';
	const safeModel = model || 'unknown';
	const key = dateKey ?? toLocalDateKey();
	applyTokenIncrement(getLedger(), safeProvider, safeModel, tokens, cost, key);
	applyTokenIncrement(
		(pending ??= createEmptyLedger()),
		safeProvider,
		safeModel,
		tokens,
		cost,
		key,
	);
	scheduleFlush();
}

export type ApiUsageLike = {
	provider: string;
	model: string;
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
};

/**
 * Production path used by App / plain / subagent hooks: resolve tokens +
 * estimated USD cost (via models.dev pricing) then persist. Never throws.
 */
export async function recordApiCallForStats(
	record: ApiUsageLike,
	options?: {
		dateKey?: string;
		getPricing?: (model: string) => Promise<ModelInfo['cost'] | null>;
	},
): Promise<void> {
	const generation = resetGeneration;
	try {
		const {buildResponseUsageBounded} = await import('@/usage/response-usage');
		const usage = await buildResponseUsageBounded(
			{
				inputTokens: record.inputTokens,
				outputTokens: record.outputTokens,
				totalTokens: record.totalTokens,
				cacheReadTokens: record.cacheReadTokens,
				cacheWriteTokens: record.cacheWriteTokens,
			},
			record.model,
			{getPricing: options?.getPricing},
		);
		// A reset may have happened while pricing was resolving. Do not let a
		// pre-reset request repopulate the freshly cleared ledger.
		if (generation !== resetGeneration) return;

		const reportedTotal =
			usage && Number.isFinite(usage.totalTokens)
				? (usage.totalTokens as number)
				: undefined;
		const reportedInputOutput =
			(usage && Number.isFinite(usage.inputTokens)
				? (usage.inputTokens as number)
				: 0) +
			(usage && Number.isFinite(usage.outputTokens)
				? (usage.outputTokens as number)
				: 0);
		const reportedCacheOnly =
			usage &&
			!Number.isFinite(usage.inputTokens) &&
			!Number.isFinite(usage.outputTokens)
				? (Number.isFinite(usage.cacheReadTokens)
						? (usage.cacheReadTokens as number)
						: 0) +
					(Number.isFinite(usage.cacheWriteTokens)
						? (usage.cacheWriteTokens as number)
						: 0)
				: 0;
		const tokens =
			(reportedTotal !== undefined &&
			(reportedTotal > 0 ||
				(reportedInputOutput === 0 && reportedCacheOnly === 0))
				? reportedTotal
				: reportedInputOutput > 0
					? reportedInputOutput
					: reportedCacheOnly > 0
						? reportedCacheOnly
						: Number.isFinite(record.totalTokens)
							? (record.totalTokens as number)
							: undefined) ??
			(Number(record.inputTokens) || 0) + (Number(record.outputTokens) || 0);

		if (!tokens || tokens <= 0) return;

		const cost =
			usage && Number.isFinite(usage.cost) && (usage.cost as number) > 0
				? (usage.cost as number)
				: 0;

		recordTokenUsage({
			provider: record.provider,
			model: record.model,
			tokens,
			cost,
			dateKey: options?.dateKey,
		});
	} catch {
		// Stats must never break chat.
	}
}

/** Read-through for the UI (uses cache if warm). */
export function getStatsLedgerCached(): StatsLedger {
	return getLedger();
}
