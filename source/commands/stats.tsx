/**
 * /stats command — lifetime usage metrics (distinct from /usage context view).
 *
 * The interactive card (←/→ range switching, matching Settings tabs) is
 * mounted as a live component that captures input, so the chat composer does
 * not swallow the keys. Closing it leaves a static snapshot in the transcript.
 */

import React from 'react';
import {errorMsg, infoMsg} from '@/components/message-factory';
import {StatsDisplay} from '@/components/stats/stats-display';
import {generateKey} from '@/session/key-generator';
import {
	flushStatsLedgerSync,
	getStatsLedgerCached,
	resetStatsLedger,
} from '@/stats/record';
import {STATS_RANGES, type StatsRange} from '@/stats/types';
import type {StatefulCommand} from '@/types/index';

export const statsCommand: StatefulCommand = {
	name: 'stats',
	description:
		'Show lifetime usage stats (sessions, prompts, tokens). Ranges: 7d, 3m, all-time; ←/→ to switch; use reset to clear',
	run: async context => {
		const trimmed = context.argText.trim();
		const args = trimmed ? trimmed.split(/\s+/) : [];
		const resetArg = args[0]?.toLowerCase();
		if (resetArg === 'reset' || resetArg === '--reset') {
			if (args.length !== 1) {
				context.addToChatQueue(
					errorMsg('Usage: /stats [7d|3m|all-time|reset]', 'stats-error'),
				);
				return 'done';
			}
			resetStatsLedger();
			context.addToChatQueue(infoMsg('Lifetime stats reset.', 'stats-reset'));
			return 'done';
		}

		context.setLiveComponentCapturesInput(true);

		const until = new Promise<void>(resolve => {
			const close = () => {
				// Leave a static snapshot in the transcript, then release focus.
				context.addToChatQueue(
					createStatsDisplayElement({args, interactive: false}),
				);
				context.setLiveComponent(null);
				context.setLiveComponentCapturesInput(false);
				resolve();
			};

			context.setLiveComponent(
				createStatsDisplayElement({args, interactive: true, onClose: close}),
			);
		});

		return {until};
	},
};

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
