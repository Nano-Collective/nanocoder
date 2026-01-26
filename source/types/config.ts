import type {TitleShape} from '@/components/ui/styled-title';
import type {NanocoderShape, ThemePreset} from '@/types/ui';

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
	};

	// Auto-compact configuration
	autoCompact?: AutoCompactConfig;
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
	// Optional source information for display purposes
	source?: 'project' | 'global';
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
}
