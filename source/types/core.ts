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
import {tool, jsonSchema, type Tool as AISDKTool} from 'ai';

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
 * Unified tool entry interface for Phase 3 enhancement
 *
 * Provides a structured way to manage all tool metadata in one place:
 * - name: Tool name for registry and lookup
 * - tool: Native AI SDK CoreTool (without execute for human-in-the-loop)
 * - handler: Manual execution handler called after user confirmation
 * - formatter: Optional React component for rich CLI UI display
 * - validator: Optional pre-execution validation function
 */
export interface ToolEntry {
	name: string;
	tool: AISDKCoreTool; // For AI SDK
	handler: ToolHandler; // For execution
	formatter?: ToolFormatter; // For UI (React component)
	validator?: ToolValidator; // For validation
}

/**
 * Nanocoder's extended tool definition (Phase 4+ Complete)
 *
 * Uses AI SDK's native CoreTool with Nanocoder-specific metadata:
 * - name: Tool name (metadata for registry and lookup)
 * - tool: Native AI SDK CoreTool (using tool() and jsonSchema()) WITHOUT execute function
 * - handler: Manual execution function called after user confirmation (human-in-the-loop)
 * - formatter: React component for rich UI display in terminal
 * - validator: Optional pre-execution validation
 * - requiresConfirmation: Whether to show confirmation UI (default: true)
 *
 * Note: We keep 'name' as metadata since AI SDK's Tool type doesn't expose it.
 */
export interface ToolDefinition {
	// Tool name for registry and lookup
	name: string;
	// Native AI SDK tool (without execute to prevent auto-execution)
	tool: AISDKCoreTool;
	// Manual execution handler (called after user confirmation)
	handler: ToolHandler;
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
	// DEPRECATED: Legacy format (will be removed in Phase 4+)
	// Use def.tool.name instead of def.config.function.name
	config?: Tool;
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
		tools: Record<string, AISDKCoreTool>,
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
