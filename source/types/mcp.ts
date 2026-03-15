import type {MCPServerConfig} from '@/types/config';

export type MCPTransportType = 'stdio' | 'websocket' | 'http';

// MCPServer is MCPServerConfig without the source tracking field
export type MCPServer = Omit<MCPServerConfig, 'source'>;

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
