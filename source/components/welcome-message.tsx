import fs from 'fs';
import {Box, Text} from 'ink';
import BigText from 'ink-big-text';
import Gradient from 'ink-gradient';
import path from 'path';
import {memo} from 'react';
import {fileURLToPath} from 'url';
import {loadDefaultMode} from '@/config/index';
import {useResponsiveTerminal, useTerminalRows} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {
	formatGitStatusSummary,
	getGitStatusSummarySync,
} from '@/tools/git/utils';
import {homeRelative, truncateMiddle} from '@/utils/path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageJson = JSON.parse(
	fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'),
) as {version: string};

// Block-style logo at every size: ASCII can't shrink, so each width tier gets
// the largest block-family font that fits (widths measured for "NANOCODER").
// min = glyph width + wrap margin (cfonts wraps against the real terminal width).
const LOGO_TIERS = [
	{min: 90, font: 'block'},
	{min: 62, font: 'slick'},
	{min: 50, font: 'shade'},
] as const;

type LogoKind = (typeof LOGO_TIERS)[number]['font'] | 'text';

// Approximate rendered height per tier (glyph rows + cfonts blank padding),
// used only for the 1/3-top vertical centering estimate.
const LOGO_ROW_HEIGHTS: Record<LogoKind, number> = {
	block: 9,
	slick: 8,
	shade: 9,
	text: 1,
};

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

export default memo(function WelcomeMessage() {
	const {actualWidth} = useResponsiveTerminal();
	const rows = useTerminalRows();
	const {colors} = useTheme();

	const version = packageJson.version;
	const mode = loadDefaultMode() ?? 'normal';
	const cwd = homeRelative(process.cwd());
	const gitStatus = getGitStatusSummarySync();

	// Pick the largest block-style logo that fits; very short terminals skip it
	// to protect the menu rows.
	let logoKind: LogoKind | null = null;
	if (rows >= 16) {
		logoKind = LOGO_TIERS.find(tier => actualWidth >= tier.min)?.font ?? 'text';
	}

	let menu: Array<[string, string]> = [];
	if (rows >= 15) {
		menu = rows < 24 ? MENU_MIN : MENU_FULL;
	}

	// Vertical centering: mimic mock's 1/3 top, 2/3 bottom when tall enough
	const logoRows = logoKind ? LOGO_ROW_HEIGHTS[logoKind] : 0;
	const welcomeRows = 2; // Welcome + subtitle
	const locationRows = 1;
	const menuRows = menu.length;
	const footerRows = 1;
	const gaps = 3; // between logo/welcome, welcome/location, location/menu, menu/footer
	const contentRows =
		logoRows + welcomeRows + locationRows + menuRows + footerRows + gaps;
	const topPad = Math.max(0, Math.floor((rows - contentRows - 1) / 3));

	const branchLabel = (() => {
		if (!gitStatus) return null;
		const {branch, marker} = formatGitStatusSummary(gitStatus);
		return marker ? `${branch} (${marker})` : branch;
	})();

	const colW =
		menu.length > 0
			? Math.max(...menu.map(([l, k]) => l.length + k.length)) + 4
			: 0;

	// Full terminal width for every row — the mockup centers all content on one
	// shared axis, so the wordmark and the text below it must share the same
	// center. A capped box would sit left of the centered logo on wide screens.
	const termW = actualWidth;
	// Centered at every size — narrow looks like wide, per the mockup
	const justify = 'center';

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
			{topPad > 0 &&
				Array.from({length: topPad}).map((_, i) => (
					<Text key={`pad-${i}`}> </Text>
				))}

			{logoKind && (
				<Box justifyContent={justify} width={termW}>
					{logoKind === 'text' ? (
						<Gradient colors={[colors.primary, colors.tool]}>
							<Text bold>N A N O C O D E R</Text>
						</Gradient>
					) : (
						<Gradient colors={[colors.primary, colors.tool]}>
							<BigText text="NANOCODER" font={logoKind} />
						</Gradient>
					)}
				</Box>
			)}

			<Box justifyContent={justify} width={termW} marginTop={logoKind ? 1 : 0}>
				<Text color={colors.text} bold>
					Welcome to Nanocoder
				</Text>
			</Box>
			<Box justifyContent={justify} width={termW}>
				<Text color={colors.secondary}>local-first coding agent</Text>
			</Box>

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

			<Box
				width={termW}
				justifyContent="space-between"
				marginTop={1}
				paddingX={1}
			>
				<Text color={colors.secondary} dimColor>
					{mode}
				</Text>
				<Text>
					<Text color={colors.text} bold>
						nanocoder
					</Text>
					<Text color={colors.secondary}> v{version}</Text>
				</Text>
			</Box>
		</Box>
	);
});
