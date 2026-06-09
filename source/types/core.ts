import {
	type Tool as AISDKTool,
	asSchema,
	type JSONValue,
	jsonSchema,
	tool,
} from 'ai';
import React from 'react';
import type {AIProviderConfig} from '@/types/config';

export {asSchema, jsonSchema, tool};

// Type for AI SDK tools (return type of tool() function)
// Tool<PARAMETERS, RESULT> is AI SDK's actual tool type
// We use 'any' for generics since we don't auto-execute tools (human-in-the-loop)
// biome-ignore lint/suspicious/noExplicitAny: Dynamic typing required
export type AISDKCoreTool = AISDKTool<any, any>;

/**
 * Per-tool approval policy. A `boolean` is a static decision; a function is a
 * pure decision over the parsed arguments AND the current development mode.
 *
 * Mode is passed in explicitly (never read from a global) so the same tool
 * definition behaves correctly regardless of which execution path evaluates
 * it. `resolveToolApproval()` in `@/tools/approval-policy` is the single
 * authority that invokes these.
 */
export type ToolApprovalPolicy =
	| boolean
	// biome-ignore lint/suspicious/noExplicitAny: tool args are schema-validated per tool
	| ((args: any, mode: DevelopmentMode) => boolean | Promise<boolean>);

// Current Nanocoder message format (OpenAI-compatible)
// Note: We maintain this format internally and convert to ModelMessage at AI SDK boundary
export interface Message {
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
	name?: string;
	reasoning?: string;
	// For tool messages: an optional structured payload sent to the model as a
	// JSON tool result instead of the plain `content` text. `content` remains
	// the canonical string for display, persistence, and as the fallback.
	structuredContent?: JSONValue;
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
	/** Canonical string output: used for display, persistence, and as the
	 * fallback model representation when `structuredContent` is absent. */
	content: string;
	/** Optional structured payload sent to the model as a JSON tool result. */
	structuredContent?: JSONValue;
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
 * Structured tool output. A tool returns this (instead of a bare string) when
 * the model benefits from a typed payload it can reason over precisely (e.g.
 * a diagnostics list). `llmContent` is the equivalent text used for display,
 * persistence, and as a fallback; `structured` is sent to the model as JSON.
 */
export interface StructuredToolOutput {
	llmContent: string;
	structured: JSONValue;
}

/** What a tool's execute/handler may return: a plain string or structured output. */
export type ToolExecuteResult = string | StructuredToolOutput;

// Tool handlers accept dynamic args from LLM, so any is appropriate here
// biome-ignore lint/suspicious/noExplicitAny: Dynamic typing required -- Tool arguments are dynamically typed
export type ToolHandler = (input: any) => Promise<ToolExecuteResult>;

/**
 * Tool formatter type for Ink UI
 * Formats tool arguments and results for display in the CLI
 */
export type ToolFormatter = (
	// biome-ignore lint/suspicious/noExplicitAny: Dynamic typing required -- Tool arguments are dynamically typed
	args: any,
	result?: string,
) =>
	| string
	| Promise<string>
	| React.ReactElement
	| Promise<React.ReactElement>;

/**
 * Structured detail for a single validation failure. Optional alongside the
 * human-readable `error` message; when present it gives a self-correcting LLM
 * field-level specifics (which argument, what was expected, what arrived)
 * instead of only a freeform sentence.
 */
export interface ValidationErrorDetail {
	/** The offending argument/field name (e.g. "command"). */
	path?: string;
	/** What the field should have been (e.g. "string", "non-empty"). */
	expected?: string;
	/** What the field actually was (e.g. "undefined", "number"). */
	received?: string;
	/** Optional extra explanation for this specific field. */
	message?: string;
}

export type ToolValidationResult =
	| {valid: true}
	| {valid: false; error: string; details?: ValidationErrorDetail[]};

/**
 * Tool validator type for pre-execution validation.
 * Returns a validation result with a human-readable error message and,
 * optionally, structured per-field details.
 */
export type ToolValidator = (
	// biome-ignore lint/suspicious/noExplicitAny: Dynamic typing required -- Tool arguments are dynamically typed
	args: any,
) => Promise<ToolValidationResult>;

/**
 * Streaming formatter type for tools that need real-time progress updates
 * Called BEFORE execution to set up the progress component
 * The component updates itself via event subscription (e.g., EventEmitter)
 *
 * @param args - Tool arguments
 * @param executionId - Unique ID for tracking this execution
 * @returns React element that will self-update during execution
 */
export type StreamingFormatter = (
	// biome-ignore lint/suspicious/noExplicitAny: Dynamic typing required -- Tool arguments are dynamically typed
	args: any,
	executionId: string,
) => React.ReactElement;

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
 * - streamingFormatter: Optional formatter for real-time progress (called before execution)
 * - validator: Optional pre-execution validation function
 */
export interface NanocoderToolExport {
	name: string;
	tool: AISDKCoreTool; // AI SDK v6 tool with execute()
	formatter?: ToolFormatter; // For UI display (after execution)
	streamingFormatter?: StreamingFormatter; // For real-time progress (before execution)
	validator?: ToolValidator; // For pre-execution validation
	readOnly?: boolean; // Safe to parallelize (no side effects)
	approval?: ToolApprovalPolicy; // Whether the tool needs user approval (mode-aware)
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
 * - streamingFormatter: Optional formatter for real-time progress (called before execution)
 * - validator: Optional pre-execution validation function
 */
export interface ToolEntry {
	name: string;
	tool: AISDKCoreTool; // For AI SDK
	handler: ToolHandler; // For execution (extracted from tool.execute)
	formatter?: ToolFormatter; // For UI (React component, after execution)
	streamingFormatter?: StreamingFormatter; // For real-time progress (before execution)
	validator?: ToolValidator; // For validation
	readOnly?: boolean; // Safe to parallelize (no side effects)
	approval?: ToolApprovalPolicy; // Whether the tool needs user approval (mode-aware)
	/**
	 * Name of the skill that owns this tool, if any. Set by the skill
	 * registrar for tools that come from a bundle or single-file skill.
	 * Used together with `scoped` to decide whether `getAllTools()`
	 * includes the entry in the global result.
	 */
	ownerSkill?: string;
	/**
	 * When true, the tool is only visible to the subagent inside the same
	 * skill (matching `ownerSkill`). Default-false single-file skills set
	 * this off; bundle skills default it on via their
	 * `tools_visibility: scoped` manifest field.
	 */
	scoped?: boolean;
}

interface LLMMessage {
	role: 'assistant';
	content: string;
	tool_calls?: ToolCall[];
	reasoning?: string;
}

/**
 * Token usage as reported by the provider/API for a single response.
 * Fields are optional because not every provider reports usage (e.g. some
 * local models), and OpenRouter only includes detailed usage when the request
 * opts in via `usage: {include: true}`. Consumers must fall back to client-side
 * estimation whenever a field is missing.
 */
export interface ApiUsage {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
}

/**
 * API-reported usage captured after a model response, tagged with the
 * conversation length at capture time. The context indicator treats the
 * snapshot as authoritative only while the message count is unchanged; once
 * newer messages arrive it falls back to client-side estimation so the figure
 * never lags the conversation.
 */
export interface ApiUsageSnapshot extends ApiUsage {
	atMessageCount: number;
}

/** Whether a displayed context figure came from API usage or estimation. */
export type ContextSource = 'api' | 'estimate';

export interface LLMChatResponse {
	choices: Array<{
		message: LLMMessage;
	}>;
	// Whether native tools were disabled for this request (XML fallback path)
	// When true, the conversation loop should parse response text for XML tool calls
	toolsDisabled?: boolean;
	// Provider-reported token usage for this response, when available. Used to
	// show API-accurate context usage in place of client-side estimation.
	usage?: ApiUsage;
}

export interface StreamCallbacks {
	onToken?: (token: string) => void;
	onReasoningToken?: (token: string) => void;
	onToolCall?: (toolCall: ToolCall) => void;
	onFinish?: () => void;
}

/**
 * Runtime overrides passed through to the AI SDK client.
 * Combines non-interactive mode, tune settings, and model parameters.
 */
export interface ModeOverrides {
	nonInteractiveMode: boolean;
	nonInteractiveAlwaysAllow: string[];
	modelParameters?: import('@/types/config').ModelParameters;
}

export interface LLMClient {
	getCurrentModel(): string;
	setModel(model: string): void;
	getContextSize(): number;
	getAvailableModels(): Promise<string[]>;
	getProviderConfig(): AIProviderConfig;
	chat(
		messages: Message[],
		tools: Record<string, AISDKCoreTool>,
		callbacks: StreamCallbacks,
		signal?: AbortSignal,
		modeOverrides?: ModeOverrides,
	): Promise<LLMChatResponse>;
	clearContext(): Promise<void>;
	getTimeout(): number | undefined;
}

export type DevelopmentMode =
	| 'normal'
	| 'auto-accept'
	| 'yolo'
	| 'plan'
	| 'headless';

export const DEVELOPMENT_MODE_LABELS: Record<DevelopmentMode, string> = {
	normal: '▶ normal mode on',
	// Auto-accept skips confirmation for file edits but still prompts for bash
	// and destructive git, so the label calls that out to avoid surprise.
	'auto-accept': '⏵⏵ auto-accept mode on',
	yolo: '⏵⏵⏵ yolo mode on',
	plan: '⏸ plan mode on',
	headless: '⏵⏵ headless mode on',
};

export const DEVELOPMENT_MODE_LABELS_NARROW: Record<DevelopmentMode, string> = {
	normal: '▶ normal',
	'auto-accept': '⏵⏵ auto',
	yolo: '⏵⏵⏵ yolo',
	plan: '⏸ plan',
	headless: '⏵⏵ headless',
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
