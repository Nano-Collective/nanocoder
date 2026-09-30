import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import chalk from 'chalk';
import {DEFAULT_THEME, highlight} from 'cli-highlight';
import {getSyntaxTheme, themes} from '@/config/themes';
import {resetPreferencesCache, savePreferences} from '@/config/preferences';

// AVA runs each spec in its own non-TTY process, where chalk disables colour and
// every formatter becomes a no-op. Force truecolor so the escapes are assertable.
chalk.level = 3;

// getSyntaxTheme reads the `syntaxTheme` preference, so point every test at a
// config directory of its own — a contributor who sets that preference must not
// change what this spec sees.
const configRoot = join(tmpdir(), `nanocoder-themes-spec-${process.pid}`);

/** Point the config lookup at a directory holding exactly `preferences`. */
function useConfigDir(name: string, preferences: Record<string, unknown>): void {
	const dir = join(configRoot, name);
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, 'nanocoder-preferences.json'),
		JSON.stringify(preferences),
	);
	process.env.NANOCODER_CONFIG_DIR = dir;
}

test.before(() => {
	useConfigDir('no-preference', {});
});

test.after.always(() => {
	rmSync(configRoot, {recursive: true, force: true});
	delete process.env.NANOCODER_CONFIG_DIR;
});

/** Relative luminance per WCAG 2.1. */
function luminance(hex: string): number {
	const raw = hex.replace('#', '');
	const channels = [0, 2, 4].map(i => {
		const c = Number.parseInt(raw.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return (
		0.2126 * (channels[0] ?? 0) +
		0.7152 * (channels[1] ?? 0) +
		0.0722 * (channels[2] ?? 0)
	);
}

function contrastRatio(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const entries = Object.entries(themes);

test('every theme defines a hex primary and base', t => {
	for (const [name, theme] of entries) {
		t.regex(theme.colors.primary, /^#[0-9a-f]{6}$/i, `${name} primary`);
		t.regex(theme.colors.base, /^#[0-9a-f]{6}$/i, `${name} base`);
	}
});

// `primary` is the selection highlight in StyledSelectInput, so a low-contrast
// value makes the highlighted row unreadable — the bug reported in issue #827.
// 3:1 is the WCAG AA floor for large text and UI components.
test('primary contrasts at least 3:1 against base in every theme', t => {
	const failures = entries
		.map(([name, theme]) => ({
			name,
			ratio: contrastRatio(theme.colors.primary, theme.colors.base),
		}))
		.filter(({ratio}) => ratio < 3)
		.map(({name, ratio}) => `${name} (${ratio.toFixed(2)}:1)`);

	t.deepEqual(failures, [], `low-contrast highlight: ${failures.join(', ')}`);
});

test('text contrasts at least 4.5:1 against base in every theme', t => {
	const failures = entries
		.map(([name, theme]) => ({
			name,
			ratio: contrastRatio(theme.colors.text, theme.colors.base),
		}))
		.filter(({ratio}) => ratio < 4.5)
		.map(({name, ratio}) => `${name} (${ratio.toFixed(2)}:1)`);

	t.deepEqual(failures, [], `low-contrast body text: ${failures.join(', ')}`);
});

test('themeType matches whether base is actually light or dark', t => {
	for (const [name, theme] of entries) {
		const isLight = luminance(theme.colors.base) > 0.5;
		t.is(
			theme.themeType,
			isLight ? 'light' : 'dark',
			`${name} base ${theme.colors.base} is mislabelled`,
		);
	}
});

/** The opening escape chalk emits for a hex colour. */
function ansiFor(hex: string): string {
	return chalk.hex(hex)('x').split('x')[0] ?? '';
}

const snippet = `// greet
const greeting = 'hi';
const answer = 42;`;

// Every call site used to pass `theme: 'default'`, a string where cli-highlight
// expects a token -> formatter map, so the option was dropped and code always
// rendered in the library's palette. Any token left unmapped reintroduces that
// clash for the constructs it covers.
test('getSyntaxTheme maps every token cli-highlight styles by default', t => {
	for (const [name, theme] of entries) {
		const syntax = getSyntaxTheme(theme.colors);
		const unmapped = Object.keys(DEFAULT_THEME).filter(
			token => !(token in syntax),
		);
		t.deepEqual(unmapped, [], `${name} leaves tokens on the library default`);
	}
});

test('getSyntaxTheme colours tokens with the palette it was given', t => {
	const colors = themes['tokyo-night'].colors;
	const output = highlight(snippet, {
		language: 'typescript',
		theme: getSyntaxTheme(colors),
	});

	t.true(output.includes(ansiFor(colors.primary)), 'keyword uses primary');
	t.true(output.includes(ansiFor(colors.success)), 'string uses success');
	t.true(output.includes(ansiFor(colors.warning)), 'number uses warning');
	t.true(output.includes(ansiFor(colors.secondary)), 'comment uses secondary');
	t.true(output.includes(ansiFor(colors.text)), 'unmatched code uses text');
});

test('getSyntaxTheme renders the same code differently per theme', t => {
	const rendered = new Set(
		entries.map(([, theme]) =>
			highlight(snippet, {
				language: 'typescript',
				theme: getSyntaxTheme(theme.colors),
			}),
		),
	);

	// The snippet exercises exactly these five roles, so two themes may only
	// share a rendering when they share all five. Collapsing further is what the
	// ignored `theme: 'default'` option did — every theme rendered identically.
	const palettes = new Set(
		entries.map(([, theme]) =>
			[
				theme.colors.primary,
				theme.colors.success,
				theme.colors.warning,
				theme.colors.secondary,
				theme.colors.text,
			].join('/'),
		),
	);

	t.is(rendered.size, palettes.size);
	t.true(palettes.size > 1);
});

test('getSyntaxTheme reuses the theme built for a palette', t => {
	const colors = themes['gruvbox-dark'].colors;
	t.is(getSyntaxTheme(colors), getSyntaxTheme(colors));
	t.not(getSyntaxTheme(colors), getSyntaxTheme(themes['one-light'].colors));
});

// These run last: each repoints NANOCODER_CONFIG_DIR, which is what re-resolves
// the cached `syntaxTheme` lookup.
test('syntaxTheme gives code its own palette without moving the UI theme', t => {
	useConfigDir('dracula-code', {
		selectedTheme: 'tokyo-night',
		syntaxTheme: 'dracula',
	});

	const ui = themes['tokyo-night'].colors;
	const code = themes['dracula'].colors;
	const output = highlight(snippet, {
		language: 'typescript',
		theme: getSyntaxTheme(ui),
	});

	t.true(output.includes(ansiFor(code.primary)), 'keyword uses dracula primary');
	t.true(output.includes(ansiFor(code.warning)), 'number uses dracula warning');
	t.false(
		output.includes(ansiFor(ui.primary)),
		'the UI theme must not colour code once syntaxTheme is set',
	);
});

test('an unknown syntaxTheme falls back to the UI palette', t => {
	useConfigDir('misspelt', {syntaxTheme: 'draclua'});

	const ui = themes['nord-frost'].colors;
	const output = highlight(snippet, {
		language: 'typescript',
		theme: getSyntaxTheme(ui),
	});

	t.true(output.includes(ansiFor(ui.primary)));
});

test('code follows the UI palette when syntaxTheme is unset', t => {
	useConfigDir('ui-only', {selectedTheme: 'gruvbox-light'});

	const ui = themes['gruvbox-light'].colors;
	const output = highlight(snippet, {
		language: 'typescript',
		theme: getSyntaxTheme(ui),
	});

	t.true(output.includes(ansiFor(ui.primary)));
});

// The cache used to key on NANOCODER_CONFIG_DIR alone, which never moves in a
// real session - so syntaxTheme was read once per process and a later write was
// ignored until restart. Keying on the preferences version as well fixes that,
// and this pins it without touching the env var at all.
test('a syntaxTheme written mid-session takes effect without a restart', t => {
	useConfigDir('live-write', {selectedTheme: 'nord-frost'});

	const ui = themes['nord-frost'].colors;
	const before = highlight(snippet, {
		language: 'typescript',
		theme: getSyntaxTheme(ui),
	});
	t.true(before.includes(ansiFor(ui.primary)), 'starts on the UI palette');

	// Same config dir, new preferences: only the version counter moves.
	resetPreferencesCache();
	savePreferences({selectedTheme: 'nord-frost', syntaxTheme: 'dracula'});

	const after = highlight(snippet, {
		language: 'typescript',
		theme: getSyntaxTheme(ui),
	});
	t.true(
		after.includes(ansiFor(themes['dracula'].colors.primary)),
		'the write is picked up on the next highlight',
	);
});

// `themes` comes from JSON.parse, so it carries Object.prototype: a `preset in
// themes` check would accept these and resolve to a non-theme whose `.colors` is
// undefined, leaving the fallback to rescue it by accident.
for (const inherited of ['constructor', 'toString', 'valueOf', '__proto__']) {
	test(`a syntaxTheme of '${inherited}' falls back to the UI palette`, t => {
		useConfigDir(`inherited-${inherited}`, {syntaxTheme: inherited});

		const ui = themes['one-light'].colors;
		const output = highlight(snippet, {
			language: 'typescript',
			theme: getSyntaxTheme(ui),
		});

		t.true(output.includes(ansiFor(ui.primary)));
	});
}
