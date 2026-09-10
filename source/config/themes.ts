import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import chalk from 'chalk';
import type {Theme as SyntaxTheme} from 'cli-highlight';
import {getPreferencesVersion, loadPreferences} from '@/config/preferences';
// The palette a syntax theme needs is exactly the subset the markdown parser
// already declares, so reuse it rather than declaring a second Pick<Colors>.
import type {RenderPalette as SyntaxPalette} from '@/types/markdown-parser';
import type {Theme, ThemePreset} from '@/types/ui';
import {getLogger} from '@/utils/logging';

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
// Nord, say. The diff and file previews highlight line by line, so this cannot
// read preferences off disk each time. (`@/config/preferences` imports
// `@/config/index`, which imports this module; neither touches the other at
// module scope, so the cycle resolves. Keep it that way.)
//
// Keyed on the preferences version as well as the config dir: the version is a
// monotonic counter bumped on every write and free to read, so a `/settings`
// change lands on the next highlight instead of waiting for a restart. The dir
// is what moves under tests, which point NANOCODER_CONFIG_DIR at a fixture.
let overrideCache: {
	dir?: string;
	version: number;
	palette: SyntaxPalette | null;
} | null = null;

// Naming an unknown theme is silent otherwise: the render simply looks like it
// did before the preference was set, with nothing to say why.
//
// Structured logging rather than `logWarning`, on two counts. `@/utils/message-
// queue` reaches `@/components/message-box` -> `useTheme` -> back here, which is
// a cycle this module is deliberately kept out of; and getSyntaxTheme is called
// from render (the diff, write_file and file-explorer previews), where pushing
// onto the chat queue is a state update during another component's render.
let warnedSyntaxTheme: string | null = null;

function resolveSyntaxPalette(colors: SyntaxPalette): SyntaxPalette {
	const dir = process.env.NANOCODER_CONFIG_DIR;
	const version = getPreferencesVersion();
	if (
		!overrideCache ||
		overrideCache.dir !== dir ||
		overrideCache.version !== version
	) {
		const preset = loadPreferences().syntaxTheme;
		// Own properties only: `themes` comes from JSON.parse, so it carries
		// Object.prototype and a `syntaxTheme` of "constructor" or "toString"
		// would otherwise pass an `in` check and resolve to a non-theme.
		const known = Boolean(preset) && Object.hasOwn(themes, preset as string);

		if (preset && !known && warnedSyntaxTheme !== preset) {
			warnedSyntaxTheme = preset;
			getLogger().warn(
				`Unknown syntaxTheme '${preset}', falling back to the selected theme`,
				{syntaxTheme: preset, source: 'syntax-theme'},
			);
		}

		overrideCache = {
			dir,
			version,
			// An unknown or misspelt name falls back to the UI theme rather than
			// throwing the user into an unstyled render.
			palette: known ? themes[preset as ThemePreset].colors : null,
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
