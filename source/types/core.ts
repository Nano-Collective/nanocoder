import React from 'react';

import {
	tool,
	jsonSchema,
	type Tool as AISDKTool,
	type ModelMessage,
	type FinishReason,
	type LanguageModelUsage,
} from 'ai';

export {tool, jsonSchema, type ModelMessage};

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

/**
 * Tool execution options passed to tool handlers
 * These options provide context and control for tool execution
 */
export interface ToolExecutionOptions {
	/** Unique identifier for this tool call */
	toolCallId?: string;
	/** Message history that led to this tool call */
	messages?: ModelMessage[];
	/** Abort signal for cancelling long-running operations */
	abortSignal?: AbortSignal;
	/** Experimental context from generateText/streamText */
	experimental_context?: unknown;
}

// Tool handlers accept dynamic args from LLM, so any is appropriate here
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool arguments are dynamically typed
export type ToolHandler = (
	input: any,
	options?: ToolExecutionOptions,
) => Promise<string>;

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
 * Unified tool entry interface
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
 * Nanocoder's extended tool definition
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
	// Use def.tool.name instead of def.config.function.name
	config?: Tool;
}

interface LLMMessage {
	role: 'assistant';
	content: string;
	tool_calls?: ToolCall[];
}

/**
 * Information about a single step in a multi-step generation
 */
export interface StepResult {
	/** The text generated in this step */
	text: string;
	/** Tool calls made in this step */
	toolCalls: unknown[];
	/** Tool results from this step */
	toolResults: unknown[];
	/** Reason why the step finished */
	finishReason: FinishReason;
	/** Token usage for this step */
	usage: LanguageModelUsage;
	/** Original step response for additional data */
	response?: {
		messages: ModelMessage[];
	};
}

/**
 * Tool error information extracted from steps
 */
export interface ToolError {
	toolCallId: string;
	toolName: string;
	error: unknown;
	input?: unknown;
}

export interface LLMChatResponse {
	choices: Array<{
		message: LLMMessage;
	}>;
	/** Steps from multi-step execution (if enabled) */
	steps?: StepResult[];
	/** Response messages from AI SDK for conversation history */
	responseMessages?: ModelMessage[];
	/** Tool errors that occurred during execution */
	toolErrors?: ToolError[];
}

/**
 * Callbacks for step-level events
 */
export interface StepCallbacks {
	/** Called when a step finishes */
	onStepFinish?: (step: StepResult) => void;
	/** Called before a step starts - can modify step configuration */
	prepareStep?: (params: {
		stepNumber: number;
		steps: StepResult[];
		messages: ModelMessage[];
	}) => Promise<{
		/** Override messages for this step */
		messages?: ModelMessage[];
		/** Limit active tools for this step */
		activeTools?: string[];
		/** Override tool choice for this step */
		toolChoice?: ToolChoice;
	}>;
}

export interface StreamCallbacks {
	onToken?: (token: string) => void;
	onToolCall?: (toolCall: ToolCall) => void;
	onFinish?: () => void;
}

/**
 * Tool choice control
 */
export type ToolChoice =
	| 'auto' // Model decides (default)
	| 'required' // Must call a tool
	| 'none' // Must NOT call tools
	| {type: 'tool'; toolName: string}; // Must call specific tool

/**
 * Options for LLM chat requests
 */
export interface ChatOptions {
	/** Enable multi-step tool calling */
	enableMultiStep?: boolean;
	/** Maximum number of steps (default: 5) */
	maxSteps?: number;
	/** Tool choice control */
	toolChoice?: ToolChoice;
	/** Limit active tools */
	activeTools?: string[];
	/** Step-level callbacks */
	stepCallbacks?: StepCallbacks;
	/** Experimental context passed to tools */
	experimental_context?: unknown;
}

export interface LLMClient {
	getCurrentModel(): string;
	setModel(model: string): void;
	getContextSize(): number;
	getAvailableModels(): Promise<string[]>;
	chat(
		messages: Message[],
		tools: Record<string, AISDKCoreTool>,
		options?: ChatOptions,
		signal?: AbortSignal,
	): Promise<LLMChatResponse>;
	chatStream?(
		messages: Message[],
		tools: Record<string, AISDKCoreTool>,
		callbacks: StreamCallbacks,
		options?: ChatOptions,
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
