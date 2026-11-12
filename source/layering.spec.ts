import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, join, normalize, relative} from 'node:path';
import test from 'ava';

/*
 * Layering rule: `utils/`, `types/` and `config/` sit at the bottom of the
 * tree. Everything else imports them, so they must not import back up into
 * the UI or the runtime layers. A single value import of a component from
 * here pulls Ink into the CLI fast paths, and an import of tools/ or mcp/
 * builds a cycle through the most-imported modules in the codebase.
 *
 * Biome's `noRestrictedImports` cannot express this rule: it matches import
 * specifiers as strings, so it misses relative imports (`../components/x`),
 * and it cannot tell `import type` from a value import. This spec resolves
 * every specifier (the `@/` alias and relative paths) to a file instead.
 */

const LOW_LAYERS = ['source/utils', 'source/types', 'source/config'];

// No value import from a low layer may resolve into these directories. A
// type-only import (erased at compile time) needs a TYPE_ONLY_ALLOWLIST
// entry.
const BANNED = [
	'source/components/',
	'source/hooks/',
	'source/tools/',
	'source/mcp/',
	'source/session/',
	'source/app/components/',
];

// Higher layers that a low layer may value-import only through a documented
// exception below, so that each upward edge is visible and reviewed.
// Type-only imports of these are fine.
const RESTRICTED = ['source/app/', 'source/ai-sdk-client/', 'source/services/'];

type Edge = {from: string; to: string; reason: string};

// Type-only imports into BANNED directories. Each entry needs a reason.
const TYPE_ONLY_ALLOWLIST: Edge[] = [
	{
		from: 'source/types/core.ts',
		to: 'source/tools/tool-manager.ts',
		reason:
			'ToolExecutionContext.toolManager is typed as the ToolManager class. Moving it out would mean extracting an interface for the whole class.',
	},
	{
		from: 'source/types/app.ts',
		to: 'source/session/session-manager.ts',
		reason:
			'The persisted Session shape is defined next to its manager.',
	},
	{
		from: 'source/types/commands.ts',
		to: 'source/session/session-manager.ts',
		reason: 'CommandContext resumes a Session, typed by its manager.',
	},
	{
		from: 'source/types/app.ts',
		to: 'source/app/components/settings-constants.ts',
		reason:
			'SettingsTabId is declared next to SETTINGS_TAB_IDS, the tab list the settings panel renders.',
	},
	{
		from: 'source/types/commands.ts',
		to: 'source/app/components/settings-constants.ts',
		reason: 'CommandContext opens the settings panel on a SettingsTabId.',
	},
];

// Value imports into RESTRICTED directories that are known and accepted.
const DOCUMENTED_EXCEPTIONS: Edge[] = [
	{
		from: 'source/config/index.ts',
		to: 'source/app/types.ts',
		reason: 'Validates the configured default mode against VALID_MODES / CliMode, which app/types.ts owns.',
	},
	{
		from: 'source/config/lint.ts',
		to: 'source/ai-sdk-client/providers/openrouter.ts',
		reason: 'isOpenRouterProvider decides whether a provider\'s `openrouter` block applies; the linter must agree with the client.',
	},
	{
		from: 'source/config/index.ts',
		to: 'source/services/session-context.ts',
		reason:
			'getConfigRoot / getActiveSessionContext: config resolves against the current session\'s project root (each ACP session has its own).',
	},
	{
		from: 'source/config/paths.ts',
		to: 'source/services/session-context.ts',
		reason:
			'getConfigRoot: project-level config paths resolve against the current session\'s project root.',
	},
	{
		from: 'source/config/mcp-config-loader.ts',
		to: 'source/services/session-context.ts',
		reason: 'getConfigRoot: project .mcp.json is read from the current session\'s project root.',
	},
];

const MOVE_HINT =
	'Fix: move the shared code down into utils/ or types/, or invert the dependency (have the caller pass it in).';
const BANNED_HINT = `${MOVE_HINT} If only a type is needed, use \`import type\` and add a TYPE_ONLY_ALLOWLIST entry with the reason in source/layering.spec.ts.`;
const RESTRICTED_HINT = `${MOVE_HINT} A type-only import is fine here. If the value import is genuinely needed, add a DOCUMENTED_EXCEPTIONS entry with the reason in source/layering.spec.ts.`;

interface ImportRef {
	specifier: string;
	typeOnly: boolean;
	line: number;
}

function stripComments(code: string): string {
	// Keep newlines so line numbers survive.
	return code
		.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
		.replace(/^\s*\/\/.*$/gm, '');
}

function lineOf(code: string, index: number): number {
	return code.slice(0, index).split('\n').length;
}

/** Every module specifier in `code`, with whether the import is erased. */
function findImports(code: string): ImportRef[] {
	const text = stripComments(code);
	const refs: ImportRef[] = [];

	const staticRe =
		/^[ \t]*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/gm;
	for (const match of text.matchAll(staticRe)) {
		const clause = match[3].trim();
		const members = clause.match(/^\{([\s\S]*)\}$/);
		const allTypeMembers =
			members !== null &&
			members[1].trim() !== '' &&
			members[1]
				.split(',')
				.map(member => member.trim())
				.filter(Boolean)
				.every(member => member.startsWith('type '));
		refs.push({
			specifier: match[4],
			typeOnly: Boolean(match[2]) || allTypeMembers,
			line: lineOf(text, match.index),
		});
	}

	for (const match of text.matchAll(/^[ \t]*import\s*['"]([^'"]+)['"]/gm)) {
		refs.push({
			specifier: match[1],
			typeOnly: false,
			line: lineOf(text, match.index),
		});
	}

	for (const match of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
		const after = text.slice(match.index + match[0].length);
		const before = text.slice(0, match.index);
		// `import('x').Foo` and `typeof import('x')` only appear in type
		// positions; `import('x').then(...)` is a runtime load.
		const typeOnly =
			/^\s*\.(?!\s*then\b)/.test(after) || /\btypeof\s*$/.test(before);
		refs.push({
			specifier: match[1],
			typeOnly,
			line: lineOf(text, match.index),
		});
	}

	return refs;
}

const EXTENSIONS = ['.ts', '.tsx', '.js', '.json'];

/** Resolve a specifier from `importer` to a repo-relative file path. */
function resolveImport(
	specifier: string,
	importer: string,
): string | null {
	let base: string;
	if (specifier.startsWith('@/')) {
		base = join('source', specifier.slice(2));
	} else if (specifier.startsWith('.')) {
		base = join(dirname(importer), specifier);
	} else {
		return null;
	}
	base = normalize(base);
	const stem = base.replace(/\.jsx?$/, '');
	const candidates = [
		base,
		...EXTENSIONS.map(ext => stem + ext),
		join(stem, 'index.ts'),
		join(stem, 'index.tsx'),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate) && statSync(candidate).isFile()) {
			return candidate.split('\\').join('/');
		}
	}
	return null;
}

function listModules(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, {withFileTypes: true})) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...listModules(path));
		else if (
			/\.tsx?$/.test(entry.name) &&
			!/\.spec\.tsx?$/.test(entry.name)
		) {
			files.push(path.split('\\').join('/'));
		}
	}
	return files;
}

type Found = {from: string; to: string; specifier: string; line: number; typeOnly: boolean};

function scanLowLayers(): Found[] {
	const found: Found[] = [];
	for (const layer of LOW_LAYERS) {
		for (const file of listModules(layer)) {
			for (const ref of findImports(readFileSync(file, 'utf8'))) {
				const to = resolveImport(ref.specifier, file);
				if (to) found.push({from: file, to, ...ref});
			}
		}
	}
	return found;
}

const isUnder = (path: string, dirs: string[]) =>
	dirs.some(dir => path.startsWith(dir));
const sameEdge = (edge: Edge, found: Found) =>
	edge.from === found.from && edge.to === found.to;

function describe(found: Found, problem: string): string {
	return `${found.from}:${found.line} imports '${found.specifier}' (${relative('.', found.to)}): ${problem}`;
}

const edges = scanLowLayers();

test('the import scanner sees the low layers', t => {
	// Guard against the scan silently matching nothing.
	t.true(edges.length > 50);
	t.true(edges.some(edge => edge.to === 'source/utils/logging/index.ts'));
});

test('utils/, types/ and config/ make no value imports of UI or runtime layers', t => {
	const violations = edges
		.filter(edge => !edge.typeOnly && isUnder(edge.to, BANNED))
		.map(edge =>
			describe(
				edge,
				`a value import of ${BANNED.find(dir => edge.to.startsWith(dir))} from a low layer. ${BANNED_HINT}`,
			),
		);
	t.deepEqual(violations, [], violations.join('\n'));
});

test('type-only imports of UI or runtime layers are allowlisted', t => {
	const violations = edges
		.filter(
			edge =>
				edge.typeOnly &&
				isUnder(edge.to, BANNED) &&
				!TYPE_ONLY_ALLOWLIST.some(entry => sameEdge(entry, edge)),
		)
		.map(edge =>
			describe(
				edge,
				`a type-only import that is not in TYPE_ONLY_ALLOWLIST. Move the type into types/, or add an allowlist entry saying why it cannot move.`,
			),
		);
	t.deepEqual(violations, [], violations.join('\n'));
});

test('imports of app/, ai-sdk-client/ and services/ are documented exceptions', t => {
	const violations = edges
		.filter(
			edge =>
				!edge.typeOnly &&
				isUnder(edge.to, RESTRICTED) &&
				!isUnder(edge.to, BANNED) &&
				!DOCUMENTED_EXCEPTIONS.some(entry => sameEdge(entry, edge)),
		)
		.map(edge =>
			describe(
				edge,
				`an upward import that is not in DOCUMENTED_EXCEPTIONS. ${RESTRICTED_HINT}`,
			),
		);
	t.deepEqual(violations, [], violations.join('\n'));
});

test('every allowlist and exception entry still matches an import', t => {
	const stale = [
		...TYPE_ONLY_ALLOWLIST.filter(
			entry => !edges.some(edge => edge.typeOnly && sameEdge(entry, edge)),
		),
		...DOCUMENTED_EXCEPTIONS.filter(
			entry => !edges.some(edge => !edge.typeOnly && sameEdge(entry, edge)),
		),
	].map(
		entry =>
			`${entry.from} -> ${entry.to} no longer exists (or changed kind); remove the entry from source/layering.spec.ts`,
	);
	t.deepEqual(stale, [], stale.join('\n'));
});

test('findImports tells type-only imports from value imports', t => {
	const refs = findImports(
		[
			"import {a} from '@/components/a';",
			"import type {B} from '../hooks/b';",
			"import {type C, type D} from '@/tools/c';",
			"import {type E, f} from '@/mcp/e';",
			"export * from './g';",
			"import './side-effect';",
			"type H = import('@/session/h').H;",
			"const i = await import('@/session/i');",
			"import('@/session/j').then(load);",
			"type K = typeof import('@/session/k');",
			"// import {l} from '@/components/l';",
		].join('\n'),
	);
	t.deepEqual(
		refs.map(ref => [ref.specifier, ref.typeOnly]),
		[
			['@/components/a', false],
			['../hooks/b', true],
			['@/tools/c', true],
			['@/mcp/e', false],
			['./g', false],
			['./side-effect', false],
			['@/session/h', true],
			['@/session/i', false],
			['@/session/j', false],
			['@/session/k', true],
		],
	);
});

test('resolveImport follows relative paths into banned directories', t => {
	t.is(
		resolveImport('../components/message-box', 'source/utils/example.ts'),
		'source/components/message-box.tsx',
	);
	t.is(
		resolveImport('@/utils/logging', 'source/config/example.ts'),
		'source/utils/logging/index.ts',
	);
	t.is(resolveImport('ink', 'source/utils/example.ts'), null);
});
