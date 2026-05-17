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
	};
	customMessages?: {
		toolConfirmation?: {title: string; message: string};
		questionPrompt?: {title: string; message: string};
		generationComplete?: {title: string; message: string};
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

// Model parameters passed directly to AI SDK streamText/generateText
export interface ModelParameters {
	temperature?: number;
	topP?: number;
	topK?: number;
	maxTokens?: number;
	frequencyPenalty?: number;
	presencePenalty?: number;
	stop?: string[];
	// Reasoning controls for OpenAI Responses API models (GPT-5, o-series).
	// Only applied by providers that speak the Responses API (e.g. chatgpt-codex).
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
