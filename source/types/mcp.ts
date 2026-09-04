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

export interface MCPResource {
	uri: string;
	name: string;
	description?: string;
	mimeType?: string;
	serverName: string;
}

export interface MCPResourceContent {
	uri: string;
	mimeType?: string;
	text?: string;
	blob?: string;
}

export interface MCPPrompt {
	name: string;
	description?: string;
	arguments?: Array<{
		name: string;
		description?: string;
		required?: boolean;
	}>;
	serverName: string;
}

export interface MCPPromptMessage {
	role: 'user' | 'assistant';
	content: {
		type: 'text' | 'image' | 'resource';
		text?: string;
		data?: string;
		mimeType?: string;
	};
}

export interface MCPPromptResult {
	description?: string;
	messages: MCPPromptMessage[];
}

export interface MCPInitResult {
	serverName: string;
	success: boolean;
	toolCount?: number;
	resourceCount?: number;
	promptCount?: number;
	error?: string;
}
