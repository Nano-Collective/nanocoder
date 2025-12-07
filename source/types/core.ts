import React from 'react';

import {tool, jsonSchema, type Tool as AISDKTool} from 'ai';

export {tool, jsonSchema};

// Type for AI SDK tools (return type of tool() function)
// Tool<PARAMETERS, RESULT> is AI SDK's actual tool type
// We use 'any' for generics since we don't auto-execute tools (human-in-the-loop)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AISDKCoreTool = AISDKTool<any, any>;

// Current Nanocoder message format (OpenAI-compatible)
// Note: We maintain this format internally and convert to ModelMessage at AI SDK boundary
export interface Message {
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
	name?: string;
}

export interface ToolCall {
	id: string;
	function: {
		name: string;
		arguments: Record<string, unknown>;
	};
}

export interface ToolResult {
	tool_call_id: string;
	role: 'tool';
	name: string;
	content: string;
}

export interface ToolParameterSchema {
	type?: string;
	description?: string;
	[key: string]: unknown;
}

export interface Tool {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: {
			type: 'object';
			properties: Record<string, ToolParameterSchema>;
			required: string[];
		};
	};
}

// Tool handlers accept dynamic args from LLM, so any is appropriate here
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool arguments are dynamically typed
export type ToolHandler = (input: any) => Promise<string>;

/**
 * Tool formatter type for Ink UI
 * Formats tool arguments and results for display in the CLI
 */
export type ToolFormatter = (
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool arguments are dynamically typed
	args: any,
	result?: string,
) =>
	| string
	| Promise<string>
	| React.ReactElement
	| Promise<React.ReactElement>;

/**
 * Tool validator type for pre-execution validation
 * Returns validation result with optional error message
 */
export type ToolValidator = (
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool arguments are dynamically typed
	args: any,
) => Promise<{valid: true} | {valid: false; error: string}>;

/**
 * Nanocoder tool export structure
 *
 * This is what individual tool files export (e.g., read-file.tsx, execute-bash.tsx).
 * The handler is extracted from tool.execute() in tools/index.ts to avoid duplication.
 *
 * Structure:
 * - name: Tool name as const for type safety
 * - tool: Native AI SDK v6 CoreTool with execute() function
 * - formatter: Optional React component for rich CLI UI display
 * - validator: Optional pre-execution validation function
 */
export interface NanocoderToolExport {
	name: string;
	tool: AISDKCoreTool; // AI SDK v6 tool with execute()
	formatter?: ToolFormatter; // For UI display
	validator?: ToolValidator; // For pre-execution validation
}

/**
 * Internal tool entry used by ToolRegistry
 *
 * This is the complete tool entry including the handler extracted from tool.execute().
 * Used internally by ToolRegistry and ToolManager for unified tool management.
 *
 * Structure:
 * - name: Tool name for registry lookup
 * - tool: Native AI SDK CoreTool (for passing to AI SDK)
 * - handler: Extracted execute function (for human-in-the-loop execution)
 * - formatter: Optional React component for rich CLI UI display
 * - validator: Optional pre-execution validation function
 */
export interface ToolEntry {
	name: string;
	tool: AISDKCoreTool; // For AI SDK
	handler: ToolHandler; // For execution (extracted from tool.execute)
	formatter?: ToolFormatter; // For UI (React component)
	validator?: ToolValidator; // For validation
}

interface LLMMessage {
	role: 'assistant';
	content: string;
	tool_calls?: ToolCall[];
}

export interface LLMChatResponse {
	choices: Array<{
		message: LLMMessage;
	}>;
}

export interface StreamCallbacks {
	onToken?: (token: string) => void;
	onToolCall?: (toolCall: ToolCall) => void;
	onToolExecuted?: (toolCall: ToolCall, result: string) => void;
	onFinish?: () => void;
}

export interface LLMClient {
	getCurrentModel(): string;
	setModel(model: string): void;
	getContextSize(): number;
	getAvailableModels(): Promise<string[]>;
	chat(
		messages: Message[],
		tools: Record<string, AISDKCoreTool>,
		callbacks: StreamCallbacks,
		signal?: AbortSignal,
	): Promise<LLMChatResponse>;
	clearContext(): Promise<void>;
}

export type DevelopmentMode = 'normal' | 'auto-accept' | 'plan';

export const DEVELOPMENT_MODE_LABELS: Record<DevelopmentMode, string> = {
	normal: '▶ normal mode on',
	'auto-accept': '⏵⏵ auto-accept mode on',
	plan: '⏸ plan mode on',
};

// Connection status types for MCP and LSP servers
export type ConnectionStatus = 'connected' | 'failed' | 'pending';

export interface MCPConnectionStatus {
	name: string;
	status: ConnectionStatus;
	errorMessage?: string;
}

export interface LSPConnectionStatus {
	name: string;
	status: ConnectionStatus;
	errorMessage?: string;
}
