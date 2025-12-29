import type {ThemePreset} from '@/types/ui';

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
	config: {
		baseURL?: string;
		apiKey?: string;
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
	[key: string]: unknown; // Allow additional provider-specific config
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
		[key: string]: unknown; // Allow additional provider-specific config
	}[];

	mcpServers?: {
		name: string;
		transport: 'stdio' | 'websocket' | 'http';
		command?: string;
		args?: string[];
		env?: Record<string, string>;
		url?: string;
		headers?: Record<string, string>;
		auth?: {
			type: 'bearer' | 'basic' | 'api-key' | 'custom';
			token?: string;
			username?: string;
			password?: string;
			apiKey?: string;
			customHeaders?: Record<string, string>;
		};
		timeout?: number;
		reconnect?: {
			enabled: boolean;
			maxAttempts: number;
			backoffMs: number;
		};
		description?: string;
		tags?: string[];
		enabled?: boolean;
	}[];

	// LSP server configurations (optional - auto-discovery enabled by default)
	lspServers?: {
		name: string;
		command: string;
		args?: string[];
		languages: string[]; // File extensions this server handles
		env?: Record<string, string>;
	}[];
}

// Context management configuration
export interface ContextManagementConfig {
	enabled?: boolean; // Default: false (off)
	maxContextTokens?: number; // Model's context limit (auto-detected if not set)
	reservedOutputTokens?: number; // Tokens reserved for response (default: 4096)
	trimStrategy?: 'age-based' | 'priority-based'; // Default: 'priority-based'
	preserveRecentTurns?: number; // Turns to always preserve (default: 5)
	summarizeOnTruncate?: boolean; // Generate summaries for dropped messages (default: false)
	summarizationMode?: 'rule-based' | 'llm-based'; // How to summarize (default: 'rule-based')
	maxSummaryTokens?: number; // Max tokens for each summary (default: 500)
	preserveErrorDetails?: boolean; // Keep full error messages in summaries (default: true)
	tokenEstimator?: 'auto' | 'conservative' | 'exact'; // Default: 'auto'
}

export const DEFAULT_CONTEXT_CONFIG: Required<ContextManagementConfig> = {
	enabled: false,
	maxContextTokens: 128000,
	reservedOutputTokens: 4096,
	trimStrategy: 'priority-based',
	preserveRecentTurns: 5,
	summarizeOnTruncate: false,
	summarizationMode: 'rule-based',
	maxSummaryTokens: 500,
	preserveErrorDetails: true,
	tokenEstimator: 'auto',
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
	rollingContextEnabled?: boolean; // Quick toggle (default: false)
	contextManagement?: ContextManagementConfig; // Full config
}
