import {statSync} from 'node:fs';
import path from 'node:path';
import {existsSync, mkdirSync, readFileSync} from 'fs';
import type {TitleShape} from '@/components/ui/styled-title';
import {getClosestConfigFile, getConfigPath} from '@/config/paths';
import {
	DEFAULT_MEMORY_LIMIT,
	DEFAULT_TOKEN_BUDGET,
	MAX_MEMORY_LIMIT,
	MAX_TOKEN_BUDGET,
	MIN_MEMORY_LIMIT,
	MIN_TOKEN_BUDGET,
	type ProjectContextOptions,
} from '@/memory/project-context';
import type {
	CiWatchConfig,
	NotificationsConfig,
	TuneConfig,
} from '@/types/config';
import type {UserPreferences} from '@/types/index';
import type {NanocoderShape, ThemePreset} from '@/types/ui';
import {atomicWriteFileSync} from '@/utils/fs/atomic-write';
import {getLogger} from '@/utils/logging';

let PREFERENCES_PATH: string | null = null;
let CACHED_CONFIG_DIR: string | undefined = undefined;
let cachedVoicePreference: import('@/types/config').VoiceConfig | undefined;
const PREFERENCES_STAT_INTERVAL_MS = 1000;

type PreferencesCache = {
	path: string;
	version: number;
	mtimeMs: number | null;
	globalMtimeMs: number | null;
	lastCheckedAt: number;
	data: UserPreferences;
};

let preferencesCache: PreferencesCache | null = null;

function getFileMtime(filePath: string): number | null {
	try {
		return statSync(filePath).mtimeMs;
	} catch {
		return null;
	}
}
function getPreferencesPath(): string {
	// Re-compute path if NANOCODER_CONFIG_DIR has changed (important for tests)
	const currentConfigDir = process.env.NANOCODER_CONFIG_DIR;
	if (!PREFERENCES_PATH || CACHED_CONFIG_DIR !== currentConfigDir) {
		PREFERENCES_PATH = getClosestConfigFile('nanocoder-preferences.json');
		CACHED_CONFIG_DIR = currentConfigDir;
	}
	return PREFERENCES_PATH;
}

// Test hook: drops the resolved path cache only. `cachedPreference` values
// survive, since they key on NANOCODER_CONFIG_DIR + the write counter.
export function resetPreferencesCache(): void {
	PREFERENCES_PATH = null;
	CACHED_CONFIG_DIR = undefined;
	cachedVoicePreference = undefined;
	preferencesCache = null;
}

// Trust is only ever read from, and written to, the global preferences file.
// A project-level nanocoder-preferences.json ships with the repo, so honouring
// `trustedDirectories` from it would let a cloned repo trust itself and skip
// the disclaimer that gates its MCP servers and hooks.
function getGlobalPreferencesPath(): string {
	return path.join(getConfigPath(), 'nanocoder-preferences.json');
}

function isProjectPreferencesPath(preferencesPath: string): boolean {
	return (
		path.resolve(preferencesPath) !== path.resolve(getGlobalPreferencesPath())
	);
}

// Keys that are personal, security-sensitive decisions. They live only in the
// global file: a committed project file must not be able to pre-confirm the
// `--trust full-commit` warning or switch on background CI polling.
const GLOBAL_ONLY_KEYS = [
	'trustedDirectories',
	'fullCommitConfirmedProjects',
	'ciWatch',
] as const satisfies ReadonlyArray<keyof UserPreferences>;

function readGlobalOnlyPreferences(): Partial<UserPreferences> | undefined {
	const globalPath = getGlobalPreferencesPath();
	if (!existsSync(globalPath)) return undefined;
	try {
		return JSON.parse(readFileSync(globalPath, 'utf-8')) as UserPreferences;
	} catch (error) {
		getLogger().error(`Failed to load global preferences: ${String(error)}`);
		return undefined;
	}
}

function writeGlobalOnlyPreferences(values: Partial<UserPreferences>): void {
	const globalPath = getGlobalPreferencesPath();
	let data: Record<string, unknown> = {};
	if (existsSync(globalPath)) {
		data = JSON.parse(readFileSync(globalPath, 'utf-8')) as Record<
			string,
			unknown
		>;
	}
	mkdirSync(path.dirname(globalPath), {recursive: true});
	atomicWriteFileSync(
		globalPath,
		JSON.stringify({...data, ...values}, null, 2),
	);
}

/**
 * The preferences kept only in the global file, read without opening a project
 * preferences file in the current folder. For a caller that must not depend on
 * what the folder contains, such as `nanocoder trust`: a project file that is
 * unreadable or malformed cannot hide the trust list.
 */
export function loadGlobalOnlyPreferences(): UserPreferences {
	const globalPrefs = readGlobalOnlyPreferences();
	const values: Record<string, unknown> = {};
	for (const key of GLOBAL_ONLY_KEYS) {
		if (globalPrefs?.[key] !== undefined) values[key] = globalPrefs[key];
	}
	return values as UserPreferences;
}

/**
 * Writes global-only keys to the global file and nothing else: a project
 * preferences file in the current folder is neither read nor rewritten, so
 * saving does not depend on the folder being writable. Returns `false` when
 * the write failed.
 */
export function saveGlobalOnlyPreferences(
	values: Partial<Pick<UserPreferences, (typeof GLOBAL_ONLY_KEYS)[number]>>,
): boolean {
	try {
		writeGlobalOnlyPreferences(values);
	} catch (error) {
		getLogger().error(`Failed to save global preferences: ${String(error)}`);
		return false;
	}

	notifyPreferencesChanged();
	return true;
}

export function loadPreferences(): UserPreferences {
	try {
		const preferencesPath = getPreferencesPath();
		const version = getPreferencesVersion();
		const now = Date.now();
		const cache = preferencesCache;

		// Internal writes invalidate immediately. Unchanged preferences
		// avoid filesystem I/O until the next scheduled metadata check.
		if (
			cache &&
			cache.path === preferencesPath &&
			cache.version === version &&
			now - cache.lastCheckedAt >= 0 &&
			now - cache.lastCheckedAt < PREFERENCES_STAT_INTERVAL_MS
		) {
			return structuredClone(cache.data);
		}

		const mtimeMs = getFileMtime(preferencesPath);
		const isProject = isProjectPreferencesPath(preferencesPath);
		const globalMtimeMs = isProject
			? getFileMtime(getGlobalPreferencesPath())
			: null;

		if (
			cache &&
			cache.path === preferencesPath &&
			cache.version === version &&
			mtimeMs !== null &&
			cache.mtimeMs === mtimeMs &&
			cache.globalMtimeMs === globalMtimeMs
		) {
			cache.lastCheckedAt = now;
			return structuredClone(cache.data);
		}

		const data = JSON.parse(
			readFileSync(preferencesPath, 'utf-8'),
		) as UserPreferences;

		if (isProject) {
			const globalPrefs = readGlobalOnlyPreferences();
			const mutable = data as Record<string, unknown>;

			for (const key of GLOBAL_ONLY_KEYS) {
				const value = globalPrefs?.[key];

				if (value === undefined) delete mutable[key];
				else mutable[key] = value;
			}
		}

		preferencesCache = {
			path: preferencesPath,
			version,
			mtimeMs,
			globalMtimeMs,
			lastCheckedAt: now,
			data: structuredClone(data),
		};

		return data;
	} catch (error) {
		getLogger().error(`Failed to load preferences: ${String(error)}`);
	}

	return {};
}

// Preferences are written straight to disk, so React has no natural signal that
// a setting flipped. Consumers holding derived state (e.g. the memoized system
// prompt in useChatHandler) subscribe here and re-read on the next render.
let preferencesVersion = 0;
const preferencesListeners = new Set<() => void>();

/**
 * Subscribe to preference writes. Returns an unsubscribe function, matching the
 * shape React's useSyncExternalStore expects.
 */
export function subscribeToPreferences(listener: () => void): () => void {
	preferencesListeners.add(listener);
	return () => {
		preferencesListeners.delete(listener);
	};
}

/**
 * Monotonic counter bumped on every successful preferences write. Reading it is
 * free (no file I/O), which is what makes it safe as a snapshot for
 * useSyncExternalStore - unlike the getters below, which hit the disk.
 */
export function getPreferencesVersion(): number {
	return preferencesVersion;
}

/**
 * Invalidate cached preference data after a successful write and notify
 * subscribers that the preference snapshot changed.
 */
export function notifyPreferencesChanged(): void {
	preferencesCache = null;
	preferencesVersion++;
	for (const listener of preferencesListeners) {
		listener();
	}
}

// Caches a derived preference, keyed on NANOCODER_CONFIG_DIR and getPreferencesVersion()
// (bumped on every write), so the value never goes stale after a settings change.
function cachedPreference<T>(read: (prefs: UserPreferences) => T): () => T {
	let cache: {dir?: string; version: number; value: T} | null = null;
	return () => {
		const dir = process.env.NANOCODER_CONFIG_DIR;
		const version = getPreferencesVersion();
		if (!cache || cache.dir !== dir || cache.version !== version) {
			cache = {dir, version, value: read(loadPreferences())};
		}
		return cache.value;
	};
}

/**
 * Writes the preferences file. Returns `false` when the write failed — the
 * error is logged here rather than thrown, so callers that must know whether
 * the value actually reached disk (the trust gate, whose message claims a
 * persisted entry) have a signal to branch on.
 */
export function savePreferences(preferences: UserPreferences): boolean {
	try {
		const preferencesPath = getPreferencesPath();
		if (isProjectPreferencesPath(preferencesPath)) {
			const rest: Record<string, unknown> = {...preferences};
			const globalValues: Record<string, unknown> = {};
			for (const key of GLOBAL_ONLY_KEYS) {
				delete rest[key];
				if (preferences[key] !== undefined)
					globalValues[key] = preferences[key];
			}
			atomicWriteFileSync(preferencesPath, JSON.stringify(rest, null, 2));
			if (Object.keys(globalValues).length > 0) {
				writeGlobalOnlyPreferences(globalValues as Partial<UserPreferences>);
			}
		} else {
			atomicWriteFileSync(
				preferencesPath,
				JSON.stringify(preferences, null, 2),
			);
		}
	} catch (error) {
		getLogger().error(`Failed to save preferences: ${String(error)}`);
		return false;
	}

	cachedVoicePreference = preferences.voice;
	notifyPreferencesChanged();
	return true;
}

// ============================================================================
// Preference accessors
// ----------------------------------------------------------------------------
// Most preferences are a single top-level key: read it (falling back to a
// default when unset), or write it and save. `getPreference` and
// `setPreference` do that for any key, typed by UserPreferences; boolean
// defaults live in one table instead of being repeated in each getter.
// Accessors with their own logic (clamping, nesting, caching) follow below.
// ============================================================================

function getPreference<K extends keyof UserPreferences>(
	key: K,
): UserPreferences[K] {
	return loadPreferences()[key];
}

function setPreference<K extends keyof UserPreferences>(
	key: K,
	value: UserPreferences[K],
): void {
	const preferences = loadPreferences();
	preferences[key] = value;
	savePreferences(preferences);
}

/** Boolean preferences and the value each takes when unset. */
const BOOLEAN_PREFERENCE_DEFAULTS = {
	reasoningExpanded: false,
	compactToolDisplay: true,
	showUsageFooter: true,
	enablePromptScrubbing: false,
	alternateScreen: true,
	mouseReporting: true,
	professionalTone: false,
} as const satisfies Partial<Record<keyof UserPreferences, boolean>>;

type BooleanPreference = keyof typeof BOOLEAN_PREFERENCE_DEFAULTS;

function getBooleanPreference(key: BooleanPreference): boolean {
	return getPreference(key) ?? BOOLEAN_PREFERENCE_DEFAULTS[key];
}

export function updateLastUsed(provider: string, model: string): void {
	const preferences = loadPreferences();
	preferences.lastProvider = provider;
	preferences.lastModel = model;

	// Also save the model for this specific provider
	if (!preferences.providerModels) {
		preferences.providerModels = {};
	}
	preferences.providerModels[provider] = model;

	savePreferences(preferences);
}

export function getLastUsedModel(provider: string): string | undefined {
	return getPreference('providerModels')?.[provider];
}

export function updateTitleShape(shape: string): void {
	setPreference('titleShape', shape as TitleShape);
}

export function getTitleShape(): TitleShape | undefined {
	return getPreference('titleShape');
}

export function updateSelectedTheme(theme: string): void {
	setPreference('selectedTheme', theme as ThemePreset);
}

export function updateNanocoderShape(shape: NanocoderShape): void {
	setPreference('nanocoderShape', shape);
}

export function getNanocoderShape(): NanocoderShape | undefined {
	return getPreference('nanocoderShape');
}

export function saveTune(config: TuneConfig): void {
	setPreference('tune', config);
}

/**
 * Get the notifications config from the preferences file.
 */
export function getNotificationsPreference(): NotificationsConfig | undefined {
	return getPreference('notifications');
}

/**
 * Save the notifications config to the preferences file.
 */
export function updateNotificationsPreference(
	config: NotificationsConfig,
): void {
	setPreference('notifications', config);
}

/**
 * Get the CI-watch config from the preferences file. Set by hand-editing
 * the preferences file for now — no `/settings` UI wizard yet (that's a
 * natural follow-up once the feature has seen real-world use).
 */
export function getCiWatchPreference(): CiWatchConfig | undefined {
	return getPreference('ciWatch');
}

/**
 * Get the reasoning expanded preference. Default false.
 */
export function getReasoningExpanded(): boolean {
	return getBooleanPreference('reasoningExpanded');
}

export function updateReasoningExpanded(value: boolean): void {
	setPreference('reasoningExpanded', value);
}

/**
 * Get the compact tool display preference. Default true.
 */
export function getCompactToolDisplay(): boolean {
	return getBooleanPreference('compactToolDisplay');
}

export function updateCompactToolDisplay(value: boolean): void {
	setPreference('compactToolDisplay', value);
}

/**
 * Get the per-response usage footer preference. Default true.
 */
export function getShowUsageFooter(): boolean {
	return getBooleanPreference('showUsageFooter');
}

export function updateShowUsageFooter(value: boolean): void {
	setPreference('showUsageFooter', value);
}

/**
 * Get the privacy scrubbing preference. Default false.
 */
export function getPrivacyPreference(): boolean {
	return getBooleanPreference('enablePromptScrubbing');
}

export function updatePrivacyPreference(value: boolean): void {
	setPreference('enablePromptScrubbing', value);
}

/**
 * Get the alternate-screen (fullscreen) preference. Default true. Also
 * settable via --alt-screen/--no-alt-screen at launch; this is the persisted
 * default.
 */
export function getAlternateScreen(): boolean {
	return getBooleanPreference('alternateScreen');
}

export function updateAlternateScreen(value: boolean): void {
	setPreference('alternateScreen', value);
}

/**
 * Get the mouse reporting preference. When true (default), the terminal reports
 * wheel ticks to the app so the mouse wheel scrolls the chat viewport; text
 * selection then needs Shift+drag (Option+drag in iTerm2). When false, the
 * terminal does not capture the mouse at all, so native text selection
 * (double-click, drag) works directly and the wheel does nothing.
 */
export function getMouseReporting(): boolean {
	return getBooleanPreference('mouseReporting');
}

export function updateMouseReporting(value: boolean): void {
	setPreference('mouseReporting', value);
}

/**
 * Get the professional ("boring") tone preference. Default false. When on,
 * progress text is strictly functional and the model is instructed to keep
 * responses terse.
 */
export function getProfessionalTone(): boolean {
	return getBooleanPreference('professionalTone');
}

export function updateProfessionalTone(value: boolean): void {
	setPreference('professionalTone', value);
}

// Cached: re-reads only when NANOCODER_CONFIG_DIR changes or a write bumps the version.
const cachedShowAgentBashOutput = cachedPreference(
	prefs => prefs.showAgentBashOutput === true,
);

/**
 * Get the agent bash output preference. Default false.
 */
export function getShowAgentBashOutput(): boolean {
	return cachedShowAgentBashOutput();
}

export function updateShowAgentBashOutput(value: boolean): void {
	setPreference('showAgentBashOutput', value);
}

/**
 * Get the paste threshold from the preferences file.
 */
export function getPasteThreshold(): number | undefined {
	const preferences = loadPreferences();
	const threshold = preferences.nanocoder?.paste?.singleLineThreshold;
	if (typeof threshold === 'number' && threshold > 0) {
		return Math.round(threshold);
	}
	return undefined;
}

/**
 * Save the paste threshold to the preferences file.
 */
export function updatePasteThreshold(threshold: number): void {
	const preferences = loadPreferences();
	if (!preferences.nanocoder) {
		preferences.nanocoder = {};
	}
	if (!preferences.nanocoder.paste) {
		preferences.nanocoder.paste = {singleLineThreshold: Math.round(threshold)};
	} else {
		preferences.nanocoder.paste.singleLineThreshold = Math.round(threshold);
	}
	savePreferences(preferences);
}

/** Ink's default rendering frame rate when maxFps is not configured. */
export const DEFAULT_MAX_FPS = 30;
/** Minimum allowable frame rate limit for Ink's maxFps (1 frame per second). */
export const MIN_MAX_FPS = 1;
/** Maximum allowable frame rate limit for Ink's maxFps (60 frames per second). */
export const MAX_MAX_FPS = 60;

/**
 * Validate Ink's maxFps preference.
 * Must be an integer between MIN_MAX_FPS (1) and MAX_MAX_FPS (60) inclusive.
 */
export function isValidMaxFps(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= MIN_MAX_FPS &&
		value <= MAX_MAX_FPS
	);
}

/**
 * Get the configured maxFps preference if valid, or undefined if unset or invalid.
 * Reads the namespaced `nanocoder.ui.maxFps` preference.
 */
export function getUiMaxFps(
	preferences = loadPreferences(),
): number | undefined {
	const value = preferences.nanocoder?.ui?.maxFps;
	if (isValidMaxFps(value)) {
		return value;
	}
	return undefined;
}

/**
 * Get the effective maximum TUI frame rate for Ink rendering.
 * Returns the validated integer from preferences (1-60), or preserves
 * the default of 30 FPS when not configured or when an invalid value is rejected.
 */
export function getMaxFps(preferences = loadPreferences()): number {
	return getUiMaxFps(preferences) ?? DEFAULT_MAX_FPS;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Resolve the project-context knobs from an already-loaded preferences object.
 *
 * The single place the semantic-memory defaults live. Callers that inject
 * `loadPreferences` (the plain shell) pass their own object in; everything else
 * goes through {@link getProjectContextPreferences}.
 */
export function resolveProjectContextPreferences(
	preferences: UserPreferences,
): Required<
	Pick<
		ProjectContextOptions,
		'semanticMemoryEnabled' | 'memoryLimit' | 'tokenBudget'
	>
> {
	return {
		semanticMemoryEnabled: preferences.semanticMemoryEnabled ?? true,
		memoryLimit: clamp(
			preferences.semanticMemoryLimit ?? DEFAULT_MEMORY_LIMIT,
			MIN_MEMORY_LIMIT,
			MAX_MEMORY_LIMIT,
		),
		tokenBudget: clamp(
			preferences.semanticMemoryTokenBudget ?? DEFAULT_TOKEN_BUDGET,
			MIN_TOKEN_BUDGET,
			MAX_TOKEN_BUDGET,
		),
	};
}

/** Project-context knobs for the current user. */
export function getProjectContextPreferences(): ReturnType<
	typeof resolveProjectContextPreferences
> {
	return resolveProjectContextPreferences(loadPreferences());
}

/**
 * Get the semantic memory preference from preferences
 */
export function getSemanticMemoryEnabled(): boolean {
	return getProjectContextPreferences().semanticMemoryEnabled;
}

/**
 * Save the semantic memory preference
 */
export function updateSemanticMemoryEnabled(value: boolean): void {
	setPreference('semanticMemoryEnabled', value);
}

/**
 * Save how many memories may be recalled into a single prompt.
 */
export function updateSemanticMemoryLimit(value: number): void {
	const preferences = loadPreferences();
	preferences.semanticMemoryLimit = clamp(
		value,
		MIN_MEMORY_LIMIT,
		MAX_MEMORY_LIMIT,
	);
	savePreferences(preferences);
}

/**
 * Save the token budget project context may consume in the system prompt.
 */
export function updateSemanticMemoryTokenBudget(value: number): void {
	const preferences = loadPreferences();
	preferences.semanticMemoryTokenBudget = clamp(
		value,
		MIN_TOKEN_BUDGET,
		MAX_TOKEN_BUDGET,
	);
	savePreferences(preferences);
}

/**
 * Get the voice configuration from preferences
 */
export function getVoicePreference(): import('@/types/config').VoiceConfig {
	if (cachedVoicePreference) return cachedVoicePreference;
	const preferences = loadPreferences();
	cachedVoicePreference = preferences.voice ?? {
		enabled: false,
		activationMode: 'push-to-talk',
		sttBackend: 'local',
		ttsBackend: 'local',
	};
	return cachedVoicePreference;
}

/**
 * Save the voice configuration to preferences
 */
export function updateVoicePreference(
	config: import('@/types/config').VoiceConfig,
): void {
	setPreference('voice', config);
}
