import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import chalk from 'chalk';
import type {Theme as SyntaxTheme} from 'cli-highlight';
import {loadPreferences} from '@/config/preferences';
// The palette a syntax theme needs is exactly the subset the markdown parser
// already declares, so reuse it rather than declaring a second Pick<Colors>.
import type {Colors as SyntaxPalette} from '@/types/markdown-parser';
import type {Theme, ThemePreset} from '@/types/ui';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load themes from JSON at startup — keeps 50 theme definitions out of source code.
// Path resolves from dist/config/ back to source/config/themes.json (included in package.json files).
const themesPath = join(__dirname, '../../source/config/themes.json');
export const themes: Record<ThemePreset, Theme> = JSON.parse(
	readFileSync(themesPath, 'utf-8'),
);

export function getThemeColors(themePreset: ThemePreset) {
	return themes[themePreset].colors;
}

export const defaultTheme: ThemePreset = 'tokyo-night';

// `syntaxTheme` lets code blocks keep a palette of their own while the rest of
// the UI follows `selectedTheme` — for a terminal already dressed in Dracula or
// Nord, say. Resolved once and re-resolved only when NANOCODER_CONFIG_DIR moves,
// since the diff and file previews highlight line by line and cannot afford a
// preferences read each time. (`@/config/preferences` imports `@/config/index`,
// which imports this module; neither touches the other at module scope, so the
// cycle resolves. Keep it that way.)
let overrideCache: {dir?: string; palette: SyntaxPalette | null} | null = null;

function resolveSyntaxPalette(colors: SyntaxPalette): SyntaxPalette {
	const dir = process.env.NANOCODER_CONFIG_DIR;
	if (!overrideCache || overrideCache.dir !== dir) {
		const preset = loadPreferences().syntaxTheme;
		overrideCache = {
			dir,
			// An unknown or misspelt name falls back to the UI theme rather than
			// throwing the user into an unstyled render.
			palette: preset && preset in themes ? themes[preset].colors : null,
		};
	}
	return overrideCache.palette ?? colors;
}

// cli-highlight's `theme` option takes a map of token -> formatter function, so
// the string 'default' every call site used to pass was silently ignored and code
// always rendered in the library's own palette. Deriving the map from a theme's
// colours keeps syntax highlighting in step with whichever preset is in play.
const syntaxThemes = new WeakMap<SyntaxPalette, SyntaxTheme>();

export function getSyntaxTheme(uiColors: SyntaxPalette): SyntaxTheme {
	const colors = resolveSyntaxPalette(uiColors);
	const cached = syntaxThemes.get(colors);
	if (cached) return cached;

	const keyword = chalk.hex(colors.primary);
	const accent = chalk.hex(colors.tool);
	const quoted = chalk.hex(colors.success);
	const numeric = chalk.hex(colors.warning);
	const muted = chalk.hex(colors.secondary);
	const detail = chalk.hex(colors.info);
	const body = chalk.hex(colors.text);

	const theme: SyntaxTheme = {
		keyword,
		literal: keyword,
		type: keyword,
		tag: keyword,
		'meta-keyword': keyword,
		'template-tag': keyword,
		built_in: accent,
		'builtin-name': accent,
		class: accent,
		function: accent,
		title: accent,
		name: accent,
		section: accent,
		'selector-tag': accent,
		string: quoted,
		regexp: quoted,
		symbol: quoted,
		'meta-string': quoted,
		quote: quoted,
		link: quoted,
		addition: quoted,
		number: numeric,
		bullet: numeric,
		comment: muted,
		doctag: muted,
		meta: muted,
		attr: detail,
		attribute: detail,
		variable: detail,
		'template-variable': detail,
		'selector-attr': detail,
		'selector-class': detail,
		'selector-id': detail,
		'selector-pseudo': detail,
		formula: detail,
		deletion: chalk.hex(colors.error),
		params: body,
		subst: body,
		code: body,
		default: body,
		emphasis: chalk.italic,
		strong: chalk.bold,
	};

	syntaxThemes.set(colors, theme);
	return theme;
}
