/**
 * VS Code integration module
 *
 * Provides WebSocket-based communication between the nanocoder CLI
 * and the VS Code extension for:
 * - Live diff previews
 * - File change approvals
 * - Chat integration
 * - Diagnostics sharing
 */

export {
	getExtensionStatus,
	getVsixPath,
	installExtension,
	isExtensionInstalled,
	isVSCodeCliAvailable,
	SUPPORTED_CLIS,
	type VSCodeStatus,
} from './extension-installer';

export {
	type ApplyChangeMessage,
	type AssistantMessage,
	type ClientMessage,
	type ConnectionAckMessage,
	type ContextMessage,
	DEFAULT_PORT,
	type DiagnosticInfo,
	type DiagnosticsRequestMessage,
	type DiagnosticsResponseMessage,
	type FileChangeMessage,
	type GetStatusMessage,
	type PendingChange,
	PROTOCOL_VERSION,
	type RejectChangeMessage,
	type SendPromptMessage,
	type ServerMessage,
	type StatusMessage,
	type ToolCallMessage,
} from './protocol';
export {
	closeAllDiffsInVSCode,
	closeDiffInVSCode,
	getVSCodeServer,
	getVSCodeServerSync,
	isVSCodeConnected,
	type MessageHandler,
	type PromptHandler,
	sendFileChangeToVSCode,
	VSCodeServer,
	type VSCodeServerCallbacks,
} from './vscode-server';
