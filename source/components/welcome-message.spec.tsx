import fs from 'fs';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'path';
import {fileURLToPath} from 'url';
import test from 'ava';
import React from 'react';
import stripAnsi from 'strip-ansi';

// CRITICAL: redirect preference reads to a temp dir BEFORE the banner (and its
// @/config/preferences import chain) loads. The wordmark font is a preference,
// so without this the developer's own Nanocoder Shape decides which glyphs the
// assertions below see.
process.env.NANOCODER_CONFIG_DIR = mkdtempSync(
	path.join(tmpdir(), 'nanocoder-welcome-spec-'),
);
const {resetPreferencesCache, savePreferences} = await import(
	'@/config/preferences'
);
resetPreferencesCache();

const {renderWithTheme} = await import('../test-utils/render-with-theme.js');
const WelcomeMessage = (await import('./welcome-message')).default;

console.log('\nwelcome-message.spec.tsx');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(
	fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'),
) as {version: string};

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/**
 * Column the first non-space character of the line matching `pattern` sits in,
 * with colour codes stripped so they do not count toward the offset.
 */
function indentOf(frame: string, pattern: RegExp): number {
	const line = frame
		.split('\n')
		.map(l => l.replace(ANSI, ''))
		.find(l => pattern.test(l));

	if (line === undefined) {
		throw new Error(`no line matched ${pattern}`);
	}

	return line.search(/\S/);
}
const VERSION = packageJson.version;

// ============================================================================
// Narrow Terminal Tests (width < 90 → text logo per mock ladder)
// ============================================================================

test('WelcomeMessage renders compact layout for narrow terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.true(output!.length > 0);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows version in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, new RegExp(VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
	// Footer shows nanocoder + version, not title banner
	t.regex(output!, /nanocoder/);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows centered welcome and location in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Welcome to Nanocoder/);
	// Tagline matches the GitHub repo description, wrapped across rows.
	t.regex(output!, /An open coding agent for your terminal/);
	t.regex(output!, /owe nothing to anyone\./);
	// Location line centered with branch + dir (no NC shorthand)
	t.regex(output!, /⎇/);
	// Menu present when rows >=24
	t.regex(output!, /Resume session/);
	t.regex(output!, /Help/);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows the given tip in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(<WelcomeMessage tip="Short pinned tip." />);
	const output = lastFrame() ?? '';

	t.true(output.includes('Tip: Short pinned tip.'));
	process.stdout.columns = originalColumns;
});

test('WelcomeMessage has no hero box in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(<WelcomeMessage availableRows={40} />);

	const output = lastFrame();
	t.truthy(output);
	// New design removed TitledBox hero — should NOT contain old box text
	t.notRegex(output!, /Tips for getting started/);
	t.notRegex(output!, /Quick tips/);
	// Small pixel logo (tiny) for 50-90, not spaced text
	t.regex(output!, /█/);

	process.stdout.columns = originalColumns;
});

// ============================================================================
// Normal Terminal Tests (80 <= width < 90 still text logo per 90 threshold)
// ============================================================================

test('WelcomeMessage renders NC monogram at widths below 82', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(<WelcomeMessage availableRows={40} />);

	const output = lastFrame();
	t.truthy(output);
	// 80 < 82 → falls back to NC monogram in block font
	t.regex(output!, /█/);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows welcome message for normal terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Welcome to Nanocoder/);
	// Tagline matches the GitHub repo description, wrapped across rows.
	t.regex(output!, /An open coding agent for your terminal/);
	t.regex(output!, /owe nothing to anyone\./);
	t.regex(output!, new RegExp(VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows menu for normal terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Resume session/);
	t.regex(output!, /Select model/);
	t.regex(output!, /Quit/);
	// New design footer has mode + version
	t.regex(output!, /nanocoder/);
	t.regex(output!, new RegExp(VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows location and shortcuts for normal terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /⎇/);
	t.regex(output!, /\/resume/);
	t.regex(output!, /\/model/);
	t.regex(output!, /\/help/);
	t.regex(output!, /\/exit/);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage centers version, location, and menu', t => {
    const originalColumns = process.stdout.columns;
    process.stdout.columns = 80;
	const {lastFrame} = renderWithTheme(<WelcomeMessage availableRows={40} />);
	const output = stripAnsi(lastFrame() ?? '');
	t.true(indentOf(output, /nanocoder v/) > 15, 'version should be centered');
	t.true(indentOf(output, /⎇/) > 15, 'location should be centered');
	t.true(indentOf(output, /Resume session/) > 15, 'menu should be centered');
	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows the given tip in full layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 120;

	const {lastFrame} = renderWithTheme(<WelcomeMessage tip="Short pinned tip." />);
	const output = lastFrame() ?? '';

	t.true(output.includes('Tip: Short pinned tip.'));
	process.stdout.columns = originalColumns;
});

test('WelcomeMessage renders the tip at various column widths', t => {
	const originalColumns = process.stdout.columns;

	for (const columns of [50, 120]) {
		process.stdout.columns = columns;

		const {lastFrame} = renderWithTheme(
			<WelcomeMessage tip="Short pinned tip." />,
		);
		const output = lastFrame() ?? '';

		t.true(
			output.includes('Tip: Short pinned tip.'),
			`tip is missing at ${columns} columns`,
		);
	}

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage falls back to a catalogue tip when none is given', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 120;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);
	const output = lastFrame() ?? '';

	// Only the label is asserted. ink-testing-library renders to a fixed 100
	// column stdout regardless of process.stdout.columns, so a long catalogue
	// tip wraps and a full-string match would break on tip length rather than
	// on anything this test cares about. getRandomTip's own spec covers which
	// tip comes back.
	t.regex(output, /Tip: \S/);
	process.stdout.columns = originalColumns;
});

// ============================================================================
// Wide Terminal Tests (width >= 90 → full BigText art)
// ============================================================================

test('WelcomeMessage renders full art logo for wide terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 120;

	const {lastFrame} = renderWithTheme(<WelcomeMessage availableRows={40} />);

	const output = lastFrame();
	t.truthy(output);
	// Large art (simple) renders with _ | \ etc, small (tiny) with █ — either is art
	t.regex(output!, /[_█]/);
	t.regex(output!, /Welcome to Nanocoder/);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage shows centered footer for wide terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 120;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /nanocoder/);
	t.regex(output!, new RegExp(VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

	process.stdout.columns = originalColumns;
});

// ============================================================================
// Component Structure Tests
// ============================================================================

test('WelcomeMessage renders without crashing', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	t.truthy(lastFrame());

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage has consistent layout structure', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.true(output!.length > 0);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage displays gradient text', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.true(output!.length > 0);

	process.stdout.columns = originalColumns;
});

// ============================================================================
// Edge Cases — responsive ladder rows
// ============================================================================

test('WelcomeMessage handles boundary at width 80', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(<WelcomeMessage availableRows={40} />);

	const output = lastFrame();
	t.truthy(output);
	// NC block monogram is identical at every width
	t.regex(output!, /█/);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage handles boundary at width 90', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 90;

	const {lastFrame} = renderWithTheme(<WelcomeMessage availableRows={40} />);

	const output = lastFrame();
	t.truthy(output);
	// At 90 the full NANOCODER block wordmark renders (threshold is 90)
	t.regex(output!, /[_█]/);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage fits the viewport of a standard 80x24 terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	// 80x24 is the default size of most terminal emulators. Fullscreen hands
	// the banner the terminal minus the input footer and the frame padding, so
	// it must fit in ~17 rows: the menu and the tip matter more than the logo.
	const {lastFrame} = renderWithTheme(
		<WelcomeMessage tip="Short pinned tip." availableRows={17} />,
	);

	const output = stripAnsi(lastFrame() ?? '');
	t.true(output.split('\n').length <= 18, 'banner must fit the viewport');
	t.regex(output, /Resume session/);
	t.regex(output, /\/exit/);
	t.regex(output, /Tip: Short pinned tip\./);
	t.notRegex(output, /█/);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage trims the menu when the banner has under 16 rows', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 100;

	// 15 rows fits the two-item menu (14) but not the four-item one (16).
	const {lastFrame} = renderWithTheme(<WelcomeMessage availableRows={15} />);

	const output = lastFrame();
	t.truthy(output);
	// MIN menu only Help/Quit when short
	t.notRegex(output!, /Resume session/);
	t.regex(output!, /Help/);
	t.regex(output!, /Quit/);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage hides the menu when the banner has under 14 rows', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 100;

	// Below the two-item menu's own height, only the header block is offered.
	const {lastFrame} = renderWithTheme(<WelcomeMessage availableRows={13} />);

	const output = lastFrame();
	t.truthy(output);
	t.notRegex(output!, /Resume session/);
	t.notRegex(output!, /Help/);
	t.regex(output!, /Welcome to Nanocoder/);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage hides logo when rows < 16', t => {
	const originalColumns = process.stdout.columns;
	const originalRows = process.stdout.rows;
	process.stdout.columns = 100;
	// @ts-ignore
	process.stdout.rows = 14;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.notRegex(output!, /N A N O C O D E R/);
	t.notRegex(output!, /█/);
	t.regex(output!, /Welcome to Nanocoder/);

	process.stdout.columns = originalColumns;
	process.stdout.rows = originalRows;
});

test('WelcomeMessage handles very narrow terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 30;

	const {lastFrame} = renderWithTheme(<WelcomeMessage />);

	const output = lastFrame();
	t.truthy(output);
	t.true(output!.length > 0);

	process.stdout.columns = originalColumns;
});

test('WelcomeMessage handles very wide terminal', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 200;

	const {lastFrame} = renderWithTheme(<WelcomeMessage availableRows={40} />);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /[_█]/);

	process.stdout.columns = originalColumns;
});

// ============================================================================
// Nanocoder Shape — the wordmark font is a user preference
// ============================================================================

/**
 * Width of the rendered wordmark, found by measuring the widest line built
 * from `font`'s own glyph characters. Distinguishes the full "NANOCODER" from
 * the "NC" monogram without depending on cfonts' exact glyph layout.
 */
function logoWidth(frame: string, glyphs: RegExp): number {
	const widths = stripAnsi(frame)
		.split('\n')
		.filter(line => glyphs.test(line))
		// trim both ends: the banner centres the wordmark, so the leading pad
		// would otherwise count as glyph width.
		.map(line => line.trim().length);

	return widths.length > 0 ? Math.max(...widths) : 0;
}

// Every font that draws with full blocks uses █, so identify the block font by
// a run only its 6-row glyphs produce - tiny's 2-row glyphs never reach three.
const BLOCK_GLYPHS = /███/;
const TINY_NA = /█▄ █ ▄▀█/;
const CHROME_N = /╔╗╔/;
const CHROME_GLYPHS = /[╔╗╝╚╠╦╩═║╩╬]/;
// The 3d font draws in runs of backslashes; nothing else in the banner does.
const THREE_D_GLYPHS = /\\{3}/;

test('WelcomeMessage renders the wordmark in the configured Nanocoder Shape', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 100;
	t.teardown(() => {
		savePreferences({});
		process.stdout.columns = originalColumns;
	});

	savePreferences({nanocoderShape: 'tiny'});

	const output = stripAnsi(
		renderWithTheme(<WelcomeMessage availableRows={40} />).lastFrame() ?? '',
	);

	t.regex(output, TINY_NA, 'wordmark must use the configured font');
	t.notRegex(output, BLOCK_GLYPHS, 'block font must not survive the preference');
});

test('WelcomeMessage repaints the wordmark when the shape preference changes', async t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 100;
	t.teardown(() => {
		savePreferences({});
		process.stdout.columns = originalColumns;
	});

	const {lastFrame} = renderWithTheme(<WelcomeMessage availableRows={40} />);
	t.regex(stripAnsi(lastFrame() ?? ''), BLOCK_GLYPHS, 'block is the default');

	// The settings panel writes straight to disk, so the banner only follows
	// along if it subscribed to preference writes — the bug this covers is the
	// shape changing and nothing on screen moving.
	savePreferences({nanocoderShape: 'chrome'});
	await new Promise(resolve => setTimeout(resolve, 50));

	const after = stripAnsi(lastFrame() ?? '');
	t.regex(after, CHROME_N, 'wordmark must follow the new shape');
	t.notRegex(after, BLOCK_GLYPHS);
});

test('WelcomeMessage sizes the width threshold to the chosen font', t => {
	const originalColumns = process.stdout.columns;
	// 50 cols is below block's 90-col threshold, so block would fall back to
	// the monogram here. chrome's "NANOCODER" is only 36 cols, so it fits.
	process.stdout.columns = 50;
	t.teardown(() => {
		savePreferences({});
		process.stdout.columns = originalColumns;
	});

	savePreferences({nanocoderShape: 'chrome'});

	const output = stripAnsi(
		renderWithTheme(<WelcomeMessage availableRows={40} />).lastFrame() ?? '',
	);

	t.true(
		logoWidth(output, CHROME_GLYPHS) > 30,
		'the full wordmark must render when the font is narrow enough for it',
	);
});

test('WelcomeMessage drops the wordmark when the font is wider than the terminal', t => {
	const originalColumns = process.stdout.columns;
	// 3d's monogram alone is 35 cols wide.
	process.stdout.columns = 30;
	t.teardown(() => {
		savePreferences({});
		process.stdout.columns = originalColumns;
	});

	savePreferences({nanocoderShape: '3d'});

	const output = stripAnsi(
		renderWithTheme(<WelcomeMessage availableRows={40} />).lastFrame() ?? '',
	);

	t.notRegex(output, THREE_D_GLYPHS, 'a wordmark that cannot fit must be dropped');
	t.notRegex(output, BLOCK_GLYPHS, 'and no other font stands in for it');
	t.regex(output, /Welcome to Nanocoder/, 'the rest of the banner stays');
});

test('WelcomeMessage sizes the row budget to the chosen font', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 100;
	t.teardown(() => {
		savePreferences({});
		process.stdout.columns = originalColumns;
	});

	// 22 rows is the four-item menu (16) plus tiny's 6-row wordmark, but six
	// short of what the block wordmark needs.
	savePreferences({nanocoderShape: 'tiny'});
	const withTiny = stripAnsi(
		renderWithTheme(<WelcomeMessage availableRows={22} />).lastFrame() ?? '',
	);
	t.regex(withTiny, TINY_NA, 'a short font still fits in 22 rows');

	savePreferences({});
	const withBlock = stripAnsi(
		renderWithTheme(<WelcomeMessage availableRows={22} />).lastFrame() ?? '',
	);
	t.notRegex(withBlock, BLOCK_GLYPHS, 'the taller default does not');
});
test('WelcomeMessage subtitle is the project description, not local-first coding agent', t => {
        const {lastFrame} = renderWithTheme(<WelcomeMessage availableRows={40} />);
        const output = stripAnsi(lastFrame() ?? '');
        t.regex(output, /community collective/);
        t.regex(output, /rather than a company/);
        t.notRegex(output, /local-first coding agent/i);
});
