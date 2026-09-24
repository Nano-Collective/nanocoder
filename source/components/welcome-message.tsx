import {Box, Text} from 'ink';
import BigText from 'ink-big-text';
import Gradient from 'ink-gradient';
import {memo, useState, useSyncExternalStore} from 'react';
import {
	getNanocoderShape,
	getPreferencesVersion,
	subscribeToPreferences,
} from '@/config/preferences';
import {useResponsiveTerminal, useTerminalRows} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {
	formatGitStatusSummary,
	getGitStatusSummarySync,
} from '@/tools/git/utils';
import {DEFAULT_NANOCODER_SHAPE, type NanocoderShape} from '@/types/ui';
import {getPackageVersion, UNKNOWN_VERSION} from '@/utils/package-version';
import {homeRelative, truncateMiddle} from '@/utils/path';
import {wrapWithTrimmedContinuations} from '@/utils/text-wrapping';
import {getRandomTip} from '@/utils/tips';

// Resolve the version once at module load time to avoid repeated file reads.
const packageVersion = getPackageVersion();

// One wordmark everywhere: the full "NANOCODER" renders when the terminal is
// wide enough for it, otherwise we fall back to the "NC" monogram so it never
// wraps. Same font in both cases — just a shorter glyph string on narrow
// screens.
const LOGO_FULL = 'NANOCODER';
const LOGO_SHORT = 'NC';

// The font is a user preference (Settings → Nanocoder Shape), which is why the
// width and height budgets below are per-font rather than the single
// block-sized pair of constants they used to be: "NANOCODER" is 36 cols wide
// in chrome and 160 in 3d, and the wordmark is 6 rows tall in chrome and 15 in
// huge, so one hardcoded threshold either clips the tall fonts or needlessly
// withholds the short ones.

type LogoMetrics = {
	/** Columns "NANOCODER" occupies. */
	full: number;
	/** Columns the "NC" monogram occupies. */
	short: number;
	/** Rows the wordmark occupies, cfonts' own blank padding included. */
	rows: number;
};

// Measured from cfonts' font data: width is the sum of the glyph widths plus
// letterspacing, height is the font's glyph rows plus the blank lines cfonts
// pads above and below.
const LOGO_METRICS: Record<NanocoderShape, LogoMetrics> = {
	block: {full: 87, short: 20, rows: 10},
	slick: {full: 56, short: 13, rows: 10},
	tiny: {full: 38, short: 9, rows: 6},
	grid: {full: 44, short: 10, rows: 10},
	pallet: {full: 56, short: 13, rows: 10},
	shade: {full: 45, short: 10, rows: 12},
	simple: {full: 64, short: 14, rows: 8},
	simpleBlock: {full: 94, short: 22, rows: 11},
	'3d': {full: 160, short: 35, rows: 13},
	simple3d: {full: 75, short: 17, rows: 11},
	chrome: {full: 36, short: 8, rows: 7},
	huge: {full: 126, short: 28, rows: 15},
};

// cfonts wraps against the real terminal width, not the Ink box it lands in,
// so leave a couple of columns of slack before committing to a glyph string.
const LOGO_WRAP_MARGIN = 3;

// Kept verbatim in sync with the GitHub repo description so the banner and
// the repo say the same thing.
const TAGLINE =
	'An open coding agent for your terminal, built by a community collective rather than a company. Bring your own model, keep your code on your machine, and owe nothing to anyone.';
// Narrower than the terminal so the tagline breaks into a readable block
// instead of one edge-to-edge run on wide screens.
const TAGLINE_MAX_WIDTH = 72;

const MENU_FULL: Array<[string, string]> = [
	['Resume session', '/resume'],
	['Select model', '/model'],
	['Help', '/help'],
	['Quit', '/exit'],
];

const MENU_MIN: Array<[string, string]> = [
	['Help', '/help'],
	['Quit', '/exit'],
];

// Rows the banner occupies at its three sizes, measured at 80 columns: the
// header, tagline and location block come to 11, a two-item menu brings that
// to 14, and the full four-item menu to 16. The wordmark costs whatever its
// font is tall on top of that (LOGO_METRICS). Thresholds are these heights, so
// each rung is only offered when it fits.
const MENU_MIN_ROWS = 14;
const MENU_FULL_ROWS = 16;

type WelcomeMessageProps = {
	/**
	 * Pin the tip shown under the banner. Defaults to a random one held for
	 * the life of the component; tests pass an explicit tip so they can assert
	 * exact text instead of scanning the catalogue.
	 */
	tip?: string;
	/**
	 * Rows the banner actually has. Fullscreen mode clips at the viewport,
	 * which is the terminal minus the input footer, so budgeting against the
	 * raw terminal height silently cut the menu and tip on an 80x24 screen.
	 * Defaults to the terminal height for callers that are not clipped.
	 */
	availableRows?: number;
};

export default memo(function WelcomeMessage({
	tip,
	availableRows,
}: WelcomeMessageProps = {}) {
	const {actualWidth} = useResponsiveTerminal();
	const rows = useTerminalRows();
	const {colors} = useTheme();
	const [randomTip] = useState(getRandomTip);
	const shownTip = tip ?? randomTip;

	const version = packageVersion;
	const cwd = homeRelative(process.cwd());
	const gitStatus = getGitStatusSummarySync();

	const budget = availableRows ?? rows;

	// The shape is written straight to disk by the settings panel, so subscribe
	// to preference writes explicitly. Without this the banner keeps the font it
	// mounted with, which reads as the setting doing nothing.
	useSyncExternalStore(subscribeToPreferences, getPreferencesVersion);
	const logoFont = getNanocoderShape() ?? DEFAULT_NANOCODER_SHAPE;
	// Fall back to the default metrics for a hand-edited preferences.json naming
	// a font we have no measurements for.
	const logoMetrics =
		LOGO_METRICS[logoFont] ?? LOGO_METRICS[DEFAULT_NANOCODER_SHAPE];

	// Wordmark — full NANOCODER on terminals wide enough for it, NC monogram
	// below that (same font, just a shorter string). It is the first thing
	// dropped when rows are tight: the menu and tip are what a new user needs,
	// and it goes too when even the monogram would wrap.
	let logoText: string | null = null;
	if (budget >= MENU_FULL_ROWS + logoMetrics.rows) {
		if (actualWidth >= logoMetrics.full + LOGO_WRAP_MARGIN) {
			logoText = LOGO_FULL;
		} else if (actualWidth >= logoMetrics.short + LOGO_WRAP_MARGIN) {
			logoText = LOGO_SHORT;
		}
	}

	// Each menu row is a single line this wide: label, gap, key. A menu is only
	// offered when that line fits the width too, or its rows wrap apart.
	const menuWidth = (items: Array<[string, string]>) =>
		Math.max(...items.map(([l, k]) => l.length + k.length)) + 4;

	let menu: Array<[string, string]> = [];
	if (budget >= MENU_FULL_ROWS && menuWidth(MENU_FULL) <= actualWidth) {
		menu = MENU_FULL;
	} else if (budget >= MENU_MIN_ROWS && menuWidth(MENU_MIN) <= actualWidth) {
		menu = MENU_MIN;
	}

	const branchLabel = (() => {
		if (!gitStatus) return null;
		const {branch, marker} = formatGitStatusSummary(gitStatus);
		return marker ? `${branch} (${marker})` : branch;
	})();

	const colW = menu.length > 0 ? menuWidth(menu) : 0;

	// Full terminal width for every row so the wordmark and the text below it
	// share one center axis — a capped box would sit left of the centered
	// logo on wide screens.
	const termW = actualWidth;
	const justify = 'center';

	// Wrap here rather than letting Ink do it: a wrapping <Text> fills the
	// whole row, so justifyContent would have nothing left to center. Splitting
	// into rows first lets each line sit on the same center axis as the logo.
	const taglineLines = wrapWithTrimmedContinuations(
		TAGLINE,
		Math.max(20, Math.min(termW - 4, TAGLINE_MAX_WIDTH)),
	)
		.split('\n')
		// wrap-ansi keeps the break's space at the end of the line; centering a
		// line with a trailing space nudges its text half a column off axis.
		.map(line => line.trimEnd());

	// Location line must fit even when stale (e.g., 44-char branch·dir in 50-col term).
	// Branch shrinks too: 2 (⎇ ) + 3 ( · ) + 10 (cwd min) = 15 reserved cols,
	// +1 safety col — some fonts render ⎇/· wider than ink measures them.
	const locationDisplay = (() => {
		if (!branchLabel) {
			return {
				branchLabel: null as string | null,
				cwd: truncateMiddle(cwd, Math.max(10, termW - 5)),
			};
		}
		const branchBudget = Math.max(6, termW - 16);
		const shortBranch = truncateMiddle(branchLabel, branchBudget);
		const branchPart = `⎇ ${shortBranch} · `;
		const cwdBudget = Math.max(10, termW - branchPart.length - 3);
		return {branchLabel: shortBranch, cwd: truncateMiddle(cwd, cwdBudget)};
	})();

	return (
		<Box
			flexDirection="column"
			width={termW}
			height={Math.max(0, budget - 1)}
			justifyContent="center"
			marginBottom={1}
		>
			{logoText && (
				<Box justifyContent={justify} width={termW}>
					<Gradient colors={[colors.primary, colors.tool]}>
						<BigText text={logoText} font={logoFont} />
					</Gradient>
				</Box>
			)}

			<Box justifyContent={justify} width={termW}>
				<Text>
					<Text color={colors.text} bold>
						nanocoder
					</Text>
					<Text color={colors.secondary}>
						{version === UNKNOWN_VERSION
							? ' (version unknown)'
							: ` v${version}`}
					</Text>
				</Text>
			</Box>
			<Box justifyContent={justify} width={termW} marginTop={1}>
				<Text color={colors.text} bold>
					Welcome to Nanocoder
				</Text>
			</Box>
			{taglineLines.map(line => (
				<Box key={line} justifyContent={justify} width={termW}>
					<Text color={colors.secondary}>{line}</Text>
				</Box>
			))}

			<Box justifyContent={justify} width={termW} marginTop={1}>
				<Text>
					{locationDisplay.branchLabel ? (
						<>
							<Text color={colors.primary}>
								⎇ {locationDisplay.branchLabel}
							</Text>
							<Text color={colors.secondary}> · </Text>
							<Text color={colors.secondary}>{locationDisplay.cwd}</Text>
						</>
					) : (
						<Text color={colors.secondary}>{locationDisplay.cwd}</Text>
					)}
				</Text>
			</Box>

			{menu.length > 0 && (
				<Box
					flexDirection="column"
					alignItems="center"
					width={termW}
					marginTop={1}
				>
					{menu.map(([label, key]) => {
						const gap = Math.max(3, colW - label.length - key.length);
						return (
							<Box key={label} justifyContent={justify} width={termW}>
								<Text>
									<Text color={colors.text} bold>
										{label}
									</Text>
									<Text>{' '.repeat(gap)}</Text>
									<Text color={colors.secondary} dimColor>
										{key}
									</Text>
								</Text>
							</Box>
						);
					})}
				</Box>
			)}

			<Box justifyContent={justify} width={termW} marginTop={1}>
				<Text color={colors.secondary} dimColor>
					Tip: {shownTip}
				</Text>
			</Box>
		</Box>
	);
});
