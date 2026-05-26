import type {TitleShape} from '@/components/ui/styled-title';
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

export interface AppConfig {
	// Providers array structure - all OpenAI compatible
	providers?: {
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
		connectionPool?: {
			idleTimeout?: number;
			cumulativeMaxIdleTimeout?: number;
		};
		// Tool configuration
		disableTools?: boolean; // Disable tools for entire provider
		disableToolModels?: string[]; // List of model names to disable tools for
		// SDK provider package to use (default: 'openai-compatible')
		sdkProvider?: SdkProvider;
		// OpenRouter-specific request body fields. Only applied when the
		// provider is OpenRouter (name match, case-insensitive).
		openrouter?: OpenRouterParameters;
		[key: string]: unknown; // Allow additional provider-specific config
	}[];

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

	// Local model workflow (Router + Specialist)
	localModelWorkflow?: LocalModelWorkflowConfig;
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

// Tune configuration for runtime model tuning via /tune command
export type ToolProfile = 'full' | 'minimal' | 'nano';

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
	enabled: false,
	toolProfile: 'full',
	aggressiveCompact: false,
};

/** Configuration for the Router + Specialist local model workflow. */
export interface LocalModelWorkflowConfig {
	/** Explicitly enable/disable the local model workflow.
	 *  When undefined, activates automatically for local providers. */
	enabled?: boolean;
	/** When true (default), auto-activate for detected local providers. */
	activateForLocalProviders?: boolean;
	/** Router configuration. */
	router?: {
		/** Model to use for intent classification (small fast model recommended). */
		model?: string;
		/** Timeout in ms for the classification call. Default: 2000. */
		timeout?: number;
		/** Default category when nothing matches. Default: 'chat'. */
		defaultCategory?: string;
	};
}

export interface UserPreferences {
	lastProvider?: string;
	lastModel?: string;
	providerModels?: {
		[key in string]?: string;
	};
	lastUpdateCheck?: number;
	selectedTheme?: ThemePreset;
	trustedDirectories?: string[];
	titleShape?: TitleShape;
	nanocoderShape?: NanocoderShape;
	tune?: TuneConfig;
	notifications?: NotificationsConfig;
	paste?: PasteConfig;
	reasoningExpanded?: boolean;
	compactToolDisplay?: boolean;
}
