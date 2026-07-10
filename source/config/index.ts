import {config as loadEnv} from 'dotenv';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {type CliMode, VALID_MODES} from '@/app/types';
import {substituteEnvVars} from '@/config/env-substitution';
import {
	loadAllMCPConfigs,
	loadAllProviderConfigs,
} from '@/config/mcp-config-loader';
import {getConfigPath} from '@/config/paths';
import {
	getNotificationsPreference,
	loadPreferences,
} from '@/config/preferences';
import {defaultTheme, getThemeColors} from '@/config/themes';
import type {
	AppConfig,
	AutoCompactConfig,
	Colors,
	CompressionMode,
	CompressionStrategy,
	DevelopmentMode,
	ModeProviderConfig,
	NotificationsConfig,
	PasteConfig,
	ProviderConfig,
	SystemPromptConfig,
	TuneConfig,
} from '@/types/index';
import {logError} from '@/utils/message-queue';
import {DEFAULT_SINGLE_LINE_PASTE_THRESHOLD} from '@/utils/paste-utils';

// Load .env file from working directory (shell environment takes precedence)
// Suppress dotenv console output by temporarily redirecting stdout
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
	const originalWrite = process.stdout.write.bind(process.stdout);
	process.stdout.write = () => true;
	try {
		loadEnv({path: envPath});
	} finally {
		process.stdout.write = originalWrite;
	}
}

// Hold a map of what config files are where
export const confDirMap: Record<string, string> = {};

// Find the closest config file for the requested configuration file
export function getClosestConfigFile(fileName: string): string {
	try {
		const configDir = getConfigPath();

		// If NANOCODER_CONFIG_DIR is explicitly set, skip cwd and home checks
		// and use only the config directory (important for tests and explicit overrides)
		const isExplicitConfigDir = Boolean(process.env.NANOCODER_CONFIG_DIR);

		if (!isExplicitConfigDir) {
			// First, lets check for a working directory config
			const cwdPath = join(process.cwd(), fileName); // nosemgrep
			if (existsSync(cwdPath)) {
				// nosemgrep
				confDirMap[fileName] = cwdPath; // nosemgrep

				return cwdPath; // nosemgrep
			}
		}

		// Last, lets look for an user level config.

		// If the file doesn't exist, create it
		const configPath = join(configDir, fileName); // nosemgrep
		if (!existsSync(configPath)) {
			// nosemgrep
			createDefaultConfFile(configDir, fileName);
		}

		confDirMap[fileName] = configPath; // nosemgrep

		return configPath; // nosemgrep
	} catch (error) {
		logError(`Failed to load ${fileName}: ${String(error)}`);
	}

	// The code should never hit this, but it makes the TS compiler happy.
	return fileName;
}

function createDefaultConfFile(filePath: string, fileName: string): void {
	try {
		// If we cant find any, lets assume this is the first user run, create the
		// correct file and direct the user to configure them correctly,
		const configFilePath = join(filePath, fileName); // nosemgrep
		if (!existsSync(configFilePath)) {
			// nosemgrep
			// Maybe add a better sample config?
			const sampleConfig = {};

			mkdirSync(filePath, {recursive: true});
			writeFileSync(
				configFilePath, // nosemgrep
				JSON.stringify(sampleConfig, null, 2),
				'utf-8',
			);
		}
	} catch (error) {
		logError(`Failed to write ${filePath}: ${String(error)}`);
	}
}

/**
 * Read a JSON config file and hand the parsed contents to `extract`. Returns
 * null when the file is missing, unparseable, or `extract` rejects it. The
 * `label` only flavours the error log.
 */
function tryLoadConfig<T>(
	configPath: string,
	label: string,
	// biome-ignore lint/suspicious/noExplicitAny: parsed JSON is dynamically shaped
	extract: (config: any) => T | null,
): T | null {
	if (!existsSync(configPath)) {
		return null;
	}

	try {
		const config = JSON.parse(readFileSync(configPath, 'utf-8'));
		return extract(config);
	} catch (error) {
		logError(
			`Failed to load ${label} config from ${configPath}: ${String(error)}`,
		);
	}

	return null;
}

/**
 * Resolve a config value with project-over-global precedence: try
 * `<cwd>/<fileName>` first, then `<configDir>/<fileName>`. Returns null when
 * neither file yields a value.
 */
function loadHierarchicalConfig<T>(
	fileName: string,
	label: string,
	// biome-ignore lint/suspicious/noExplicitAny: parsed JSON is dynamically shaped
	extract: (config: any) => T | null,
): T | null {
	const projectResult = tryLoadConfig(
		join(process.cwd(), fileName), // nosemgrep
		label,
		extract,
	);
	if (projectResult !== null) {
		return projectResult;
	}

	return tryLoadConfig(join(getConfigPath(), fileName), label, extract); // nosemgrep
}

// Load auto-compact configuration and Returns default config if not specified
function loadAutoCompactConfig(): AutoCompactConfig {
	const defaults: AutoCompactConfig = {
		enabled: true,
		threshold: 60,
		mode: 'conservative',
		strategy: 'llm',
		notifyUser: true,
	};

	return (
		loadHierarchicalConfig('agents.config.json', 'auto-compact', config => {
			const autoCompact = config.nanocoder?.autoCompact;
			if (autoCompact && typeof autoCompact === 'object') {
				return {
					enabled:
						autoCompact.enabled !== undefined
							? Boolean(autoCompact.enabled)
							: defaults.enabled,
					threshold: validateThreshold(
						autoCompact.threshold ?? defaults.threshold,
					),
					mode: validateMode(autoCompact.mode ?? defaults.mode),
					strategy: validateStrategy(autoCompact.strategy ?? defaults.strategy),
					notifyUser:
						autoCompact.notifyUser !== undefined
							? Boolean(autoCompact.notifyUser)
							: defaults.notifyUser,
				};
			}
			return null;
		}) ?? defaults
	);
}

// Load tune configuration from agents.config.json if it exists
function loadTuneConfig(): Partial<TuneConfig> | undefined {
	return (
		loadHierarchicalConfig('agents.config.json', 'tune', config => {
			const tune = config.nanocoder?.tune;
			if (tune && typeof tune === 'object') {
				return tune as Partial<TuneConfig>;
			}
			return null;
		}) ?? undefined
	);
}

// Validate and clamp threshold to valid range (50-95)
function validateThreshold(threshold: unknown): number {
	const num = typeof threshold === 'number' ? threshold : 60;
	return Math.max(50, Math.min(95, Math.round(num)));
}

// Validate compression mode
function validateMode(mode: unknown): CompressionMode {
	if (mode === 'default' || mode === 'aggressive' || mode === 'conservative') {
		return mode;
	}
	return 'conservative';
}

// Validate compression strategy
function validateStrategy(strategy: unknown): CompressionStrategy {
	if (strategy === 'llm' || strategy === 'mechanical') {
		return strategy;
	}
	return 'llm';
}

// Load session configuration and Returns default config if not specified
function loadSessionConfig(): AppConfig['sessions'] {
	const defaults: NonNullable<AppConfig['sessions']> = {
		autoSave: true,
		saveInterval: 30000, // 30 seconds
		maxSessions: 100,
		maxMessages: 1000,
		retentionDays: 30,
		directory: '',
	};

	const normalizeSessionNumber = (
		value: unknown,
		min: number,
		fallback: number,
	): number => {
		if (typeof value === 'number' && Number.isFinite(value)) {
			return Math.max(min, value);
		}
		return fallback;
	};

	return (
		loadHierarchicalConfig('nanocoder-preferences.json', 'session', config => {
			const sessions = config.nanocoder?.sessions;
			if (sessions && typeof sessions === 'object') {
				return {
					autoSave:
						sessions.autoSave !== undefined
							? Boolean(sessions.autoSave)
							: defaults.autoSave,
					saveInterval: normalizeSessionNumber(
						sessions.saveInterval,
						1000, // Minimum 1 second
						defaults.saveInterval ?? 30000,
					),
					maxSessions: normalizeSessionNumber(
						sessions.maxSessions,
						1,
						defaults.maxSessions ?? 100,
					),
					maxMessages: normalizeSessionNumber(
						sessions.maxMessages,
						1,
						defaults.maxMessages ?? 1000,
					),
					retentionDays: normalizeSessionNumber(
						sessions.retentionDays,
						1,
						defaults.retentionDays ?? 30,
					),
					directory: sessions.directory || defaults.directory,
				};
			}
			return null;
		}) ?? defaults
	);
}

// Default ceiling on LLM turns for headless (--plain / ACP) conversations.
// High enough that legitimate long iterative jobs finish, low enough that a
// wedged model in CI can't run unbounded. Override via the NANOCODER_MAX_TURNS
// env var or `nanocoder.headless.maxTurns` in agents.config.json.
export const DEFAULT_HEADLESS_MAX_TURNS = 200;

// Load headless conversation limits. Env var wins (handy for CI), then
// agents.config.json, then the default.
function loadHeadlessConfig(): AppConfig['headless'] {
	const defaults: NonNullable<AppConfig['headless']> = {
		maxTurns: DEFAULT_HEADLESS_MAX_TURNS,
	};

	const envValue = process.env['NANOCODER_MAX_TURNS'];
	if (envValue !== undefined && envValue.trim() !== '') {
		const parsed = Number.parseInt(envValue, 10);
		if (Number.isFinite(parsed) && parsed >= 1) {
			return {maxTurns: parsed};
		}
	}

	return (
		loadHierarchicalConfig('agents.config.json', 'headless', config => {
			const headless = config.nanocoder?.headless;
			if (headless && typeof headless === 'object') {
				const value = headless.maxTurns;
				if (typeof value === 'number' && Number.isFinite(value)) {
					return {maxTurns: Math.max(1, Math.round(value))};
				}
				return defaults;
			}
			return null;
		}) ?? defaults
	);
}

// Load paste configuration and Returns default config if not specified
function loadPasteConfig(): PasteConfig {
	const defaults: PasteConfig = {
		singleLineThreshold: DEFAULT_SINGLE_LINE_PASTE_THRESHOLD,
	};

	return (
		loadHierarchicalConfig('nanocoder-preferences.json', 'paste', config => {
			const paste = config.nanocoder?.paste;
			if (paste && typeof paste === 'object') {
				return {
					singleLineThreshold:
						typeof paste.singleLineThreshold === 'number' &&
						Number.isFinite(paste.singleLineThreshold) &&
						paste.singleLineThreshold > 0
							? Math.round(paste.singleLineThreshold)
							: defaults.singleLineThreshold,
				};
			}
			return null;
		}) ?? defaults
	);
}

function loadNanocoderToolsConfig(): AppConfig['nanocoderTools'] {
	return (
		loadHierarchicalConfig('agents.config.json', 'nanocoderTools', config => {
			const nanocoderTools = config.nanocoder?.nanocoderTools;
			if (nanocoderTools && typeof nanocoderTools === 'object') {
				return substituteEnvVars(nanocoderTools);
			}
			return null;
		}) ?? undefined
	);
}

function loadAlwaysAllowConfig(): string[] | undefined {
	return (
		loadHierarchicalConfig('agents.config.json', 'alwaysAllow', config => {
			const alwaysAllow = config.nanocoder?.alwaysAllow;
			if (Array.isArray(alwaysAllow)) {
				return alwaysAllow.filter(
					(item: unknown): item is string => typeof item === 'string',
				);
			}
			return null;
		}) ?? undefined
	);
}

function loadDisabledToolsConfig(): string[] | undefined {
	return (
		loadHierarchicalConfig('agents.config.json', 'disabledTools', config => {
			const disabledTools = config.nanocoder?.disabledTools;
			if (Array.isArray(disabledTools)) {
				return disabledTools.filter(
					(item: unknown): item is string => typeof item === 'string',
				);
			}
			return null;
		}) ?? undefined
	);
}

function loadSystemPromptConfig(): SystemPromptConfig | undefined {
	return (
		loadHierarchicalConfig('agents.config.json', 'systemPrompt', config => {
			const systemPrompt = config.nanocoder?.systemPrompt;
			if (!systemPrompt || typeof systemPrompt !== 'object') {
				return null;
			}

			const result: SystemPromptConfig = {};
			if (systemPrompt.mode === 'replace' || systemPrompt.mode === 'append') {
				result.mode = systemPrompt.mode;
			}
			if (typeof systemPrompt.content === 'string') {
				result.content = systemPrompt.content;
			}
			if (typeof systemPrompt.file === 'string') {
				result.file = systemPrompt.file;
			}

			if (result.content === undefined && result.file === undefined) {
				return null;
			}

			return result;
		}) ?? undefined
	);
}

function loadModeProvidersConfig(
	providers: ProviderConfig[],
): Partial<Record<DevelopmentMode, ModeProviderConfig>> | undefined {
	return (
		loadHierarchicalConfig('agents.config.json', 'modeProviders', config => {
			const modeProviders = config.nanocoder?.modeProviders;
			if (
				!modeProviders ||
				typeof modeProviders !== 'object' ||
				Array.isArray(modeProviders)
			) {
				return null;
			}

			const result: Partial<Record<DevelopmentMode, ModeProviderConfig>> = {};

			for (const [mode, config] of Object.entries(modeProviders)) {
				if (!(VALID_MODES as readonly string[]).includes(mode)) {
					logError(`Invalid modeProviders config: unknown mode '${mode}'.`);
					continue;
				}

				// Typecast to unknown first, then check object structure
				const typedConfig = config as Record<string, unknown>;
				if (!typedConfig || typeof typedConfig !== 'object') continue;

				const providerName =
					typeof typedConfig.provider === 'string'
						? typedConfig.provider
						: undefined;
				const modelName =
					typeof typedConfig.model === 'string' ? typedConfig.model : undefined;

				if (!providerName || !modelName) {
					logError(
						`Invalid modeProviders config for mode '${mode}': missing provider or model string.`,
					);
					continue;
				}

				const matchedProvider = providers.find(
					p => p.name.toLowerCase() === providerName.toLowerCase(),
				);
				if (!matchedProvider) {
					logError(
						`Invalid modeProviders config for mode '${mode}': provider '${providerName}' not found in configured providers.`,
					);
					continue;
				}

				if (
					matchedProvider.models.length > 0 &&
					!matchedProvider.models.includes(modelName)
				) {
					logError(
						`Invalid modeProviders config for mode '${mode}': model '${modelName}' not found in models for provider '${matchedProvider.name}'.`,
					);
					continue;
				}

				result[mode as DevelopmentMode] = {
					provider: matchedProvider.name,
					model: modelName,
				};
			}

			return Object.keys(result).length > 0 ? result : null;
		}) ?? undefined
	);
}

// Load notifications configuration from preferences
function loadNotificationsConfig(): NotificationsConfig | undefined {
	return getNotificationsPreference();
}

export function loadDefaultMode(): CliMode | undefined {
	return (
		loadHierarchicalConfig('agents.config.json', 'defaultMode', config => {
			const defaultMode = config.nanocoder?.defaultMode;
			if (typeof defaultMode === 'string') {
				const normalized = defaultMode.toLowerCase().trim();
				if ((VALID_MODES as readonly string[]).includes(normalized)) {
					return normalized as CliMode;
				}
			}
			return null;
		}) ?? undefined
	);
}

// Function to load app configuration from agents.config.json if it exists
function loadAppConfig(): AppConfig {
	// Load providers from the new hierarchical configuration system
	const providers = loadAllProviderConfigs();

	// Load MCP servers from the new hierarchical configuration system
	const mcpServersWithSource = loadAllMCPConfigs();
	const mcpServers = mcpServersWithSource.map(item => item.server);

	// Load auto-compact configuration
	const autoCompact = loadAutoCompactConfig();

	// Load session configuration
	const sessions = loadSessionConfig();

	// Load headless conversation limits
	const headless = loadHeadlessConfig();

	// Load paste configuration
	const paste = loadPasteConfig();

	// Load nanocoder tools configuration
	const nanocoderTools = loadNanocoderToolsConfig();

	// Load top-level alwaysAllow (for non-interactive mode and as fallback)
	const alwaysAllow = loadAlwaysAllowConfig();

	// Load top-level disabledTools (filtered out of every tool-availability path)
	const disabledTools = loadDisabledToolsConfig();

	// Load custom system prompt override
	const systemPrompt = loadSystemPromptConfig();

	// Load notifications configuration
	const notifications = loadNotificationsConfig();

	// Load mode providers configuration
	const modeProviders = loadModeProvidersConfig(providers);
	// Load tune configuration (model mode defaults from agents.config.json)
	const tune = loadTuneConfig();

	return {
		providers,
		mcpServers,
		autoCompact,
		sessions,
		headless,
		paste,
		nanocoderTools,
		alwaysAllow,
		disabledTools,
		systemPrompt,
		notifications,
		modeProviders,
		tune,
	};
}

let _appConfig: AppConfig | null = null;

/**
 * Lazy-loaded app config to avoid circular dependencies during module initialization
 * @public
 */
export function getAppConfig(): AppConfig {
	if (!_appConfig) {
		_appConfig = loadAppConfig();
	}
	return _appConfig;
}

// Function to reload the app configuration (useful after config file changes)
export function reloadAppConfig(): void {
	_appConfig = loadAppConfig();
}

// Function to clear the cached app configuration (useful for testing)
export function clearAppConfig(): void {
	_appConfig = null;
}

let cachedColors: Colors | null = null;

export function getColors(): Colors {
	if (!cachedColors) {
		const preferences = loadPreferences();
		const selectedTheme = preferences.selectedTheme || defaultTheme;
		cachedColors = getThemeColors(selectedTheme);
	}
	return cachedColors;
}
