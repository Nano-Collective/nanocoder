import path from 'node:path';
import {readFileSync} from 'fs';
import type {TitleShape} from '@/components/ui/styled-title';
import {getClosestConfigFile} from '@/config/index';
import {
	DEFAULT_MEMORY_LIMIT,
	DEFAULT_TOKEN_BUDGET,
	MAX_MEMORY_LIMIT,
	MAX_TOKEN_BUDGET,
	MIN_MEMORY_LIMIT,
	MIN_TOKEN_BUDGET,
	type ProjectContextOptions,
} from '@/memory/project-context';
import type {TuneConfig} from '@/types/config';
import type {UserPreferences} from '@/types/index';
import type {NanocoderShape, ThemePreset} from '@/types/ui';
import {atomicWriteFileSync} from '@/utils/atomic-write';
import {logError} from '@/utils/message-queue';

let PREFERENCES_PATH: string | null = null;
let CACHED_CONFIG_DIR: string | undefined = undefined;

function getPreferencesPath(): string {
	// Re-compute path if NANOCODER_CONFIG_DIR has changed (important for tests)
	const currentConfigDir = process.env.NANOCODER_CONFIG_DIR;
	if (!PREFERENCES_PATH || CACHED_CONFIG_DIR !== currentConfigDir) {
		PREFERENCES_PATH = getClosestConfigFile('nanocoder-preferences.json');
		CACHED_CONFIG_DIR = currentConfigDir;
	}
	return PREFERENCES_PATH;
}

// Export for testing purposes - allows tests to reset the cache
export function resetPreferencesCache(): void {
	PREFERENCES_PATH = null;
	CACHED_CONFIG_DIR = undefined;
}

export function loadPreferences(): UserPreferences {
	try {
		const data = readFileSync(getPreferencesPath(), 'utf-8');
		return JSON.parse(data) as UserPreferences;
	} catch (error) {
		logError(`Failed to load preferences: ${String(error)}`);
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

export function savePreferences(preferences: UserPreferences): void {
	try {
		atomicWriteFileSync(
			getPreferencesPath(),
			JSON.stringify(preferences, null, 2),
		);
	} catch (error) {
		logError(`Failed to save preferences: ${String(error)}`);
		return;
	}

	preferencesVersion++;
	for (const listener of preferencesListeners) {
		listener();
	}
}

/**
 * True if `directory` (or an equivalent absolute path) is recorded in
 * `preferences.trustedDirectories`. Shared by every trust-gated entry point
 * — the interactive TUI's `useDirectoryTrust`, `--plain`'s `runPlainShell`,
 * and the daemon boot path — so the resolution rule can't drift between them.
 */
export function isDirectoryTrusted(
	directory: string,
	preferences: UserPreferences,
): boolean {
	const resolved = path.resolve(directory); // nosemgrep
	return (preferences.trustedDirectories ?? []).some(
		dir => path.resolve(dir) === resolved, // nosemgrep
	);
}

export interface DirectoryTrustResult {
	trusted: boolean;
	/** True if this call persisted a new trust entry (env-var bypass only). */
	persisted: boolean;
}

export interface DirectoryTrustDeps {
	loadPreferences: typeof loadPreferences;
	savePreferences: typeof savePreferences;
}

/**
 * Resolves directory trust for a non-interactive entry point (`--plain`,
 * `nanocoder daemon start`) — anywhere that has no disclaimer UI to show.
 *
 * `bypass` is the caller's own one-shot override (each entry point's own
 * `--trust-directory` flag); it never persists, matching the interactive
 * disclaimer's per-run nature. Absent that, a directory already recorded in
 * `trustedDirectories` (from a prior interactive run, or a previous
 * `NANOCODER_TRUST_DIRECTORY=1` run) is trusted as-is. A first-time
 * `NANOCODER_TRUST_DIRECTORY=1` run persists the directory so later runs
 * don't need the env var again.
 */
export function ensureDirectoryTrust(
	directory: string,
	bypass: boolean,
	deps: DirectoryTrustDeps = {loadPreferences, savePreferences},
): DirectoryTrustResult {
	if (bypass) return {trusted: true, persisted: false};

	const preferences = deps.loadPreferences();
	if (isDirectoryTrusted(directory, preferences)) {
		return {trusted: true, persisted: false};
	}

	if (process.env.NANOCODER_TRUST_DIRECTORY === '1') {
		const resolved = path.resolve(directory); // nosemgrep
		deps.savePreferences({
			...preferences,
			trustedDirectories: [...(preferences.trustedDirectories ?? []), resolved],
		});
		return {trusted: true, persisted: true};
	}

	return {trusted: false, persisted: false};
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

export function updateTitleShape(shape: string): void {
	const preferences = loadPreferences();
	preferences.titleShape = shape as TitleShape;
	savePreferences(preferences);
}

export function getTitleShape(): TitleShape | undefined {
	const preferences = loadPreferences();
	return preferences.titleShape;
}

export function updateSelectedTheme(theme: string): void {
	const preferences = loadPreferences();
	preferences.selectedTheme = theme as ThemePreset;
	savePreferences(preferences);
}

export function getLastUsedModel(provider: string): string | undefined {
	const preferences = loadPreferences();
	return preferences.providerModels?.[provider];
}

export function updateNanocoderShape(shape: NanocoderShape): void {
	const preferences = loadPreferences();
	preferences.nanocoderShape = shape;
	savePreferences(preferences);
}

export function getNanocoderShape(): NanocoderShape | undefined {
	const preferences = loadPreferences();
	return preferences.nanocoderShape;
}

export function saveTune(config: TuneConfig): void {
	const preferences = loadPreferences();
	preferences.tune = config;
	savePreferences(preferences);
}

/**
 * Get the notifications config from the preferences file.
 */
export function getNotificationsPreference():
	| import('@/types/config').NotificationsConfig
	| undefined {
	const preferences = loadPreferences();
	return preferences.notifications;
}

/**
 * Save the notifications config to the preferences file.
 */
export function updateNotificationsPreference(
	config: import('@/types/config').NotificationsConfig,
): void {
	const preferences = loadPreferences();
	preferences.notifications = config;
	savePreferences(preferences);
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

/**
 * Get the reasoning expanded preference from preferences or environment
 */
export function getReasoningExpanded(): boolean {
	const preferences = loadPreferences();
	return preferences.reasoningExpanded ?? false;
}

/**
 * Save the reasoning expanded preference
 */
export function updateReasoningExpanded(value: boolean): void {
	const preferences = loadPreferences();
	preferences.reasoningExpanded = value;
	savePreferences(preferences);
}

/**
 * Get the compact tool display preference from preferences or environment
 */
export function getCompactToolDisplay(): boolean {
	const preferences = loadPreferences();
	return preferences.compactToolDisplay ?? true;
}

/**
 * Save the compact tool display preference
 */
export function updateCompactToolDisplay(value: boolean): void {
	const preferences = loadPreferences();
	preferences.compactToolDisplay = value;
	savePreferences(preferences);
}

/**
 * Get the per-response usage footer preference. On by default.
 */
export function getShowUsageFooter(): boolean {
	const preferences = loadPreferences();
	return preferences.showUsageFooter ?? true;
}

/**
 * Save the per-response usage footer preference
 */
export function updateShowUsageFooter(value: boolean): void {
	const preferences = loadPreferences();
	preferences.showUsageFooter = value;
	savePreferences(preferences);
}

/**
 * Get the privacy scrubbing preference from preferences
 */
export function getPrivacyPreference(): boolean {
	const preferences = loadPreferences();
	return preferences.enablePromptScrubbing ?? false;
}

/**
 * Save the privacy scrubbing preference
 */
export function updatePrivacyPreference(value: boolean): void {
	const preferences = loadPreferences();
	preferences.enablePromptScrubbing = value;
	savePreferences(preferences);
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
	const preferences = loadPreferences();
	preferences.semanticMemoryEnabled = value;
	savePreferences(preferences);
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
 * Get the alternate-screen (fullscreen) preference. Also settable via
 * --alt-screen/--no-alt-screen at launch; this is the persisted default.
 */
export function getAlternateScreen(): boolean {
	const preferences = loadPreferences();
	return preferences.alternateScreen ?? true;
}

/**
 * Save the alternate-screen preference
 */
export function updateAlternateScreen(value: boolean): void {
	const preferences = loadPreferences();
	preferences.alternateScreen = value;
	savePreferences(preferences);
}

/**
 * Get the mouse reporting preference. When true (default), the terminal reports
 * wheel ticks to the app so the mouse wheel scrolls the chat viewport; text
 * selection then needs Shift+drag (Option+drag in iTerm2). When false, the
 * terminal does not capture the mouse at all, so native text selection
 * (double-click, drag) works directly and the wheel does nothing.
 */
export function getMouseReporting(): boolean {
	const preferences = loadPreferences();
	return preferences.mouseReporting ?? true;
}

/**
 * Save the mouse reporting preference
 */
export function updateMouseReporting(value: boolean): void {
	const preferences = loadPreferences();
	preferences.mouseReporting = value;
	savePreferences(preferences);
}

/**
 * Get the professional ("boring") tone preference. When on, progress text is
 * strictly functional and the model is instructed to keep responses terse.
 */
export function getProfessionalTone(): boolean {
	const preferences = loadPreferences();
	return preferences.professionalTone ?? false;
}

/**
 * Save the professional tone preference
 */
export function updateProfessionalTone(value: boolean): void {
	const preferences = loadPreferences();
	preferences.professionalTone = value;
	savePreferences(preferences);
}
