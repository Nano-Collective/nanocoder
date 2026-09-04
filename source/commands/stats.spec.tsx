import test from 'ava';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {StatsDisplay} from '@/components/stats/stats-display';
import {lazyCommands} from '@/commands/lazy-registry';
import {
	createStatsDisplayElement,
	parseStatsRangeArg,
	statsCommand,
} from '@/commands/stats';
import {
	applyPromptIncrement,
	applySessionIncrement,
	applyTokenIncrement,
	createEmptyLedger,
} from '@/stats/storage';
import {makePairKey} from '@/stats/types';
import {renderWithTheme} from '@/test-utils/render-with-theme';

console.log('\nstats.spec.tsx');

test('lazy registry includes stats command', t => {
	const entry = lazyCommands.find(c => c.name === 'stats');
	t.truthy(entry);
	t.regex(entry!.description.toLowerCase(), /lifetime|stats|tokens/);
});

test('statsCommand exports expected name and description', t => {
	t.is(statsCommand.name, 'stats');
	t.truthy(statsCommand.description);
	t.is(typeof statsCommand.handler, 'function');
});

test('parseStatsRangeArg normalizes aliases', t => {
	t.is(parseStatsRangeArg([]), '7d');
	t.is(parseStatsRangeArg(['3m']), '3m');
	t.is(parseStatsRangeArg(['90d']), '3m');
	t.is(parseStatsRangeArg(['all']), 'all-time');
	t.is(parseStatsRangeArg(['all-time']), 'all-time');
});

test('createStatsDisplayElement returns a React element', t => {
	const element = createStatsDisplayElement({
		args: ['all-time'],
		interactive: false,
	});
	t.true(React.isValidElement(element));
});

test('StatsDisplay renders range tabs, chart, and top providers', t => {
	const ledger = createEmptyLedger(new Date(2026, 2, 1).getTime());
	applySessionIncrement(ledger, '2026-08-25');
	applyPromptIncrement(ledger, 'OpenRouter', 'gpt-5', '2026-08-25');
	applyTokenIncrement(ledger, 'OpenRouter', 'gpt-5', 550, 0.1, '2026-08-25');
	applyTokenIncrement(
		ledger,
		'OpenRouter',
		'claude-sonnet',
		300,
		0.05,
		'2026-08-25',
	);
	applyTokenIncrement(
		ledger,
		'OpenRouter',
		'deepseek-r1',
		150,
		0.02,
		'2026-08-25',
	);

	const {lastFrame} = renderWithTheme(
		<StatsDisplay
			ledger={ledger}
			initialRange="all-time"
			interactive={false}
			now={new Date(2026, 7, 25)}
		/>,
	);

	const frame = stripAnsi(lastFrame() ?? '');
	t.regex(frame, /Stats/);
	t.regex(frame, /\[all-time\]/);
	t.regex(frame, /Cumulative tokens \(all-time\)/);
	t.regex(frame, /Top providers/);
	t.regex(frame, /OpenRouter/);
	t.regex(frame, /gpt-5/);
	t.regex(frame, /Sessions/);
	t.regex(frame, /Prompts/);
	t.regex(frame, /Tokens/);
	t.regex(frame, /claude-sonnet/);
	t.regex(frame, /deepseek-r1/);
	t.true(ledger.daily[0]?.byPair[makePairKey('OpenRouter', 'gpt-5')] != null);
});

test('StatsDisplay changes range with arrow keys and closes on Escape', async t => {
	const ledger = createEmptyLedger(Date.now());
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<StatsDisplay ledger={ledger} initialRange="7d" interactive />,
	);
	const tick = () => new Promise(resolve => setTimeout(resolve, 20));

	stdin.write('\u001B[C');
	await tick();
	t.regex(stripAnsi(lastFrame() ?? ''), /\[3m\]/);

	stdin.write('\u001B[C');
	await tick();
	t.regex(stripAnsi(lastFrame() ?? ''), /\[all-time\]/);

	let closed = 0;
	unmount();
	renderWithTheme(
		<StatsDisplay
			ledger={ledger}
			initialRange="7d"
			interactive
			onClose={() => {
				closed++;
			}}
		/>,
	).stdin.write('\u001B');
	await tick();
	t.is(closed, 1);
});

test('StatsDisplay empty state', t => {
	const ledger = createEmptyLedger(Date.now());
	const {lastFrame} = renderWithTheme(
		<StatsDisplay ledger={ledger} initialRange="7d" interactive={false} />,
	);
	const frame = stripAnsi(lastFrame() ?? '');
	t.regex(frame, /No activity/i);
});
