/**
 * Lifetime stats display for `/stats`.
 */

import {Box, Text, useFocus, useInput} from 'ink';
import {useMemo, useState} from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {buildStatsViewModel} from '@/stats/aggregators';
import {renderCumulativeChart} from '@/stats/chart';
import {STATS_RANGES, type StatsLedger, type StatsRange} from '@/stats/types';
import {formatCompactTokenCount, formatCost} from '@/usage/format';

function formatSince(createdAt: number, days: number): string {
	const d = new Date(createdAt);
	const month = d.toLocaleString('en-US', {month: 'short'});
	const year = d.getFullYear();
	return `${month} ${year} · ${days} day${days === 1 ? '' : 's'}`;
}

function formatPeak(date: string, tokens: number): string {
	return `${date} · ${formatCompactTokenCount(tokens)} tokens`;
}

function shareBar(share: number, width: number): string {
	const filled = Math.round(Math.min(1, Math.max(0, share)) * width);
	return `${'▇'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

function truncate(text: string, max: number): string {
	const chars = [...text];
	if (chars.length <= max) return text;
	if (max <= 1) return chars.slice(0, max).join('');
	return `${chars.slice(0, max - 1).join('')}…`;
}

function RangeTabs({
	range,
	colors,
}: {
	range: StatsRange;
	colors: {primary: string; secondary: string; info: string};
}) {
	return (
		<Box>
			<Text color={colors.secondary}>Range </Text>
			{STATS_RANGES.map((r, i) => {
				const selected = r === range;
				return (
					<Box key={r}>
						{i > 0 ? <Text color={colors.secondary}> | </Text> : null}
						<Text
							color={selected ? colors.primary : colors.secondary}
							bold={selected}
						>
							{selected ? `[${r}]` : r}
						</Text>
					</Box>
				);
			})}
		</Box>
	);
}

export interface StatsDisplayProps {
	/** Full ledger used to rebuild the card when the range tab changes. */
	ledger: StatsLedger;
	initialRange?: StatsRange;
	/** Disable keyboard capture (tests). */
	interactive?: boolean;
	now?: Date;
	/** Called when the user dismisses the live card (Esc / Enter / q). */
	onClose?: () => void;
}

export function StatsDisplay({
	ledger,
	initialRange = '7d',
	interactive = true,
	now,
	onClose,
}: StatsDisplayProps) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();
	const [range, setRange] = useState<StatsRange>(initialRange);

	const vm = useMemo(
		() => buildStatsViewModel(ledger, range, now ?? new Date()),
		[ledger, range, now],
	);

	useFocus({autoFocus: interactive, id: 'stats-display'});

	useInput(
		(input, key) => {
			if (!interactive) return;
			if (key.escape || key.return || input === 'q' || input === 'Q') {
				onClose?.();
				return;
			}
			// Match Settings tabs: left/right only (no letter shortcut).
			if (key.leftArrow) {
				const idx = STATS_RANGES.indexOf(range);
				const prev =
					STATS_RANGES[(idx - 1 + STATS_RANGES.length) % STATS_RANGES.length];
				if (prev) setRange(prev);
				return;
			}
			if (key.rightArrow) {
				const idx = STATS_RANGES.indexOf(range);
				const next = STATS_RANGES[(idx + 1) % STATS_RANGES.length];
				if (next) setRange(next);
			}
		},
		{isActive: interactive},
	);

	// Inner content width: box minus borders/padding.
	const contentWidth = Math.max(24, boxWidth - 8);
	const chart = renderCumulativeChart(vm.cumulative, {
		width: contentWidth,
	});
	const providerBarWidth = Math.max(6, Math.min(12, contentWidth - 36));
	const providerNameWidth = Math.min(
		12,
		Math.max(6, Math.floor(contentWidth * 0.22)),
	);
	const modelNameWidth = Math.min(
		14,
		Math.max(6, Math.floor(contentWidth * 0.28)),
	);

	const costLabel = vm.estCost != null ? formatCost(vm.estCost) : null;

	return (
		<TitledBoxWithPreferences
			title="Stats"
			width={boxWidth}
			borderColor={colors.info}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<RangeTabs range={range} colors={colors} />

			<Box marginTop={1} flexDirection="column" width={contentWidth}>
				{vm.isEmpty ? (
					<>
						<Text color={colors.secondary}>No activity in this range.</Text>
						<Text color={colors.secondary}>
							Send a prompt to start tracking.
						</Text>
					</>
				) : (
					<>
						<Box>
							<Text color={colors.secondary}>Sessions </Text>
							<Text color={colors.text}>{vm.sessions.toLocaleString()}</Text>
							{vm.since ? (
								<Text color={colors.secondary}>
									{'  '}Since {formatSince(vm.since.createdAt, vm.since.days)}
								</Text>
							) : null}
						</Box>
						<Box>
							<Text color={colors.secondary}>Prompts </Text>
							<Text color={colors.text}>{vm.prompts.toLocaleString()}</Text>
						</Box>
						<Box>
							<Text color={colors.secondary}>Tokens </Text>
							<Text color={colors.text}>
								{formatCompactTokenCount(vm.tokens)}
							</Text>
						</Box>
						{costLabel ? (
							<Box>
								<Text color={colors.secondary}>Est. cost </Text>
								<Text color={colors.text}>{costLabel}</Text>
							</Box>
						) : null}

						<Box marginTop={1} flexDirection="column">
							{vm.peakDay ? (
								<Text color={colors.secondary}>
									Peak day {formatPeak(vm.peakDay.date, vm.peakDay.tokens)}
								</Text>
							) : (
								<Text color={colors.secondary}>Peak day —</Text>
							)}
							<Text color={colors.secondary}>
								Streak {vm.streak.current} day
								{vm.streak.current === 1 ? '' : 's'}
								{vm.streak.best > 0 ? `  (best ${vm.streak.best})` : ''}
							</Text>
						</Box>

						<Box marginTop={1} flexDirection="column" width={contentWidth}>
							<Text color={colors.primary} bold>
								Cumulative tokens ({range})
							</Text>
							{chart.rows.map((row, i) => (
								<Text key={`r-${i}`} color={colors.text} wrap="truncate-end">
									{row}
								</Text>
							))}
							{chart.axis ? (
								<Text color={colors.secondary} wrap="truncate-end">
									{chart.axis}
								</Text>
							) : null}
						</Box>

						<Box marginTop={1} flexDirection="column" width={contentWidth}>
							<Text color={colors.primary} bold>
								Top providers · models
							</Text>
							{vm.topPairs.length === 0 ? (
								<Text color={colors.secondary}> —</Text>
							) : (
								vm.topPairs.map((pair, i) => (
									<Box
										key={`${pair.provider}-${pair.model}`}
										width={contentWidth}
									>
										<Text color={colors.secondary} wrap="truncate-end">
											{`${i + 1}.`.padEnd(3)}
											{truncate(pair.provider, providerNameWidth).padEnd(
												providerNameWidth,
											)}{' '}
											{truncate(pair.model, modelNameWidth).padEnd(
												modelNameWidth,
											)}{' '}
											{shareBar(pair.share, providerBarWidth)}{' '}
											{`${Math.round(pair.share * 100)}%`}
										</Text>
									</Box>
								))
							)}
						</Box>
					</>
				)}
			</Box>

			<Box marginTop={1}>
				<Text color={colors.secondary}>
					{interactive
						? '←/→ switch range · Esc/Enter close · /usage for this chat'
						: '/usage for this chat'}
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}
