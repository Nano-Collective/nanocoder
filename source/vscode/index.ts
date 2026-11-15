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

export type {DiagnosticInfo} from './protocol';
export {
	closeAllDiffsInVSCode,
	closeDiffInVSCode,
	getVSCodeServer,
	isVSCodeConnected,
	sendFileChangeToVSCode,
	VSCodeServer,
} from './vscode-server';
