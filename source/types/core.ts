import React from 'react';

/**
 * AI SDK Migration Status - Phase 1 COMPLETE ✅
 *
 * Phase 1: Type Foundation (DONE)
 * - ✅ AI SDK types imported and exported
 * - ✅ Tool definitions migrated to use AI SDK's tool() and jsonSchema()
 * - ✅ nativeToolsRegistry provides AI SDK tools for direct use
 *
 * Phase 2: Tool Definitions (DONE)
 * - ✅ All 10 tools migrated to native AI SDK format
 * - ✅ Each tool has: coreTool (AI SDK), handler, formatter, validator
 * - ✅ No execute functions (human-in-the-loop pattern maintained)
 *
 * Phase 3: Message Format Migration (COMPLETE ✅)
 * - ✅ Message conversion at AI SDK boundary (ai-sdk-client.ts)
 * - ✅ convertToModelMessages() converts to ModelMessage format
 * - ✅ Tool results use proper ToolModelMessage with ToolResultPart structure
 * - ✅ Proper type safety with ModelMessage[] return type
 *
 * Why Dual Format Approach (Phase 3)?
 * - Internal: Keep OpenAI-compatible Message format (tool_calls, tool_call_id, name)
 * - Boundary: Convert to AI SDK's ModelMessage at api-sdk-client only
 * - Benefits: Minimal disruption, maintains internal architecture, proper AI SDK usage
 * - Tool messages: Use v5 ToolResultPart with type='text' output for string results
 */

// Import AI SDK v5 types for Phase 3 migration
import type {
	ModelMessage,
	SystemModelMessage,
	UserModelMessage,
	AssistantModelMessage,
	ToolModelMessage,
} from 'ai';

// Import AI SDK helpers for tool definitions
import {tool, jsonSchema} from 'ai';

// Export AI SDK helpers
export {tool, jsonSchema};

// Export AI SDK v5 types for Phase 3 migration
export type {
	ModelMessage,
	SystemModelMessage,
	UserModelMessage,
	AssistantModelMessage,
	ToolModelMessage,
};

// Type for AI SDK tools (return type of tool() function)
// Using any here because tool() is generic and returns Tool<INPUT, OUTPUT>
// where INPUT/OUTPUT vary per tool. We don't auto-execute tools anyway.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AISDKTool = any;

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
 * Nanocoder's extended tool definition (Phase 2 Complete)
 *
 * Combines AI SDK's native tool with Nanocoder-specific extensions:
 * - tool: Native AI SDK tool (using tool() and jsonSchema()) WITHOUT execute function
 * - handler: Manual execution function called after user confirmation (human-in-the-loop)
 * - config: Legacy OpenAI format for backward compatibility
 * - formatter: React component for rich UI display in terminal
 * - validator: Optional pre-execution validation
 * - requiresConfirmation: Whether to show confirmation UI (default: true)
 */
export interface ToolDefinition {
	// Native AI SDK tool (without execute to prevent auto-execution)
	tool: AISDKTool;
	// Manual execution handler (called after user confirmation)
	handler: ToolHandler;
	// Legacy OpenAI format (deprecated - kept for backward compatibility)
	config: Tool;
	formatter?: (
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool arguments are dynamically typed
		args: any,
		result?: string,
	) =>
		| string
		| Promise<string>
		| React.ReactElement
		| Promise<React.ReactElement>;
	requiresConfirmation?: boolean;
	validator?: (
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool arguments are dynamically typed
		args: any,
	) => Promise<{valid: true} | {valid: false; error: string}>;
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

export interface LLMClient {
	getCurrentModel(): string;
	setModel(model: string): void;
	getContextSize(): number;
	getAvailableModels(): Promise<string[]>;
	chat(
		messages: Message[],
		tools: Tool[],
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
