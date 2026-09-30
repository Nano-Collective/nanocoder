/**
 * /stats command — lifetime usage metrics (distinct from /usage context view).
 *
 * Interactive UI (←/→ range switching, matching Settings tabs) is mounted as a
 * live component from `app-util.ts` so keyboard focus is not stolen by the chat
 * composer. This module exports the stub for the lazy registry plus helpers
 * used by that live-mount path and by tests.
 */

import React from 'react';
import {createStubCommand} from '@/commands/create-stub-command';
import {StatsDisplay} from '@/components/stats/stats-display';
import {generateKey} from '@/session/key-generator';
import {flushStatsLedgerSync, getStatsLedgerCached} from '@/stats/record';
import {STATS_RANGES, type StatsRange} from '@/stats/types';

export const statsCommand = createStubCommand(
	'stats',
	'Show lifetime usage stats (sessions, prompts, tokens). Ranges: 7d, 3m, all-time; ←/→ to switch; use reset to clear',
);

export function parseStatsRangeArg(args: string[]): StatsRange {
	const raw = (args[0] ?? '').toLowerCase().trim();
	if (raw === '7d' || raw === '7') return '7d';
	if (raw === '3m' || raw === '3' || raw === '90d') return '3m';
	if (raw === 'all' || raw === 'all-time' || raw === 'alltime')
		return 'all-time';
	return '7d';
}

/** Build the interactive (or static) stats card from the current ledger. */
export function createStatsDisplayElement(options: {
	args?: string[];
	interactive?: boolean;
	onClose?: () => void;
}): React.ReactElement {
	flushStatsLedgerSync();
	const ledger = getStatsLedgerCached();
	const initialRange = parseStatsRangeArg(options.args ?? []);
	const range = STATS_RANGES.includes(initialRange) ? initialRange : '7d';

	return React.createElement(StatsDisplay, {
		key: generateKey('stats'),
		ledger,
		initialRange: range,
		interactive: options.interactive ?? true,
		onClose: options.onClose,
	});
}
