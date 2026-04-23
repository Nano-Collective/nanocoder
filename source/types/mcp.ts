import type {JSONSchema7} from 'ai';
import type {MCPServerConfig} from '@/types/config';

export type MCPTransportType = 'stdio' | 'websocket' | 'http';

// MCPServer is MCPServerConfig without the source tracking field
export type MCPServer = Omit<MCPServerConfig, 'source'>;

export type MCPToolInputSchema = JSONSchema7;

export interface MCPTool {
	name: string;
	description?: string;
	inputSchema?: MCPToolInputSchema;
	serverName: string;
}

export interface MCPInitResult {
	serverName: string;
	success: boolean;
	toolCount?: number;
	error?: string;
}
