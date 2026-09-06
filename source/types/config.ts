import type {TitleShape} from '@/components/ui/styled-title';
import type {DevelopmentMode} from '@/types/core';
import type {NanocoderShape, ThemePreset} from '@/types/ui';

// Supported AI SDK provider packages
export type SdkProvider =
	| 'openai-compatible'
	| 'google'
	| 'anthropic'
	| 'chatgpt-codex'
	| 'github-copilot';

// AI provider configurations (OpenAI-compatible)
export interface AIProviderConfig {
	name: string;
	type: string;
	models: string[];
	contextWindow?: number;
	contextWindows?: Record<string, number>;
	requestTimeout?: number;
	socketTimeout?: number;
	maxRetries?: number; // Maximum number of retries for failed requests (default: 2)
	connectionPool?: {
		idleTimeout?: number;
		cumulativeMaxIdleTimeout?: number;
	};
	// Tool configuration
	disableTools?: boolean; // Disable tools for entire provider
	disableToolModels?: string[]; // List of model names to disable tools for
	// SDK provider package to use (default: 'openai-compatible')
	sdkProvider?: SdkProvider;
	// Opt out of Anthropic prompt caching (enabled by default on that SDK).
	// Read only when sdkProvider is 'anthropic'; setting it on any other SDK
	// provider has no effect, since those either prefix-cache automatically
	// (OpenAI, OpenRouter) or have no cache to address (local models).
	promptCaching?: boolean;
	// Model mode defaults for this provider
	tune?: Partial<TuneConfig>;
	// OpenRouter-specific request body fields (provider routing, plugins,
	// service tier, fallback models, reasoning). Active whenever the provider
	// is OpenRouter — not gated by tune.
	openrouter?: OpenRouterParameters;
	config: {
		baseURL?: string;
		apiKey?: string;
		caCertPath?: string;
		headers?: Record<string, string>;
		[key: string]: unknown;
	};
}

// Provider configuration type for wizard and config building
export interface ProviderConfig {
	name: string;
	baseUrl?: string;
	apiKey?: string;
	caCertPath?: string;
	models: string[];
	contextWindow?: number;
	contextWindows?: Record<string, number>;
	requestTimeout?: number;
	socketTimeout?: number;
	maxRetries?: number; // Maximum number of retries for failed requests (default: 2)
	organizationId?: string;
	timeout?: number;
	connectionPool?: {
		idleTimeout?: number;
		cumulativeMaxIdleTimeout?: number;
	};
	// Tool configuration
	disableTools?: boolean; // Disable tools for entire provider
	disableToolModels?: string[]; // List of model names to disable tools for
	headers?: Record<string, string>;
	// SDK provider package to use (default: 'openai-compatible')
	sdkProvider?: SdkProvider;
	// OpenRouter-specific request body fields. Only applied when the provider
	// is OpenRouter (name match, case-insensitive).
	openrouter?: OpenRouterParameters;
	[key: string]: unknown; // Allow additional provider-specific config
}

// Auto-compact configuration
export type CompressionMode = 'default' | 'aggressive' | 'conservative';

// How compaction is performed:
// - 'llm': call the active model to write a structured summary of the
//   compressible segment, replacing it with a single synthetic message.
//   Higher fidelity, costs one extra round-trip.
// - 'mechanical': hard-truncate each message individually with regex
//   heuristics. No network call, lower fidelity.
export type CompressionStrategy = 'llm' | 'mechanical';

export interface AutoCompactConfig {
	enabled: boolean;
	threshold: number;
	mode: CompressionMode;
	strategy: CompressionStrategy;
	notifyUser: boolean;
}

// Paste handling configuration
export interface PasteConfig {
	singleLineThreshold: number;
}

// Agent-loop retry limits: caps on how many times the conversation loop
// auto-retries a failing pattern without user intervention. Distinct from the
// per-provider `maxRetries` setting, which governs network request retries.
export interface RetryLimitsConfig {
	// Consecutive turns emitting the identical tool call(s) before the loop
	// pauses and asks the user whether to continue (interactive) or stops
	// (--plain, headless, subagent runs). The check fires before the Nth
	// repeat runs, so the default of 3 executes it twice. Unknown-tool calls
	// count toward the streak too.
	maxRepeatedToolCalls: number;
	// Consecutive empty assistant turns auto-nudged before the loop gives up.
	// The interactive loop additionally compacts the context and retries once;
	// --plain stops straight after the nudges. Not used by subagent runs,
	// whose loop ends on its own when a turn has no tool calls.
	maxEmptyTurns: number;
	// Malformed self-correction retries allowed for text-parsed tool calls
	// before the loop gives up. Covers the XML fallback path in both runtimes,
	// plus (interactive only) native responses that emit tool-call text
	// instead of native tool calls. Not used by subagent runs.
	maxMalformedRetries: number;
}

// Custom system prompt configuration
export interface SystemPromptConfig {
	// "replace" overrides the entire built-in prompt; "append" adds to the end.
	// Defaults to "replace" — the issue's primary use case is shrinking the prompt.
	mode?: 'replace' | 'append';
	// Inline prompt content. Takes priority over `file` when both are set.
	content?: string;
	// Path to a markdown/text file containing the prompt. Resolved relative to
	// the working directory if not absolute.
	file?: string;
}

// Desktop notification configuration
export interface NotificationsConfig {
	enabled: boolean;
	sound?: boolean;
	// Emit a terminal bell (BEL) alongside the desktop notification. Unlike the
	// native notifiers it reaches the terminal itself, so it still lands over SSH
	// or inside tmux.
	bell?: boolean;
	timeout?: number;
	events?: {
		toolConfirmation?: boolean;
		questionPrompt?: boolean;
		generationComplete?: boolean;
		triggeredRunComplete?: boolean;
	};
	customMessages?: {
		toolConfirmation?: {title: string; message: string};
		questionPrompt?: {title: string; message: string};
		generationComplete?: {title: string; message: string};
		triggeredRunComplete?: {title: string; message: string};
	};
}

/**
 * Points in the agent lifecycle a user-defined shell command can be attached
 * to. `pre-tool-use` and `user-prompt-submit` are the vetoing points: a
 * non-zero exit denies the tool call (or the prompt) and its stdout is handed
 * back to the model as the reason. The rest are observe-only — a non-zero exit
 * there is logged, and the remaining hooks still run.
 */
export const HOOK_EVENTS = [
	'session-start',
	'session-end',
	'user-prompt-submit',
	'pre-tool-use',
	'post-tool-use',
	'pre-compact',
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

/**
 * A single lifecycle hook: one shell command, optionally scoped to a set of
 * tools (tool events only) and with its own timeout.
 */
export interface HookDefinition {
	/** Shell command to run. Receives hook context via NANOCODER_* env vars. */
	command: string;
	/**
	 * Tool names this hook applies to. Omitted means "every tool".
	 * Ignored by non-tool events.
	 */
	matchTools?: string[];
	/**
	 * Milliseconds before the hook is killed. Defaults to 30s, except
	 * `session-end`, which defaults to 2s so it fits inside the shutdown budget.
	 * A timed-out hook never blocks — only a deliberate non-zero exit does.
	 */
	timeout?: number;
	/** Optional label used in transcripts and /doctor instead of the command. */
	name?: string;
}

/** Lifecycle hooks keyed by event. Every event is optional. */
export type HooksConfig = Partial<Record<HookEvent, HookDefinition[]>>;

// Note: temperature is intentionally excluded from this interface.
// It cannot be applied during a mode switch without proper integration into
// the tune/ModelParameters pipeline (tune.ts). Tracked as a follow-up.
export interface ModeProviderConfig {
	provider: string;
	model: string;
}

// ---------------------------------------------------------------------------
// On-disk shape of agents.config.json
//
// This is the schema source of truth. It differs from the runtime AppConfig:
//   • includes $schema (editor-only, ignored by the loader)
//   • includes defaultMode (read by loadDefaultMode(), not on AppConfig)
//   • uses ProviderConfig for providers (superset of the AppConfig inline type)
//   • autoCompact is Partial (the loader defaults each field)
//   • excludes notifications, sessions, paste (read from nanocoder-preferences.json)
//
// The JSON schema generator (`pnpm run generate:schema`) targets this type.
// These types are consumed exclusively by that tooling and are not part of
// the runtime surface, hence @internal.
// ---------------------------------------------------------------------------

/** Valid default mode values for agents.config.json. */
export type DiskDefaultMode = 'normal' | 'auto-accept' | 'yolo' | 'plan';

/**
 * Per-mode provider/model overrides keyed by mode name (e.g. use a fast
 * model for plan mode). Keys are constrained to the user-selectable modes so
 * the schema rejects typos and unsupported modes at edit time.
 * @internal
 */
export type DiskModeProviders = Partial<
	Record<DiskDefaultMode, ModeProviderConfig>
>;

/**
 * On-disk representation of the `nanocoder` namespace in agents.config.json.
 *
 * Every field is optional — the loader applies sensible defaults for each one.
 * Fields that live in nanocoder-preferences.json (notifications, sessions,
 * paste) are intentionally absent: the schema should not advertise keys the
 * loader silently ignores.
 * @internal
 */
export interface DiskNanocoderConfig {
	/** AI provider configurations (all OpenAI-compatible). */
	providers?: ProviderConfig[];
	/** Default conversation mode when none is specified. */
	defaultMode?: DiskDefaultMode;
	/** Automatic context compression when usage exceeds threshold. All fields have defaults. */
	autoCompact?: Partial<AutoCompactConfig>;
	/** Model mode defaults (tool profile, tool mode, model parameters). */
	tune?: Partial<TuneConfig>;
	/** Maximum LLM turns for headless runs (--plain and ACP loops). */
	headless?: {
		/** Maximum LLM turns before the loop forces a final, tool-free answer. */
		maxTurns?: number;
	};
	/** Model Context Protocol server configurations. */
	mcpServers?: MCPServerConfig[];
	/** LSP server configurations (optional — auto-discovery enabled by default). */
	lspServers?: {
		name: string;
		command: string;
		args?: string[];
		/** File extensions this server handles. */
		languages: string[];
		env?: Record<string, string>;
	}[];
	/** Tools that run automatically without confirmation in non-interactive mode. */
	alwaysAllow?: string[];
	/** Tools unavailable to the model — filtered out of chat, subagents, and tune profiles. */
	disabledTools?: string[];
	/** Custom system prompt — replaces or extends the built-in prompt. */
	systemPrompt?: SystemPromptConfig;
	/**
	 * Shell commands run at fixed points in the agent loop, keyed by lifecycle
	 * event. Project-local, so this carries the same code-execution weight as
	 * `mcpServers` above.
	 */
	hooks?: HooksConfig;
	/** Nanocoder-specific tool configurations. */
	nanocoderTools?: {
		webSearch?: {
			apiKey?: string;
		};
	};
	/** Per-mode provider/model overrides (e.g. use a fast model for plan mode). */
	modeProviders?: DiskModeProviders;
	/**
	 * Agent-loop retry limits. Each field has its own sensible default — you
	 * can set any combination (e.g. just `maxRepeatedToolCalls`).
	 */
	retries?: Partial<RetryLimitsConfig>;
}

/**
 * Root structure of agents.config.json.
 *
 * The schema wraps DiskNanocoderConfig under the `nanocoder` key to match
 * the actual on-disk layout. The optional `$schema` property enables
 * editor autocompletion without being read by the loader. A legacy top-level
 * `providers` form (without the `nanocoder` wrapper) is still accepted by the
 * project provider loader (loadProjectProviderConfigs), so it is advertised
 * here too.
 * @internal
 */
export interface DiskConfig {
	/** JSON Schema URI for editor autocompletion. Ignored by the loader. */
	$schema?: string;
	/** Top-level provider list — alternative to `nanocoder.providers`. Accepts the same format. */
	providers?: ProviderConfig[];
	nanocoder?: DiskNanocoderConfig;
}

export interface AppConfig {
	// Providers array structure - all OpenAI compatible
	providers?: ProviderConfig[];

	modeProviders?: Partial<Record<DevelopmentMode, ModeProviderConfig>>;

	mcpServers?: MCPServerConfig[];

	// LSP server configurations (optional - auto-discovery enabled by default)
	lspServers?: {
		name: string;
		command: string;
		args?: string[];
		languages: string[]; // File extensions this server handles
		env?: Record<string, string>;
	}[];

	// Tools that can run automatically in non-interactive mode
	alwaysAllow?: string[];

	// Tools that are unavailable to the model — filtered out of every code
	// path that asks "which tools can I use?" (chat, subagents, tune profiles).
	// Names match registered tool ids (e.g. "execute_bash", "web_search",
	// "agent"). MCP tools follow the same naming as in their server config.
	disabledTools?: string[];

	// Custom system prompt — replaces or extends the built-in prompt
	systemPrompt?: SystemPromptConfig;

	// Lifecycle hooks — shell commands run at fixed points in the agent loop.
	// Project-local config, so it carries the same code-execution weight as
	// `mcpServers`, gated by the same directory-trust prompt.
	hooks?: HooksConfig;

	// Nanocoder-specific tool configurations
	nanocoderTools?: {
		webSearch?: {
			apiKey?: string;
		};
	};

	// Auto-compact configuration
	autoCompact?: AutoCompactConfig;

	// Paste handling configuration
	paste?: PasteConfig;

	// Desktop notification configuration
	notifications?: NotificationsConfig;

	// Model mode defaults (global)
	tune?: Partial<TuneConfig>;

	// Session configuration
	sessions?: {
		autoSave?: boolean;
		saveInterval?: number;
		maxSessions?: number;
		maxMessages?: number;
		retentionDays?: number;
		directory?: string;
	};

	// Headless / non-interactive conversation limits (--plain and ACP loops)
	headless?: {
		// Maximum LLM turns before the loop forces a final, tool-free answer.
		maxTurns?: number;
	};

	// Agent-loop retry limits (interactive conversation loop)
	retries?: RetryLimitsConfig;
}

// MCP Server configuration with source tracking
export interface MCPServerConfig {
	name: string;
	transport: 'stdio' | 'websocket' | 'http';
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	timeout?: number;
	alwaysAllow?: string[];
	description?: string;
	tags?: string[];
	enabled?: boolean;
	// Optional source information for display purposes
	source?: 'project' | 'global' | 'env';
}

// Tune configuration for runtime model tuning via /tune command.
// 'auto' resolves to one of the concrete profiles based on the active model
// (see inferToolProfile); the rest are fixed tool subsets.
export type ToolProfile = 'auto' | 'full' | 'minimal' | 'nano';

// OpenRouter reasoning options. Forwarded into the request body as
// `reasoning: { ... }`. See https://openrouter.ai/docs/use-cases/reasoning-tokens.
export interface OpenRouterReasoning {
	// OpenRouter supports `xhigh`, `high`, `medium`, `low`, `minimal`, and `none`.
	effort?: 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none';
	max_tokens?: number;
	exclude?: boolean;
	enabled?: boolean;
}

// OpenRouter price/throughput/latency thresholds. Either a flat number
// (legacy form) or a per-percentile object — the live OpenRouter schema
// accepts both. See https://openrouter.ai/docs/guides/routing/provider-selection.
export interface OpenRouterPercentile {
	p50?: number;
	p75?: number;
	p90?: number;
	p99?: number;
}

// OpenRouter max_price block. All sub-fields are optional and expressed in
// USD per million tokens (prompt/completion) or per call (request/image).
export interface OpenRouterMaxPrice {
	prompt?: number;
	completion?: number;
	request?: number;
	image?: number;
}

// OpenRouter provider routing options. Forwarded as `provider: { ... }`.
// See https://openrouter.ai/docs/guides/routing/provider-selection.
export interface OpenRouterProviderRouting {
	order?: string[];
	allow_fallbacks?: boolean;
	require_parameters?: boolean;
	data_collection?: 'allow' | 'deny';
	only?: string[];
	ignore?: string[];
	quantizations?: string[];
	// Flat-string form is the common case; the object form lets you partition
	// the sort key across models for cross-model fallback scenarios.
	sort?:
		| 'price'
		| 'throughput'
		| 'latency'
		| {
				by: 'price' | 'throughput' | 'latency';
				partition?: 'model' | 'none';
		  };
	// Zero Data Retention enforcement.
	zdr?: boolean;
	// Skip providers that compress or transform the text in lossy ways.
	enforce_distillable_text?: boolean;
	max_price?: OpenRouterMaxPrice;
	preferred_min_throughput?: number | OpenRouterPercentile;
	preferred_max_latency?: number | OpenRouterPercentile;
}

// OpenRouter plugin entry. Replaces the legacy top-level `transforms` field.
// The most common use is `{ id: 'context-compression', engine: 'middle-out' }`,
// but the plugin set is open-ended so we accept any additional keys.
export interface OpenRouterPlugin {
	id: string;
	[key: string]: unknown;
}

// OpenRouter-specific request parameters. Merged into the request body via
// AI SDK providerOptions when the active provider is named "openrouter".
// Lives on `AIProviderConfig.openrouter` so the rules apply on every request
// regardless of whether the user has tune enabled.
export interface OpenRouterParameters {
	provider?: OpenRouterProviderRouting;
	reasoning?: OpenRouterReasoning;
	// Fallback model list. Tried in order if the primary model errors or is
	// unavailable. See https://openrouter.ai/docs/features/model-routing.
	models?: string[];
	// Pricing/latency tier. `flex` is cheaper / higher latency, `priority`
	// is more expensive / lower latency. There is no `auto` request value —
	// OpenRouter only reports `auto`/`default`/`standard` back in the response.
	// See https://openrouter.ai/docs/guides/features/service-tiers.
	service_tier?: 'flex' | 'priority';
	// Top-level routing toggle. Currently only `"fallback"` is documented.
	route?: 'fallback';
	// OpenRouter plugin pipeline (context compression, web, file parser, etc).
	// Replaces the deprecated top-level `transforms` field.
	plugins?: OpenRouterPlugin[];
	// Stable end-user identifier surfaced to upstream providers for abuse
	// tracking. Optional.
	user?: string;
	// Escape hatch for arbitrary OpenRouter body fields that don't have a
	// dedicated typed entry yet. Shallow-merged into the request body before
	// the typed fields above, so the typed fields win on key conflicts.
	extraBody?: Record<string, unknown>;
}

// Model parameters passed directly to AI SDK streamText/generateText
export interface ModelParameters {
	temperature?: number;
	topP?: number;
	topK?: number;
	maxTokens?: number;
	frequencyPenalty?: number;
	presencePenalty?: number;
	stop?: string[];
	// Reasoning controls. Applied as follows:
	//   chatgpt-codex (OpenAI Responses API): mapped to providerOptions.openai.
	//   openrouter: mapped to reasoning.effort in providerOptions.openrouter.
	//   Other providers ignore this field.
	reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
	reasoningSummary?: 'auto' | 'concise' | 'detailed';
}

export type ToolMode = 'native' | 'xml' | 'json';

export interface TuneConfig {
	enabled: boolean;
	toolProfile: ToolProfile;
	aggressiveCompact: boolean;
	// 'native' uses the AI SDK's native tool calling. 'xml' and 'json' inject
	// tool definitions into the system prompt and parse them out of text.
	// Use getTuneToolMode() instead of reading this field directly so the
	// legacy `disableNativeTools` flag still works for old preference files.
	toolMode?: ToolMode;
	// @deprecated Use toolMode instead. Kept for backward compatibility with
	// preferences saved before tri-state mode existed; mapped at read time.
	disableNativeTools?: boolean;
	// When false, AGENTS.md is not appended to the system prompt. Defaults to true
	// when undefined to preserve historical behaviour.
	includeAgentsMd?: boolean;
	modelParameters?: ModelParameters;
}

/**
 * Resolves the active tool mode from a TuneConfig, applying the back-compat
 * mapping for legacy `disableNativeTools` flags.
 */
export function getTuneToolMode(tune: TuneConfig | undefined): ToolMode {
	if (!tune?.enabled) return 'native';
	if (tune.toolMode) return tune.toolMode;
	if (tune.disableNativeTools) return 'xml';
	return 'native';
}

export const TUNE_DEFAULTS: TuneConfig = {
	// Auto-profiling is on by default: large/cloud models resolve to 'full'
	// (no change), while small local models are automatically given the
	// slimmer 'minimal'/'nano' tool set. Users can override via /tune.
	enabled: true,
	toolProfile: 'auto',
	aggressiveCompact: false,
};

export interface UserPreferences {
	lastProvider?: string;
	lastModel?: string;
	providerModels?: {
		[key in string]?: string;
	};
	lastUpdateCheck?: number;
	selectedTheme?: ThemePreset;
	/**
	 * Theme whose palette colours syntax highlighting in code blocks, diffs, and
	 * file previews. Defaults to `selectedTheme`; set it only to give code a
	 * palette of its own. An unknown name falls back to `selectedTheme`.
	 */
	syntaxTheme?: ThemePreset;
	trustedDirectories?: string[];
	titleShape?: TitleShape;
	nanocoderShape?: NanocoderShape;
	tune?: TuneConfig;
	notifications?: NotificationsConfig;
	/**
	 * Namespaced settings (sessions, paste) read from nanocoder-preferences.json
	 * by the loaders. Kept under `nanocoder` to match the on-disk shape the
	 * `loadSessionConfig` / `loadPasteConfig` loaders read.
	 */
	nanocoder?: {
		sessions?: {
			autoSave?: boolean;
			saveInterval?: number;
			maxSessions?: number;
			maxMessages?: number;
			retentionDays?: number;
			directory?: string;
		};
		paste?: PasteConfig;
	};
	reasoningExpanded?: boolean;
	compactToolDisplay?: boolean;
	/**
	 * Show the per-response usage footer under each assistant message
	 * (provider-reported tokens + estimated cost). Defaults to true. When
	 * false the message ends after its content, with no footer line.
	 */
	showUsageFooter?: boolean;
	enablePromptScrubbing?: boolean;
	/** Whether semantic memory is active. Default true to preserve existing behavior. */
	semanticMemoryEnabled?: boolean;
	/** Max memories recalled into one prompt. Defaults and bounds live in project-context.ts. */
	semanticMemoryLimit?: number;
	/** Approximate token ceiling for the injected Project Context block. */
	semanticMemoryTokenBudget?: number;
	/**
	 * Interactive TUI screen mode. true (default): fullscreen on the
	 * alternate screen buffer with in-app scrolling (wheel / PgUp / PgDn).
	 * false: inline mode on the main screen — finished messages print into
	 * the terminal's native scrollback, so the terminal's own scrollbar,
	 * wheel, and search work, but the TUI cannot clip or re-layout old
	 * content. Also switchable per-run with the --no-alt-screen flag.
	 */
	alternateScreen?: boolean;
	/**
	 * "Boring" output mode. false (default): playful touches stay, e.g. the
	 * "Worked for a plucky 12s." completion note. true: progress text is
	 * strictly functional and the system prompt gains a section telling the
	 * model to be terse — no filler, no preamble, no celebratory wrap-ups.
	 */
	professionalTone?: boolean;
}
