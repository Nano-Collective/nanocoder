/**
 * Effective-configuration resolver.
 *
 * Nanocoder reads settings from several places, and when a setting misbehaves
 * the hard question is not "what is the value?" but "which file put it
 * there?". This module answers both: for every known key it reports the value
 * actually in effect plus the layer it came from, and it keeps the values that
 * lower-precedence layers wanted but did not get.
 *
 * Two properties of the real loader are reproduced faithfully here, because
 * both routinely surprise people:
 *
 * 1. **Block-level precedence, not per-key merge.** `loadHierarchicalConfig`
 *    in `config/index.ts` takes the *first* file that contains a block (e.g.
 *    `nanocoder.autoCompact`) and ignores that block in every lower file. A
 *    project file setting one field of a block does not inherit the other
 *    fields from the global file — it inherits them from the built-in
 *    defaults. Entries carry `block` so a formatter can say so.
 * 2. **Preferences use closest-file precedence.** `loadPreferences` reads a
 *    single file chosen by `getClosestConfigFile`, so a project
 *    `nanocoder-preferences.json` shadows the global one wholesale, and
 *    `NANOCODER_CONFIG_DIR` suppresses the project lookup entirely.
 *
 * Effective values are taken from the live loaders (`getAppConfig`,
 * `loadPreferences`, `loadAllMCPConfigs`) rather than recomputed, so clamped
 * and validated values — a `threshold: 200` that becomes `95` — show up as
 * what the app will really use. Origins are computed by scanning the raw
 * files, which is the only way to see what a losing layer asked for.
 */

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
	DEFAULT_AUTO_COMPACT_CONFIG,
	DEFAULT_HEADLESS_CONFIG,
	DEFAULT_RETRY_LIMITS,
	DEFAULT_SESSION_CONFIG,
	getAppConfig,
	getDefaultPasteConfig,
	loadDefaultMode,
} from '@/config/index';
import {loadAllMCPConfigs} from '@/config/mcp-config-loader';
import {getConfigPath} from '@/config/paths';
import {loadPreferences} from '@/config/preferences';

/**
 * Where a value came from, in ascending precedence. `default` is a built-in
 * constant, `global` the user-level config directory, `project` the working
 * directory, `env` a `NANOCODER_*` environment variable.
 */
export type ConfigLayerId = 'default' | 'global' | 'project' | 'env';

/** Ascending precedence. Index into this to compare two layers. */
const LAYER_PRECEDENCE: readonly ConfigLayerId[] = [
	'default',
	'global',
	'project',
	'env',
];

export type ConfigFileName =
	| 'agents.config.json'
	| 'nanocoder-preferences.json';

/** One value found for a key, whether or not it is the one in effect. */
export interface ConfigValueAt {
	layer: ConfigLayerId;
	/** Absolute file path, environment variable name, or `built-in`. */
	origin: string;
	value: unknown;
	/** True when `value` was replaced with a placeholder because it is secret. */
	redacted?: boolean;
}

export interface EffectiveConfigEntry extends ConfigValueAt {
	/** Dotted key, e.g. `nanocoder.autoCompact.threshold`. */
	key: string;
	/** The built-in default, when this key has one. */
	defaultValue?: unknown;
	hasDefault: boolean;
	/**
	 * Values set in a lower-precedence layer that are not in effect, highest
	 * precedence first.
	 */
	shadowed: ConfigValueAt[];
	/**
	 * Dotted path of the block that decided the winning layer, when the key was
	 * resolved by block-level precedence. Present even when the winning layer is
	 * `default`, so a formatter can explain a shadowed sibling.
	 */
	block?: string;
	/**
	 * The file that claimed the block, when one did. Needed because a field the
	 * winning file omits resolves to `default`/`built-in`, which loses track of
	 * *which* file caused the fallback — the one thing the reader needs to know.
	 */
	blockOrigin?: string;
	blockLayer?: ConfigLayerId;
	/** How this key is resolved, for the explanation line in `config show`. */
	rule: 'block' | 'closest-file' | 'merge-by-name' | 'env';
}

/** A file (or the pseudo-file `built-in`) that participates in resolution. */
export interface ConfigLayerInfo {
	layer: ConfigLayerId;
	origin: string;
	exists: boolean;
	/** Set when the file exists but could not be parsed. */
	error?: string;
	/** Set when the file exists but is skipped, with the reason why. */
	skipped?: string;
}

export interface EffectiveConfig {
	cwd: string;
	configDir: string;
	layers: ConfigLayerInfo[];
	entries: EffectiveConfigEntry[];
}

const REDACTED = '<redacted>';

/**
 * Keys whose values are credentials. Matched against the last segment of a
 * dotted key and against object keys nested inside a value.
 */
const SECRET_KEY_PATTERN =
	/(api[-_]?key|access[-_]?token|refresh[-_]?token|\btoken\b|secret|password|passwd|authorization|credential)/i;

/**
 * An `$VAR` / `${VAR}` / `${VAR:-default}` reference is what the user wrote in
 * the file, not the credential itself, so showing it is both safe and the
 * whole point — it tells them which environment variable to check.
 */
function isEnvReference(value: unknown): boolean {
	return typeof value === 'string' && /^\$\{?[A-Za-z_]/.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Replace credential values with a placeholder, recursively. Returns the
 * value unchanged (and `redacted: false`) when nothing was secret.
 */
export function redactValue(
	value: unknown,
	keyHint = '',
): {value: unknown; redacted: boolean} {
	if (SECRET_KEY_PATTERN.test(keyHint) && !isEnvReference(value)) {
		if (value === undefined || value === null || value === '') {
			return {value, redacted: false};
		}
		return {value: REDACTED, redacted: true};
	}

	if (Array.isArray(value)) {
		let redacted = false;
		const mapped = value.map(item => {
			const result = redactValue(item, keyHint);
			redacted ||= result.redacted;
			return result.value;
		});
		return {value: redacted ? mapped : value, redacted};
	}

	if (isPlainObject(value)) {
		let redacted = false;
		const mapped: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			const result = redactValue(item, key);
			redacted ||= result.redacted;
			mapped[key] = result.value;
		}
		return {value: redacted ? mapped : value, redacted};
	}

	return {value, redacted: false};
}

interface RawLayer {
	layer: ConfigLayerId;
	file: ConfigFileName;
	path: string;
	exists: boolean;
	data: Record<string, unknown> | null;
	error?: string;
}

function readRawFile(
	layer: ConfigLayerId,
	file: ConfigFileName,
	path: string,
): RawLayer {
	if (!existsSync(path)) {
		return {layer, file, path, exists: false, data: null};
	}
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
		return {
			layer,
			file,
			path,
			exists: true,
			data: isPlainObject(parsed) ? parsed : null,
			error: isPlainObject(parsed)
				? undefined
				: 'top-level value is not a JSON object',
		};
	} catch (error) {
		return {
			layer,
			file,
			path,
			exists: true,
			data: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * The raw file layers, ascending in precedence (global, then project) for each
 * of the two config files.
 */
function readRawLayers(cwd: string, configDir: string): RawLayer[] {
	const files: ConfigFileName[] = [
		'agents.config.json',
		'nanocoder-preferences.json',
	];
	return files.flatMap(file => [
		readRawFile('global', file, join(configDir, file)),
		readRawFile('project', file, join(cwd, file)),
	]);
}

function getAt(
	data: Record<string, unknown> | null,
	path: readonly string[],
): unknown {
	let current: unknown = data;
	for (const segment of path) {
		if (!isPlainObject(current)) return undefined;
		current = current[segment];
	}
	return current;
}

function hasAt(
	data: Record<string, unknown> | null,
	path: readonly string[],
): boolean {
	if (path.length === 0) return data !== null;
	const parent = getAt(data, path.slice(0, -1));
	const last = path[path.length - 1] as string;
	return isPlainObject(parent) && parent[last] !== undefined;
}

/**
 * Flatten a resolved value into dotted leaves. Arrays and primitives are
 * leaves; plain objects recurse. `maxDepth` stops a pathological nested blob
 * (a `nanocoderTools` config, say) from producing thousands of rows.
 */
function flattenLeaves(
	value: unknown,
	prefix: string[],
	maxDepth: number,
): Array<{path: string[]; value: unknown}> {
	if (
		!isPlainObject(value) ||
		maxDepth <= 0 ||
		Object.keys(value).length === 0
	) {
		return [{path: prefix, value}];
	}
	return Object.entries(value).flatMap(([key, item]) =>
		flattenLeaves(item, [...prefix, key], maxDepth - 1),
	);
}

/**
 * A block is the unit of override in `loadHierarchicalConfig`: the first file
 * that contains `path` wins the whole thing.
 */
interface BlockSpec {
	/** Location of the block inside the raw JSON file. */
	path: string[];
	file: ConfigFileName;
	/** The resolved value, from the live loader. */
	effective: unknown;
	/** Built-in defaults for the leaves inside the block, when it has any. */
	defaults?: Record<string, unknown>;
	/** Treat the block as one value instead of flattening it into leaves. */
	leaf?: boolean;
	/** Environment variable that can override a leaf inside this block. */
	env?: {variable: string; leaf: string};
	/** How deep to flatten. Defaults to 2 (block field, plus one nesting). */
	depth?: number;
}

function blockSpecs(): BlockSpec[] {
	const config = getAppConfig();
	const agents: ConfigFileName = 'agents.config.json';
	const preferences: ConfigFileName = 'nanocoder-preferences.json';

	return [
		{
			path: ['nanocoder', 'autoCompact'],
			file: agents,
			effective: config.autoCompact,
			defaults: DEFAULT_AUTO_COMPACT_CONFIG as unknown as Record<
				string,
				unknown
			>,
		},
		{
			path: ['nanocoder', 'sessions'],
			file: preferences,
			effective: config.sessions,
			defaults: DEFAULT_SESSION_CONFIG as unknown as Record<string, unknown>,
		},
		{
			path: ['nanocoder', 'headless'],
			file: agents,
			effective: config.headless,
			defaults: DEFAULT_HEADLESS_CONFIG as unknown as Record<string, unknown>,
			env: {variable: 'NANOCODER_MAX_TURNS', leaf: 'maxTurns'},
		},
		{
			path: ['nanocoder', 'retries'],
			file: agents,
			effective: config.retries,
			defaults: DEFAULT_RETRY_LIMITS as unknown as Record<string, unknown>,
		},
		{
			path: ['nanocoder', 'paste'],
			file: preferences,
			effective: config.paste,
			defaults: getDefaultPasteConfig() as unknown as Record<string, unknown>,
		},
		{
			path: ['nanocoder', 'defaultMode'],
			file: agents,
			effective: loadDefaultMode(),
			leaf: true,
		},
		{
			path: ['nanocoder', 'alwaysAllow'],
			file: agents,
			effective: config.alwaysAllow,
			leaf: true,
		},
		{
			path: ['nanocoder', 'disabledTools'],
			file: agents,
			effective: config.disabledTools,
			leaf: true,
		},
		{
			path: ['nanocoder', 'systemPrompt'],
			file: agents,
			effective: config.systemPrompt,
		},
		{
			path: ['nanocoder', 'modeProviders'],
			file: agents,
			effective: config.modeProviders,
			depth: 2,
		},
		{
			path: ['nanocoder', 'tune'],
			file: agents,
			effective: config.tune,
		},
		{
			path: ['nanocoder', 'nanocoderTools'],
			file: agents,
			effective: config.nanocoderTools,
			depth: 3,
		},
	];
}

/** Highest-precedence raw layer that contains the block, if any. */
function winningLayer(
	spec: BlockSpec,
	layers: RawLayer[],
): RawLayer | undefined {
	const candidates = layers.filter(l => l.file === spec.file);
	for (let i = candidates.length - 1; i >= 0; i--) {
		const layer = candidates[i] as RawLayer;
		if (hasAt(layer.data, spec.path)) return layer;
	}
	return undefined;
}

function resolveBlockEntries(
	spec: BlockSpec,
	layers: RawLayer[],
): EffectiveConfigEntry[] {
	const blockKey = spec.path.join('.');
	const winner = winningLayer(spec, layers);
	const candidates = layers.filter(l => l.file === spec.file);
	const losers = candidates
		.filter(l => hasAt(l.data, spec.path) && l !== winner)
		.reverse();

	const envRaw = spec.env ? process.env[spec.env.variable] : undefined;
	const envActive =
		spec.env !== undefined && envRaw !== undefined && envRaw.trim() !== '';

	// The leaf set is the union of the resolved value's fields and the fields
	// every raw layer declares. A field that exists *only* in a losing layer
	// still needs a row — it is precisely the value the winning file silently
	// discarded, and reporting it is the point of the command. Building the
	// list from the resolved value alone hid those for blocks with no built-in
	// defaults, where nothing backfills the missing field.
	const leafPaths = new Map<string, string[]>();
	const collect = (value: unknown) => {
		for (const leaf of flattenLeaves(value, [], spec.depth ?? 1)) {
			leafPaths.set(leaf.path.join('\u0000'), leaf.path);
		}
	};
	collect(spec.effective);
	for (const layer of candidates) {
		if (hasAt(layer.data, spec.path)) collect(getAt(layer.data, spec.path));
	}

	const leaves = spec.leaf
		? [{path: [] as string[], value: spec.effective}]
		: [...leafPaths.values()].map(path => ({
				path,
				value: getAt(
					isPlainObject(spec.effective) ? spec.effective : null,
					path,
				),
			}));

	return leaves.map(leaf => {
		const key = [...spec.path, ...leaf.path].join('.');
		const keyHint = leaf.path[leaf.path.length - 1] ?? blockKey;
		const hasDefault =
			spec.defaults !== undefined &&
			leaf.path.length === 1 &&
			leaf.path[0] !== undefined &&
			leaf.path[0] in spec.defaults;
		const defaultValue = hasDefault
			? spec.defaults?.[leaf.path[0] as string]
			: undefined;

		const shadowed: ConfigValueAt[] = [];
		const pushRaw = (layer: RawLayer) => {
			const raw = getAt(layer.data, [...spec.path, ...leaf.path]);
			if (raw === undefined) return;
			const {value, redacted} = redactValue(raw, keyHint);
			shadowed.push({
				layer: layer.layer,
				origin: layer.path,
				value,
				redacted,
			});
		};

		// Env wins outright; the winning file (if any) becomes shadowed too.
		const winnerSuppliesLeaf =
			winner !== undefined &&
			getAt(winner.data, [...spec.path, ...leaf.path]) !== undefined;

		if (envActive && spec.env?.leaf === leaf.path[0]) {
			if (winner) pushRaw(winner);
			for (const loser of losers) pushRaw(loser);
			const {value, redacted} = redactValue(leaf.value, keyHint);
			return {
				key,
				value,
				redacted,
				layer: 'env' as const,
				origin: spec.env.variable,
				hasDefault,
				defaultValue,
				shadowed,
				block: blockKey,
				blockOrigin: winner?.path,
				blockLayer: winner?.layer,
				rule: 'env' as const,
			};
		}

		// When the winner claimed the block but left this field out, the
		// built-in default is what runs, and every losing file's copy of the
		// field is ignored — captured as shadowed either way.
		for (const loser of losers) pushRaw(loser);

		const {value, redacted} = redactValue(leaf.value, keyHint);
		return {
			key,
			value,
			redacted,
			layer: winnerSuppliesLeaf
				? ((winner as RawLayer).layer as ConfigLayerId)
				: ('default' as const),
			origin: winnerSuppliesLeaf ? (winner as RawLayer).path : 'built-in',
			hasDefault,
			defaultValue,
			shadowed,
			block: blockKey,
			blockOrigin: winner?.path,
			blockLayer: winner?.layer,
			rule: 'block' as const,
		};
	});
}

/**
 * Preferences resolution differs from every other block: `loadPreferences`
 * reads exactly one file, picked by `getClosestConfigFile`. So the project
 * file shadows the global one in full, and `NANOCODER_CONFIG_DIR` skips the
 * project lookup altogether.
 */
function resolvePreferencesEntries(layers: RawLayer[]): EffectiveConfigEntry[] {
	const candidates = layers.filter(
		l => l.file === 'nanocoder-preferences.json',
	);
	const project = candidates.find(l => l.layer === 'project');
	const global = candidates.find(l => l.layer === 'global');
	const explicitConfigDir = Boolean(process.env.NANOCODER_CONFIG_DIR);

	const winner =
		!explicitConfigDir && project?.exists ? project : (global ?? null);
	const loser = winner === project ? global : project;

	const effective = loadPreferences();
	const keys = Object.keys(effective).filter(key => key !== 'nanocoder');

	return keys.sort().map(key => {
		const {value, redacted} = redactValue(
			(effective as Record<string, unknown>)[key],
			key,
		);
		const shadowed: ConfigValueAt[] = [];
		const loserRaw = loser?.exists ? getAt(loser.data, [key]) : undefined;
		if (loser && loserRaw !== undefined) {
			const redactedLoser = redactValue(loserRaw, key);
			shadowed.push({
				layer: loser.layer,
				origin: loser.path,
				value: redactedLoser.value,
				redacted: redactedLoser.redacted,
			});
		}
		return {
			key: `preferences.${key}`,
			value,
			redacted,
			layer: (winner?.layer ?? 'default') as ConfigLayerId,
			origin: winner?.path ?? 'built-in',
			hasDefault: false,
			shadowed,
			rule: 'closest-file' as const,
		};
	});
}

/**
 * Providers and MCP servers merge by name across layers rather than replacing
 * one another, so each named entry gets its own row and its own winner.
 */
function resolveProviderEntries(layers: RawLayer[]): EffectiveConfigEntry[] {
	const rawProviders = (layer: RawLayer): Record<string, unknown> => {
		const nested = getAt(layer.data, ['nanocoder', 'providers']);
		const top = getAt(layer.data, ['providers']);
		const list = Array.isArray(nested) ? nested : Array.isArray(top) ? top : [];
		const byName: Record<string, unknown> = {};
		for (const provider of list) {
			if (isPlainObject(provider) && typeof provider.name === 'string') {
				byName[provider.name] = provider;
			}
		}
		return byName;
	};

	const fileLayers = layers.filter(l => l.file === 'agents.config.json');
	const envNames = readEnvProviderNames();

	return (getAppConfig().providers ?? []).map(provider => {
		const name = provider.name;
		const found = fileLayers
			.filter(layer => rawProviders(layer)[name] !== undefined)
			.reverse();
		const {value, redacted} = redactValue(provider, name);

		// An env-provided provider outranks every file, so a same-named file
		// entry is shadowed rather than winning.
		const fromEnv = envNames.has(name);
		const winner = fromEnv ? undefined : found[0];
		const shadowedLayers = fromEnv ? found : found.slice(1);

		const shadowed: ConfigValueAt[] = shadowedLayers.map(layer => {
			const raw = redactValue(rawProviders(layer)[name], name);
			return {
				layer: layer.layer,
				origin: layer.path,
				value: raw.value,
				redacted: raw.redacted,
			};
		});

		return {
			key: `nanocoder.providers.${name}`,
			value,
			redacted,
			layer: (fromEnv ? 'env' : (winner?.layer ?? 'default')) as ConfigLayerId,
			origin: fromEnv
				? process.env.NANOCODER_PROVIDERS
					? 'NANOCODER_PROVIDERS'
					: 'NANOCODER_PROVIDERS_FILE'
				: (winner?.path ?? 'built-in'),
			hasDefault: false,
			shadowed,
			rule: 'merge-by-name' as const,
		};
	});
}

/**
 * Names of providers supplied through `NANOCODER_PROVIDERS` /
 * `NANOCODER_PROVIDERS_FILE`. Mirrors the shapes `loadEnvProviderConfigs`
 * accepts; a value that fails to parse simply contributes no names, matching
 * the loader's own behaviour of falling back to the files.
 */
function readEnvProviderNames(): Set<string> {
	const names = new Set<string>();
	let rawData = process.env.NANOCODER_PROVIDERS;
	const file = process.env.NANOCODER_PROVIDERS_FILE;
	if (!rawData && file && existsSync(file)) {
		try {
			rawData = readFileSync(file, 'utf-8');
		} catch {
			return names;
		}
	}
	if (!rawData) return names;

	try {
		const parsed: unknown = JSON.parse(rawData);
		const list = Array.isArray(parsed)
			? parsed
			: (getAt(isPlainObject(parsed) ? parsed : null, [
					'nanocoder',
					'providers',
				]) ?? getAt(isPlainObject(parsed) ? parsed : null, ['providers']));
		if (!Array.isArray(list)) return names;
		for (const provider of list) {
			if (isPlainObject(provider) && typeof provider.name === 'string') {
				names.add(provider.name);
			}
		}
	} catch {
		// Unparseable env config: the loader ignores it too.
	}
	return names;
}

function resolveMcpEntries(
	cwd: string,
	configDir: string,
): EffectiveConfigEntry[] {
	const originFor = (source: string): string => {
		if (source === 'project') return join(cwd, '.mcp.json');
		if (source === 'global') return join(configDir, '.mcp.json');
		return 'NANOCODER_MCPSERVERS';
	};

	return loadAllMCPConfigs().map(({server, source}) => {
		const {value, redacted} = redactValue(server, server.name);
		return {
			key: `mcpServers.${server.name}`,
			value,
			redacted,
			layer: (source === 'env' ? 'env' : source) as ConfigLayerId,
			origin: originFor(source),
			hasDefault: false,
			shadowed: [],
			rule: 'merge-by-name' as const,
		};
	});
}

/**
 * Resolve every known config key to its effective value plus provenance.
 *
 * `cwd` and `configDir` default to the live process values; tests pass them
 * explicitly.
 */
export function resolveEffectiveConfig(options?: {
	cwd?: string;
	configDir?: string;
}): EffectiveConfig {
	const cwd = options?.cwd ?? process.cwd();
	const configDir = options?.configDir ?? getConfigPath();
	const rawLayers = readRawLayers(cwd, configDir);

	const entries: EffectiveConfigEntry[] = [
		...blockSpecs().flatMap(spec => resolveBlockEntries(spec, rawLayers)),
		...resolvePreferencesEntries(rawLayers),
		...resolveProviderEntries(rawLayers),
		...resolveMcpEntries(cwd, configDir),
	].filter(entry => entry.value !== undefined || entry.shadowed.length > 0);

	const explicitConfigDir = Boolean(process.env.NANOCODER_CONFIG_DIR);
	const layers: ConfigLayerInfo[] = [
		{layer: 'default', origin: 'built-in', exists: true},
		...rawLayers
			.slice()
			.sort(
				(a, b) =>
					LAYER_PRECEDENCE.indexOf(a.layer) - LAYER_PRECEDENCE.indexOf(b.layer),
			)
			.map(layer => ({
				layer: layer.layer,
				origin: layer.path,
				exists: layer.exists,
				error: layer.error,
				skipped:
					explicitConfigDir &&
					layer.layer === 'project' &&
					layer.file === 'nanocoder-preferences.json' &&
					layer.exists
						? 'NANOCODER_CONFIG_DIR is set, so preferences are read from the config directory only'
						: undefined,
			})),
	];

	return {cwd, configDir, layers, entries};
}

/**
 * Entries whose effective value is not the built-in default, plus every entry
 * that is shadowing a value set in a lower layer. This is what `config diff`
 * renders: the complete set of places a config file is changing behaviour.
 */
export function selectOverrides(
	config: EffectiveConfig,
): EffectiveConfigEntry[] {
	return config.entries.filter(
		entry => entry.layer !== 'default' || entry.shadowed.length > 0,
	);
}

/**
 * Find entries matching a user-supplied key. Matches an exact dotted key
 * first, then a dotted prefix (so `nanocoder.autoCompact` returns the whole
 * block), then the same two with a `nanocoder.` prefix added, then
 * case-insensitively, and finally as a substring so a bare `threshold` still
 * finds something.
 */
export function findEntries(
	config: EffectiveConfig,
	key: string,
): EffectiveConfigEntry[] {
	const query = key.trim();
	if (query === '') return [];

	const candidates = [query, `nanocoder.${query}`, `preferences.${query}`];

	for (const candidate of candidates) {
		const exact = config.entries.filter(entry => entry.key === candidate);
		if (exact.length > 0) return exact;
	}
	for (const candidate of candidates) {
		const prefixed = config.entries.filter(entry =>
			entry.key.startsWith(`${candidate}.`),
		);
		if (prefixed.length > 0) return prefixed;
	}

	const lower = query.toLowerCase();
	const insensitive = config.entries.filter(
		entry =>
			entry.key.toLowerCase() === lower ||
			entry.key.toLowerCase().startsWith(`${lower}.`),
	);
	if (insensitive.length > 0) return insensitive;

	return config.entries.filter(entry =>
		entry.key.toLowerCase().includes(lower),
	);
}
