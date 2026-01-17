export type MCPTransportType = 'stdio' | 'websocket' | 'http';

export interface MCPAuthConfig {
	type: 'bearer' | 'basic' | 'api-key' | 'custom';
	token?: string;
	username?: string;
	password?: string;
	apiKey?: string;
	customHeaders?: Record<string, string>;
}

export interface MCPServer {
	name: string;
	transport: MCPTransportType;

	// STDIO-specific fields
	command?: string;
	args?: string[];
	env?: Record<string, string>;

	// Remote transport-specific fields
	url?: string;
	headers?: Record<string, string>;
	auth?: MCPAuthConfig;
	timeout?: number;
	reconnect?: {
		enabled: boolean;
		maxAttempts: number;
		backoffMs: number;
	};
	// Tools that can be executed without asking for approval
	alwaysAllow?: string[];

	// Common fields
	description?: string;
	tags?: string[];
	enabled?: boolean;
}

export interface MCPTool {
	name: string;
	description?: string;
	// JSON Schema for tool input - intentionally flexible
	// biome-ignore lint/suspicious/noExplicitAny: Dynamic typing required
	inputSchema?: any;
	serverName: string;
}

export interface MCPInitResult {
	serverName: string;
	success: boolean;
	toolCount?: number;
	error?: string;
}
