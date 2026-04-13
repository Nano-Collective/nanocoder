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
		headers?: Record<string, string>;
		[key: string]: unknown;
	};
}

// Provider configuration type for wizard and config building
export interface ProviderConfig {
	name: string;
	baseUrl?: string;
	apiKey?: string;
	models: string[];
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

export interface AutoCompactConfig {
	enabled: boolean;
	threshold: number;
	mode: CompressionMode;
	notifyUser: boolean;
}

// Paste handling configuration
export interface PasteConfig {
	singleLineThreshold: number;
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
		models: string[];
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

	// Nanocoder-specific tool configurations
	nanocoderTools?: {
		alwaysAllow?: string[];
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
export type ToolProfile = 'full' | 'minimal';

// Model parameters passed directly to AI SDK streamText/generateText
export interface ModelParameters {
	temperature?: number;
	topP?: number;
	topK?: number;
	maxTokens?: number;
	frequencyPenalty?: number;
	presencePenalty?: number;
	stop?: string[];
}

export interface TuneConfig {
	enabled: boolean;
	toolProfile: ToolProfile;
	aggressiveCompact: boolean;
	disableNativeTools?: boolean;
	modelParameters?: ModelParameters;
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
}
