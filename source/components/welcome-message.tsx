import {Box, Text} from 'ink';
import BigText from 'ink-big-text';
import Gradient from 'ink-gradient';
import {memo, useState} from 'react';
import {useResponsiveTerminal, useTerminalRows} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {
	formatGitStatusSummary,
	getGitStatusSummarySync,
} from '@/tools/git/utils';
import {getPackageVersion} from '@/utils/package-version';
import {homeRelative, truncateMiddle} from '@/utils/path';
import {wrapWithTrimmedContinuations} from '@/utils/text-wrapping';
import {getRandomTip} from '@/utils/tips';

// Resolve the version once at module load time to avoid repeated file reads.
const packageVersion = getPackageVersion();

// One block-style wordmark everywhere: the full "NANOCODER" renders in the
// block font on terminals from 90 cols up; below that we fall back to "NC"
// so the monogram never wraps. Same block font in both cases — just a
// shorter glyph string on narrow screens.
const BLOCK_NANOCODER_WIDTH = 90;
const LOGO_FULL = 'NANOCODER';
const LOGO_SHORT = 'NC';
const LOGO_FONT = 'block';

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

type WelcomeMessageProps = {
	/**
	 * Pin the tip shown under the banner. Defaults to a random one held for
	 * the life of the component; tests pass an explicit tip so they can assert
	 * exact text instead of scanning the catalogue.
	 */
	tip?: string;
};

export default memo(function WelcomeMessage({tip}: WelcomeMessageProps = {}) {
	const {actualWidth} = useResponsiveTerminal();
	const rows = useTerminalRows();
	const {colors} = useTheme();
	const [randomTip] = useState(getRandomTip);
	const shownTip = tip ?? randomTip;

	const version = packageVersion;
	const cwd = homeRelative(process.cwd());
	const gitStatus = getGitStatusSummarySync();

	// Block wordmark in every screen — full NANOCODER on wide terminals, NC
	// monogram on narrow (same block font, just shorter string). Short
	// terminals (rows < 16) skip it to protect the menu rows.
	let logoText: string | null = null;
	if (rows >= 16) {
		logoText = actualWidth >= BLOCK_NANOCODER_WIDTH ? LOGO_FULL : LOGO_SHORT;
	}

	let menu: Array<[string, string]> = [];
	if (rows >= 15) {
		menu = rows < 24 ? MENU_MIN : MENU_FULL;
	}

	const branchLabel = (() => {
		if (!gitStatus) return null;
		const {branch, marker} = formatGitStatusSummary(gitStatus);
		return marker ? `${branch} (${marker})` : branch;
	})();

	const colW =
		menu.length > 0
			? Math.max(...menu.map(([l, k]) => l.length + k.length)) + 4
			: 0;

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
		<Box flexDirection="column" width={termW} marginBottom={1}>
			{logoText && (
				<Box justifyContent={justify} width={termW}>
					<Gradient colors={[colors.primary, colors.tool]}>
						<BigText text={logoText} font={LOGO_FONT} />
					</Gradient>
				</Box>
			)}

			<Box justifyContent={justify} width={termW}>
				<Text>
					<Text color={colors.text} bold>
						nanocoder
					</Text>
					<Text color={colors.secondary}> v{version}</Text>
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
