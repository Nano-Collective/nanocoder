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

import {getShutdownManager} from '@/utils/shutdown';
import {toLocalDateKey} from './date-utils';
import {
	applyPromptIncrement,
	applySessionIncrement,
	applyTokenIncrement,
	readStatsLedger,
	writeStatsLedger,
} from './storage';
import type {StatsLedger} from './types';

const FLUSH_DEBOUNCE_MS = 400;
export const STATS_SHUTDOWN_HANDLER_NAME = 'stats-ledger-flush';

let cached: StatsLedger | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
let shutdownRegistered = false;

/** Test/helpers: reset module state. */
export function _resetStatsRecorderForTests(): void {
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	cached = null;
	dirty = false;
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

/** Force a synchronous flush (tests / shutdown). */
export function flushStatsLedgerSync(): void {
	if (!dirty || !cached) return;
	writeStatsLedger(cached);
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

export function recordSessionCreated(dateKey?: string): void {
	const ledger = getLedger();
	applySessionIncrement(ledger, dateKey ?? toLocalDateKey());
	scheduleFlush();
}

export function recordUserPrompt(
	provider: string,
	model: string,
	dateKey?: string,
): void {
	const ledger = getLedger();
	applyPromptIncrement(
		ledger,
		provider || 'unknown',
		model || 'unknown',
		dateKey ?? toLocalDateKey(),
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
	const ledger = getLedger();
	applyTokenIncrement(
		ledger,
		provider || 'unknown',
		model || 'unknown',
		tokens,
		cost,
		dateKey ?? toLocalDateKey(),
	);
	scheduleFlush();
}

export type ApiUsageLike = {
	provider: string;
	model: string;
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
};

/**
 * Production path used by App / plain / subagent hooks: resolve tokens +
 * estimated USD cost (via models.dev pricing) then persist. Never throws.
 */
export async function recordApiCallForStats(
	record: ApiUsageLike,
	options?: {
		dateKey?: string;
		getPricing?: (
			model: string,
		) => Promise<{input: number; output: number} | null>;
	},
): Promise<void> {
	try {
		const {buildResponseUsageBounded} = await import('@/usage/response-usage');
		const usage = await buildResponseUsageBounded(
			{
				inputTokens: record.inputTokens,
				outputTokens: record.outputTokens,
				totalTokens: record.totalTokens,
			},
			record.model,
			{getPricing: options?.getPricing},
		);

		const tokens =
			(usage && Number.isFinite(usage.totalTokens)
				? (usage.totalTokens as number)
				: undefined) ??
			(Number.isFinite(record.totalTokens)
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

/** Invalidate cache after external clear (tests). */
export function invalidateStatsCache(): void {
	cached = null;
	dirty = false;
}
