import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import chalk from 'chalk';
import type {Theme as SyntaxTheme} from 'cli-highlight';
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

// cli-highlight's `theme` option takes a map of token -> formatter function, so
// the string 'default' every call site used to pass was silently ignored and code
// always rendered in the library's own palette. Deriving the map from the active
// theme keeps syntax highlighting in step with whichever preset the user picked.
const syntaxThemes = new WeakMap<SyntaxPalette, SyntaxTheme>();

export function getSyntaxTheme(colors: SyntaxPalette): SyntaxTheme {
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
