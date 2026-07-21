import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {render} from 'ink-testing-library';
import test from 'ava';
import React from 'react';
// CRITICAL: force chalk/ink to emit real ANSI escapes (inverse-video cursor
// etc.) even though this process has no TTY — must be set BEFORE anything
// transitively imports chalk (chalk resolves its color level at import
// time), so this has to be the very first statement in the file.
process.env.FORCE_COLOR = '1';
// CRITICAL: redirect preference reads to a temp dir BEFORE settings-tabs (and
// its @/config/preferences import chain) loads.
process.env.NANOCODER_CONFIG_DIR = mkdtempSync(
	join(tmpdir(), 'nanocoder-spec-'),
);
const {resetPreferencesCache, getAlternateScreen} = await import(
	'@/config/preferences'
);
resetPreferencesCache();

const {renderWithTheme} = await import('../../test-utils/render-with-theme');
const {defaultTheme, themes} = await import('@/config/themes');
const {ThemeContext} = await import('@/hooks/useTheme');
const {TitleShapeContext} = await import('@/hooks/useTitleShape');
const {UIStateProvider} = await import('@/hooks/useUIState');
const {SettingsSelector} = await import('./settings-tabs');
type TitleShape = import('@/components/ui/styled-title').TitleShape;

/**
 * Renders SettingsSelector with an explicit title shape — renderWithTheme
 * hardcodes 'pill', but the shape-reuse specs below need to force a
 * different shape (e.g. 'arrow-double') to prove StyledTitle is really
 * driving the selected-tab render.
 */
function renderWithTitleShape(shape: TitleShape) {
	const themeValue = {
		currentTheme: defaultTheme,
		colors: themes[defaultTheme].colors,
		setCurrentTheme: () => {},
	};
	const titleShapeValue = {
		currentTitleShape: shape,
		setCurrentTitleShape: () => {},
	};
	return render(
		<ThemeContext.Provider value={themeValue}>
			<TitleShapeContext.Provider value={titleShapeValue}>
				<UIStateProvider>
					<SettingsSelector onCancel={() => {}} />
				</UIStateProvider>
			</TitleShapeContext.Provider>
		</ThemeContext.Provider>,
	);
}

console.log('\nsettings-tabs.spec.tsx');

const DOWN = '[B';
const LEFT = '[D';
const RIGHT = '[C';
const ESC = '';
const ENTER = '\r';

const tick = () => new Promise(resolve => setTimeout(resolve, 30));

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping real terminal escape codes for text-only assertions.
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, '');

/**
 * Matches the StyledTitle-rendered filled block for a given label: bold +
 * a background color escape (standard 4x, bright 10x, or truecolor) + a
 * foreground color escape, wrapping " label ", closed by the matching
 * resets. This is what marks the SELECTED tab, regardless of which
 * borderColor (focused vs unfocused) or theme palette produced the codes.
 */
const filledBlockRegex = (label: string) =>
	new RegExp(
		// biome-ignore lint/suspicious/noControlCharactersInRegex: matching real terminal escape codes.
		`\\x1b\\[1m\\x1b\\[[0-9;]*m\\x1b\\[[0-9;]*m ${label} \\x1b\\[39m\\x1b\\[49m\\x1b\\[22m`,
	);

/**
 * Count of filled-block background-color escapes anywhere in the raw
 * output — background-SET codes only (40-47, 100-107, or truecolor 48;2;…),
 * excluding the background-RESET code (49).
 */
const countBackgroundEscapes = (s: string) =>
	(s.match(/\x1b\[(4[0-7]|10[0-7]|48;2;\d+;\d+;\d+)m/g) ?? []).length;

test.beforeEach(() => {
	resetPreferencesCache();
});

test('renders all four category tabs with Appearance selected first', async t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();
	const output = lastFrame();
	t.truthy(output);
	t.truthy(output!.includes('Appearance'));
	t.truthy(output!.includes('Input'));
	t.truthy(output!.includes('Display'));
	t.truthy(output!.includes('Advanced'));
	// The selected tab is marked by the user's TitleShape system, not a
	// literal bracket string (ANSI escapes also contain '[', so compare
	// against the stripped text).
	t.falsy(stripAnsi(output!).includes('['));
	unmount();
});

test('left/right arrows move the selected-tab StyledTitle rendering', async t => {
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	const initial = lastFrame();
	t.truthy(initial);
	// Appearance starts selected: it carries the pill's filled background
	// ANSI sequence (bold + backgroundColor + textColor around the label).
	t.regex(initial!, filledBlockRegex('Appearance'));

	stdin.write(RIGHT);
	await tick();
	let output = lastFrame();
	t.truthy(output);
	t.regex(output!, filledBlockRegex('Input'));
	t.notRegex(output!, filledBlockRegex('Appearance'));

	stdin.write(LEFT);
	await tick();
	output = lastFrame();
	t.regex(output!, filledBlockRegex('Appearance'));

	unmount();
});

test('selected tab renders through the real StyledTitle pill shape, no bracket characters', async t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();
	const output = lastFrame();
	t.truthy(output);
	// Filled block: bold + background + text color wrapped around " Appearance ".
	t.regex(output!, filledBlockRegex('Appearance'));
	t.falsy(stripAnsi(output!).includes('['));
	unmount();
});

test('selected tab honors a non-pill TitleShape (arrow-double flank glyphs) around the active tab only', async t => {
	const {lastFrame, unmount} = renderWithTitleShape('arrow-double');
	await tick();
	const output = lastFrame();
	t.truthy(output);
	const plain = stripAnsi(output!);

	// arrow-double flanks the active tab's label with « ... » in the
	// visible (ANSI-stripped) text.
	t.regex(plain, /« Appearance »/);
	// The flank glyphs belong to Appearance's block only — no other « … »
	// pair exists in the row, and specifically not around "Input".
	const flankPairs = plain.match(/«[^»]*»/g) ?? [];
	t.is(flankPairs.length, 1);
	t.falsy(flankPairs[0]!.includes('Input'));

	unmount();
});

test('faux "Settings" label is present but is never selectable via arrow keys', async t => {
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	let output = lastFrame();
	t.truthy(output);
	t.truthy(output!.includes('Settings'));
	// The faux label never carries the selected tab's filled-background ANSI.
	t.notRegex(output!, filledBlockRegex('Settings'));

	// Cycle through every tab (4 tabs); "Settings" must never become the
	// marked tab.
	for (let i = 0; i < 4; i++) {
		stdin.write(RIGHT);
		await tick();
		output = lastFrame();
		t.notRegex(output!, filledBlockRegex('Settings'));
	}

	unmount();
});

test('unselected tabs carry no background/inverse ANSI', async t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();
	const output = lastFrame();
	t.truthy(output);

	// No inverse-video escape anywhere — the old bracket implementation used
	// `inverse` on the selected tab; the new one never does.
	t.notRegex(output!, /\x1b\[7m/);
	// Exactly one filled background block on the header row: the selected
	// tab's StyledTitle. Unselected tabs (and the faux "Settings" label)
	// contribute zero background escapes.
	t.is(countBackgroundEscapes(output!), 1);

	unmount();
});

test('each tab lists its expected setting rows', async t => {
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	// Search-filters to a single row so presence can be checked regardless
	// of the visible-row scroll window — each tab's row count varies, and
	// some tabs have more rows than fit in one page.
	const expectRow = async (label: string) => {
		stdin.write(DOWN);
		await tick();
		stdin.write(label);
		await tick();
		const output = lastFrame();
		t.truthy(output, `expected a frame while checking "${label}"`);
		t.truthy(output!.includes(label), `expected to find row "${label}"`);
		// Clear the query, then return focus to the header — ready for the
		// next row check (same tab) or a tab switch.
		stdin.write(ESC); // query non-empty: clears the query
		await tick();
		stdin.write(ESC); // query now empty: search -> header
		await tick();
	};

	// Appearance (default tab).
	await expectRow('Theme');
	await expectRow('Title Shape');
	await expectRow('Nanocoder Shape');
	await expectRow('Alternate Screen');

	// Input.
	stdin.write(RIGHT);
	await tick();
	await expectRow('Paste Threshold');
	await expectRow('Notifications');

	// Display.
	stdin.write(RIGHT);
	await tick();
	await expectRow('Tool Results and Thinking');

	// Advanced.
	stdin.write(RIGHT);
	await tick();
	await expectRow('Privacy');

	unmount();
});

test('typing in the search box filters the active tab settings list', async t => {
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	// Enter the Appearance tab's search box.
	stdin.write(DOWN);
	await tick();

	stdin.write('theme');
	await tick();

	const output = lastFrame();
	t.truthy(output);
	t.truthy(output!.includes('Theme'));
	// "Alternate Screen" shares no substring with "theme" — it should be filtered out.
	t.falsy(output!.includes('Alternate Screen'));

	unmount();
});

// Regression test: Ink parses every keypress out of one stdin chunk and
// delivers them synchronously in the same tick (ink's App.handleReadable
// loops over all parsed events and calls each useInput handler before
// React re-renders between them). A real user pressing the down arrow and
// then typing fast enough that the terminal/PTY delivers both in the same
// `data` chunk — not just paste, ordinary fast typing — reproduces this:
// unlike the test above (which awaits a tick between the arrow and the
// letters, giving focus state time to commit), this drives both in one
// `stdin.write` call so the header->search transition and the first typed
// characters land in the exact same synchronous batch.
test('typing that arrives in the same stdin chunk as the down-arrow still reaches the search box', async t => {
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	// One combined write: down arrow immediately followed by the query,
	// exactly as a real terminal can deliver a fast "press down, then type"
	// burst in a single stdin `data` event.
	stdin.write(`${DOWN}theme`);
	await tick();

	const output = lastFrame();
	t.truthy(output);
	// The label and the typed query render as separate differently-coloured
	// Text spans, so strip ANSI before checking they're contiguous — a raw
	// substring check would false-negative on the color-reset codes between
	// them even when the fix is working correctly.
	t.truthy(stripAnsi(output!).includes('theme'));
	// HTML-placeholder semantics: once a query is typed, the placeholder
	// label disappears entirely — it must not prefix the typed query.
	t.falsy(stripAnsi(output!).includes('Search settings…'));
	t.truthy(output!.includes('Theme'));
	t.falsy(output!.includes('Alternate Screen'));

	unmount();
});

test('Enter on the Alternate Screen boolean row flips the persisted preference', async t => {
	t.is(getAlternateScreen(), false);

	const {stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	// Filter down to the single boolean row so index 0 is deterministic.
	stdin.write(DOWN);
	await tick();
	stdin.write('Alternate');
	await tick();
	stdin.write(DOWN);
	await tick();
	stdin.write(ENTER);
	await tick();

	t.is(getAlternateScreen(), true);

	unmount();
});

// Regression coverage for the full Enter contract advertised by the search
// box's own footer hint ("Enter/↓ select"): Enter in search focus must move
// into the list with the first filtered row selected, and Enter ON a row
// must activate it. Includes the coalesced-chunk class from the gotcha
// above: Ink can fold a typed query and one or more trailing Enters into a
// SINGLE keypress event (`key.return` false, `input` containing literal
// `\r` characters) when a real terminal delivers them in one stdin chunk.

test('search + query, Enter moves into the list with the first filtered row selected', async t => {
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	stdin.write(DOWN);
	await tick();
	stdin.write('theme');
	await tick();
	stdin.write(ENTER);
	await tick();

	const output = lastFrame();
	t.truthy(output);
	// The Theme row is now the selected list row ("> " marker + info color),
	// not still sitting in the search box.
	t.regex(stripAnsi(output!), /> Theme\b/);
	t.truthy(output!.includes('Enter change'));

	unmount();
});

test('a second Enter on the selected row activates it: boolean flips on disk', async t => {
	// Other serial tests in this file share the same temp preferences file
	// and may have already flipped this boolean — assert the toggle, not an
	// assumed starting value.
	const before = getAlternateScreen();

	const {stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	stdin.write(DOWN);
	await tick();
	stdin.write('Alternate');
	await tick();
	stdin.write(ENTER); // search -> list, selects the single filtered row
	await tick();
	stdin.write(ENTER); // list: activates the selected row
	await tick();

	t.is(getAlternateScreen(), !before);

	unmount();
});

test('a second Enter on a managed row opens its sub-panel', async t => {
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	stdin.write(DOWN);
	await tick();
	stdin.write('Theme');
	await tick();
	stdin.write(ENTER); // search -> list
	await tick();
	stdin.write(ENTER); // list: activates -> opens the Theme sub-panel
	await tick();

	const output = lastFrame();
	t.truthy(output);
	t.falsy(output!.includes('Settings'));
	t.truthy(output!.includes('navigate'));

	unmount();
});

test('Enter directly on an empty query (no typing) still moves into the list', async t => {
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	stdin.write(DOWN);
	await tick();
	stdin.write(ENTER);
	await tick();

	const output = lastFrame();
	t.truthy(output);
	t.truthy(output!.includes('Enter change'));

	unmount();
});

test('"↓theme\\r" sent as ONE stdin chunk ends with the list focused and the query intact', async t => {
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	// Down-arrow, the typed query, and the trailing Enter all in a single
	// write — reproducing the terminal coalescing a fast "type then hit
	// Enter" burst into one stdin `data` chunk.
	stdin.write(`${DOWN}theme${ENTER}`);
	await tick();

	const output = lastFrame();
	t.truthy(output);
	const plain = stripAnsi(output!);
	// The query text survived (no stray `\r` got left dangling in it) and
	// the list is now focused on the Theme row.
	t.truthy(plain.includes('theme'));
	// HTML-placeholder semantics: an unfocused-with-query row shows only the
	// query, never the placeholder label prefixed in front of it.
	t.falsy(plain.includes('Search settings…'));
	t.regex(plain, /> Theme\b/);
	t.truthy(plain.includes('Enter change'));

	unmount();
});

// Regression test for the stale-closure bug: activateRow (replayed from the
// coalesced-chunk split above) read `filteredRows[clampedIndex]` from the
// render-time closure, which hadn't recomputed yet because the replayed
// typed segment's `setQuery` is async. "theme" is a false-positive target
// for this bug — Theme is ALSO the unfiltered index-0 row, so the stale
// (unfiltered) list and the correctly-filtered list agree by coincidence.
// "alternate" is not index 0 unfiltered (Alternate Screen is the LAST
// appearance row), so it actually distinguishes stale-unfiltered-index-0
// (would open the Theme sub-panel) from correctly-filtered (activates the
// Alternate Screen boolean row) behavior.
test('"↓alternate\\r\\r" sent as ONE stdin chunk flips the Alternate Screen preference, not the Theme panel', async t => {
	// Other serial tests in this file share the same temp preferences file —
	// assert the toggle, never an assumed starting value.
	const before = getAlternateScreen();

	const {lastFrame, stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	stdin.write(`${DOWN}alternate${ENTER}${ENTER}`);
	await tick();

	t.is(getAlternateScreen(), !before);

	const output = lastFrame();
	t.truthy(output);
	// The Theme sub-panel did NOT open: the tab bar/list frame is still
	// showing (the sub-panel view hides "Settings" and shows "navigate").
	t.truthy(output!.includes('Settings'));
	t.falsy(output!.includes('navigate'));

	unmount();
});

// Same stale-closure class, one Enter short of activation: proves the
// search->list transition itself lands on the correctly-filtered row (not
// just that the final activation happens to be right).
test('"↓alternate\\r" sent as ONE stdin chunk ends with the list focused and Alternate Screen selected', async t => {
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	stdin.write(`${DOWN}alternate${ENTER}`);
	await tick();

	const output = lastFrame();
	t.truthy(output);
	const plain = stripAnsi(output!);
	t.regex(plain, /> Alternate Screen\b/);
	t.truthy(plain.includes('Enter change'));

	unmount();
});

test('Enter on the Theme managed row opens the sub-panel, Esc returns to the list', async t => {
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	stdin.write(DOWN);
	await tick();
	stdin.write('Theme');
	await tick();
	stdin.write(DOWN);
	await tick();
	stdin.write(ENTER);
	await tick();

	let output = lastFrame();
	t.truthy(output);
	// The tab bar (including the faux "Settings" label) is hidden while the
	// sub-panel is open.
	t.falsy(output!.includes('Settings'));
	t.truthy(output!.includes('navigate'));

	stdin.write(ESC);
	await tick();

	output = lastFrame();
	t.truthy(output!.includes('Settings'));
	t.regex(output!, filledBlockRegex('Appearance'));

	unmount();
});

// On this branch the Appearance tab (the tab with the most rows) has exactly
// MAX_VISIBLE_ROWS (4) entries — Status Line lives on a separate, not-yet-
// upstream fork feature and is out of scope for this branch, so no tab
// currently overflows the visible window and the indicator can't be
// organically triggered here. Skipped rather than deleted: restore once any
// tab exceeds 4 rows (e.g. when Status Line lands on main).
test.skip('scroll indicator appears when items exceed the visible window', async t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	const output = lastFrame();
	t.truthy(output);
	t.truthy(output!.includes('more below'));

	unmount();
});

// Regression coverage for the real-text-field cursor (upstream PR 684 style
// "Filter: query_"): the search row must carry an inverse-video ANSI
// sequence, not just plain text — the search box previously echoed the
// query with no cursor glyph at all, so typing felt like invisible hotkey
// filtering rather than a focused text field.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching a real terminal inverse-video escape.
const INVERSE_RE = /\x1b\[7m/;

test('search-focused row renders an inverse-video cursor at the end of the query', async t => {
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	stdin.write(DOWN);
	await tick();
	stdin.write('theme');
	await tick();

	const output = lastFrame();
	t.truthy(output);
	// The inverse escape appears immediately after the typed query, not
	// merely somewhere in the frame (e.g. from an unrelated selected-tab
	// pill) — anchor on "theme" followed by the inverse-on code.
	t.regex(output!, /theme\x1b\[7m/);
	t.regex(output!, INVERSE_RE);

	unmount();
});

// HTML-placeholder semantics: once the query is non-empty, the placeholder
// label must disappear entirely, leaving only the glyph, the query, and the
// trailing inverse cursor — matching openclaude's SearchBox (focused
// non-empty branch renders ONLY query + cursor) and this repo's own
// text-input.tsx placeholder idiom.
test('search-focused row with a typed query does not render the placeholder label', async t => {
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	stdin.write(DOWN);
	await tick();
	stdin.write('the');
	await tick();

	const output = lastFrame();
	t.truthy(output);
	const plain = stripAnsi(output!);
	t.falsy(plain.includes('Search settings…'));
	t.truthy(plain.includes('the'));
	t.regex(output!, INVERSE_RE);

	unmount();
});

test('search-focused row with an empty query shows the placeholder with its first character inverse', async t => {
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	stdin.write(DOWN);
	await tick();

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, INVERSE_RE);
	t.truthy(stripAnsi(output!).includes('Search settings…'));

	unmount();
});

test('unfocused search row carries no inverse-video ANSI', async t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	// Header is focused by default — the search row is unfocused.
	const output = lastFrame();
	t.truthy(output);
	t.notRegex(output!, INVERSE_RE);

	unmount();
});

// Regression coverage for ranked (not just substring) fuzzy filtering,
// matching upstream PR 684's ranked "Filter:" behavior: a prefix match must
// outrank a mere fuzzy/subsequence match for the same query, even though
// both survive the filter.
test('fuzzy ranking: a prefix match outranks a weaker subsequence match for the same query', async t => {
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	// Appearance tab (default): "Theme" starts with "the" (prefix, score
	// 850); "Title Shape" only matches "the" as a scattered subsequence
	// (t...h...e, score well below 700) — both survive the filter, but
	// Theme must render first.
	stdin.write(DOWN);
	await tick();
	stdin.write('the');
	await tick();

	const output = lastFrame();
	t.truthy(output);
	const plain = stripAnsi(output!);
	t.truthy(plain.includes('Theme'));
	t.truthy(plain.includes('Title Shape'));
	const themeIndex = plain.indexOf('Theme');
	const titleShapeIndex = plain.indexOf('Title Shape');
	t.true(themeIndex >= 0 && titleShapeIndex >= 0);
	t.true(themeIndex < titleShapeIndex);

	unmount();
});

// Ctrl+U (readline "clear to start of line") clears the whole query — this
// row's cursor is always at the end, so there's nothing after it to keep.
test('Ctrl+U in search focus clears the whole query', async t => {
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	stdin.write(DOWN);
	await tick();
	stdin.write('theme');
	await tick();
	t.truthy(stripAnsi(lastFrame()!).includes('theme'));

	stdin.write('\x15'); // Ctrl+U
	await tick();

	const output = lastFrame();
	t.truthy(output);
	const plain = stripAnsi(output!);
	t.falsy(plain.includes('theme'));
	t.truthy(plain.includes('Search settings…'));
	// Back to an empty query: every Appearance row is visible again.
	t.truthy(plain.includes('Alternate Screen'));

	unmount();
});

// The list view now deliberately draws TWO rounded-border boxes: the outer
// dialog panel, and the search box nested inside it (ported from
// openclaude's SearchBox — src/components/SearchBox.tsx). A managed
// sub-panel replaces this entire view (its own TitledBoxWithPreferences is
// the only border on screen at that point), so this spec only covers the
// list view.
test('the list view frame has exactly two rounded-border boxes: outer panel + search box', async t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	const output = lastFrame();
	t.truthy(output);
	const lines = output!.split('\n');

	// One top-border line for the outer panel, one for the search box.
	const topBorderLines = lines.filter(line => line.includes('╭'));
	t.is(topBorderLines.length, 2);

	// Likewise two bottom-border lines.
	const bottomBorderLines = lines.filter(line => line.includes('╰'));
	t.is(bottomBorderLines.length, 2);

	unmount();
});

// Regression coverage for the openclaude-styled search box port: the
// magnifier prefix glyph must be present in the search row, and the search
// box's border color must key on focus (a different ANSI color escape when
// focused vs unfocused), exactly like openclaude's
// `borderColor={isFocused ? "suggestion" : undefined}` /
// `borderDimColor={!isFocused}` pair.

test('search row renders the magnifier glyph prefix', async t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	const output = lastFrame();
	t.truthy(output);
	t.truthy(stripAnsi(output!).includes('⌕ '));

	unmount();
});

test('search box border color differs between focused and unfocused states', async t => {
	const {lastFrame, stdin, unmount} = renderWithTheme(
		<SettingsSelector onCancel={() => {}} />,
	);
	await tick();

	// Header focused by default — the search box border is unfocused.
	const unfocusedOutput = lastFrame();
	t.truthy(unfocusedOutput);
	// The search box's top-border line is the second "╭" line (the outer
	// panel's top border is the first).
	const unfocusedTopBorder = unfocusedOutput!
		.split('\n')
		.filter(line => line.includes('╭'))[1];
	t.truthy(unfocusedTopBorder);
	const unfocusedColorCodes = unfocusedTopBorder!.match(/\x1b\[[0-9;]*m/g);
	t.truthy(unfocusedColorCodes && unfocusedColorCodes.length > 0);

	// Move focus into the search box.
	stdin.write(DOWN);
	await tick();

	const focusedOutput = lastFrame();
	t.truthy(focusedOutput);
	const focusedTopBorder = focusedOutput!
		.split('\n')
		.filter(line => line.includes('╭'))[1];
	t.truthy(focusedTopBorder);
	const focusedColorCodes = focusedTopBorder!.match(/\x1b\[[0-9;]*m/g);
	t.truthy(focusedColorCodes && focusedColorCodes.length > 0);

	// The two border-color ANSI sequences differ — focused and unfocused
	// use different color tokens (colors.info vs colors.secondary).
	t.notDeepEqual(unfocusedColorCodes, focusedColorCodes);

	unmount();
});
