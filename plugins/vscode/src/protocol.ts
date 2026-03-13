/**
 * Protocol types for communication between VS Code extension and Nanocoder CLI
 */

export const PROTOCOL_VERSION = '1.0.0';
export const DEFAULT_PORT = 51820;

// Message types from CLI to Extension
export type ServerMessage =
	| FileChangeMessage
	| ToolCallMessage
	| AssistantMessage
	| StatusMessage
	| ConnectionAckMessage
	| DiagnosticsRequestMessage
	| CloseDiffMessage
	| OpenFileMessage;

// Message types from Extension to CLI
export type ClientMessage =
	| SendPromptMessage
	| ApplyChangeMessage
	| RejectChangeMessage
	| GetStatusMessage
	| ContextMessage
	| DiagnosticsResponseMessage;

// File change notification (when nanocoder wants to modify a file)
export interface FileChangeMessage {
	type: 'file_change';
	id: string;
	filePath: string;
	originalContent: string;
	newContent: string;
	toolName: string;
	toolArgs: Record<string, unknown>;
}

// Tool call notification (for showing pending tools)
export interface ToolCallMessage {
	type: 'tool_call';
	id: string;
	toolName: string;
	toolArgs: Record<string, unknown>;
	status: 'pending' | 'executing' | 'completed' | 'rejected';
	result?: string;
}

// Assistant response message
export interface AssistantMessage {
	type: 'assistant_message';
	content: string;
	isStreaming: boolean;
}

// Status update from CLI
export interface StatusMessage {
	type: 'status';
	connected: boolean;
	model?: string;
	provider?: string;
	workingDirectory?: string;
}

// Connection acknowledgment
export interface ConnectionAckMessage {
	type: 'connection_ack';
	protocolVersion: string;
	cliVersion: string;
}

// Request diagnostics from VS Code's LSP
export interface DiagnosticsRequestMessage {
	type: 'diagnostics_request';
	filePath?: string; // Optional: specific file, or all files if omitted
}

// Close diff preview (when tool confirmed/rejected in CLI)
export interface CloseDiffMessage {
	type: 'close_diff';
	id: string;
}

// Open a file in VS Code editor
export interface OpenFileMessage {
	type: 'open_file';
	filePath: string;
}

// User prompt from extension
export interface SendPromptMessage {
	type: 'send_prompt';
	prompt: string;
	context?: {
		filePath?: string;
		selection?: string;
		fileName?: string;
		startLine?: number;
		endLine?: number;
		cursorPosition?: {line: number; character: number};
	};
}

// User approves a file change
export interface ApplyChangeMessage {
	type: 'apply_change';
	id: string;
}

// User rejects a file change
export interface RejectChangeMessage {
	type: 'reject_change';
	id: string;
}

// Request current status
export interface GetStatusMessage {
	type: 'get_status';
}

// Send workspace context to CLI
export interface ContextMessage {
	type: 'context';
	workspaceFolder?: string;
	openFiles?: string[];
	activeFile?: string;
	diagnostics?: DiagnosticInfo[];
}

// Diagnostics response from VS Code
export interface DiagnosticsResponseMessage {
	type: 'diagnostics_response';
	diagnostics: DiagnosticInfo[];
}

export interface DiagnosticInfo {
	filePath: string;
	line: number;
	character: number;
	message: string;
	severity: 'error' | 'warning' | 'info' | 'hint';
	source?: string;
}

// Pending change for UI display
export interface PendingChange {
	id: string;
	filePath: string;
	originalContent: string;
	newContent: string;
	toolName: string;
	timestamp: number;
}
