import fs from 'fs';
import {Box, Text} from 'ink';
import BigText from 'ink-big-text';
import Gradient from 'ink-gradient';
import path from 'path';
import {memo} from 'react';
import {fileURLToPath} from 'url';
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

// One block-style wordmark everywhere: the full "NANOCODER" renders in the
// block font on terminals from 90 cols up; below that we fall back to "NC"
// so the monogram never wraps. Same block font in both cases — just a
// shorter glyph string on narrow screens.
const BLOCK_NANOCODER_WIDTH = 90;
const LOGO_FULL = 'NANOCODER';
const LOGO_SHORT = 'NC';
const LOGO_FONT = 'block';

type LogoKind = 'block';

// Approximate rendered height per tier (glyph rows + cfonts blank padding),
// used only for the 1/3-top vertical centering estimate.
const LOGO_ROW_HEIGHTS: Record<LogoKind, number> = {
	block: 9,
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

	// Vertical centering: mimic mock's 1/3 top, 2/3 bottom when tall enough
	const logoRows = logoText ? LOGO_ROW_HEIGHTS.block : 0;
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
		</Box>
	);
});
