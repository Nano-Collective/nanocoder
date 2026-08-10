/**
 * Type-safe protocol for postMessage communication between the extension host
 * and the Sidebar Webview UI.
 */

import type { MentionItem } from './mention-search';

// ---------------------------------------------------------
// Messages: Extension Host -> Webview
// ---------------------------------------------------------

export interface ExtensionMessageAppendMessage {
	type: 'appendMessage';
	content: string;
}

export interface ExtensionMessageAppendThought {
	type: 'appendThought';
	content: string;
}

export interface ExtensionMessageStateUpdate {
	type: 'stateUpdate';
	status?: string;
	model?: string;
}

export interface ExtensionMessageClear {
	type: 'clear';
	isLoading?: boolean;
}

export interface ExtensionMessageSessionLoaded {
	type: 'sessionLoaded';
}

export interface ExtensionMessageAcpUpdate {
	type: 'acpUpdate';
	update: any; // schema.SessionNotification or custom internal payload
}

export interface ExtensionMessageToolStarted {
	type: 'toolStarted';
	toolCall: any;
}

export interface ExtensionMessageToolUpdated {
	type: 'toolUpdated';
	update: any;
}

export interface ExtensionMessageToolCompleted {
	type: 'toolCompleted';
	toolCallId: string;
	result: any;
}

export interface ExtensionMessagePermissionRequested {
	type: 'permissionRequested';
	toolCallId: string;
	toolCall: any;
	options?: any[];
}



export interface ExtensionMessageSyncState {
	type: 'syncState';
	mode: string;
	availableModes: string[];
	model: string;
	availableModels: string[];
	provider: string;
	availableProviders: string[];
}

export interface ExtensionMessageCopyLastCodeBlock {
	type: 'copyLastCodeBlock';
}

export interface ExtensionMessageCopyResult {
	type: 'copyResult';
	ok: boolean;
	chars?: number;
	error?: string;
}

export interface ExtensionMessageUpdateSessions {
	type: 'updateSessions';
	sessions: Array<{
		sessionId: string;
		cwd: string;
		title?: string | null;
	}>;
}

export interface ExtensionMessagePathInfoResolved {
	type: 'pathInfoResolved';
	path: string;
	name: string;
	kind: 'file' | 'folder';
}

/**
 * Ranked `@` autocomplete suggestions.
 *
 * `requestId` echoes the webview's request. postMessage delivery is async, so
 * a fast typist can have several searches in flight at once and they can land
 * out of order — the webview drops any response whose id is not the newest,
 * otherwise the dropdown flickers back to results for an older query.
 */
export interface ExtensionMessageMentionCompletions {
	type: 'mentionCompletions';
	requestId: number;
	items: MentionItem[];
}

export type ExtensionToWebviewMessage =
	| ExtensionMessageAppendMessage
	| ExtensionMessageAppendThought
	| ExtensionMessageStateUpdate
	| ExtensionMessageClear
	| ExtensionMessageAcpUpdate
	| ExtensionMessageToolStarted
	| ExtensionMessageToolUpdated
	| ExtensionMessageToolCompleted
	| ExtensionMessagePermissionRequested
	| ExtensionMessageSyncState
	| ExtensionMessageUpdateSessions
	| ExtensionMessageSessionLoaded
	| ExtensionMessagePathInfoResolved
	| ExtensionMessageCopyLastCodeBlock
	| ExtensionMessageCopyResult
	| ExtensionMessageMentionCompletions;


// ---------------------------------------------------------
// Messages: Webview -> Extension Host
// ---------------------------------------------------------

export interface WebviewMessageReady {
	type: 'ready';
}

export interface WebviewMessageSubmitMessage {
	type: 'submitMessage';
	text: string;
	images?: { data: string; mimeType: string }[];
}

export interface WebviewMessageCancel {
	type: 'cancel';
}

export interface WebviewMessageApproveTool {
	type: 'approveTool';
	toolCallId: string;
}

export interface WebviewMessageDenyTool {
	type: 'denyTool';
	toolCallId: string;
}

export interface WebviewMessageResolveTool {
	type: 'resolveTool';
	toolCallId: string;
	optionId: string;
}

export interface WebviewMessageShowDiff {
	type: 'showDiff';
	toolCallId: string;
}



export interface WebviewMessageSetMode {
	type: 'setMode';
	mode: string;
}

export interface WebviewMessageSetModel {
	type: 'setModel';
	model: string;
}

export interface WebviewMessageSetProvider {
	type: 'setProvider';
	provider: string;
}

export interface WebviewMessageListSessions {
	type: 'listSessions';
}

export interface WebviewMessageResumeSession {
	type: 'resumeSession';
	sessionId: string;
}

export interface WebviewMessageDeleteSession {
	type: 'deleteSession';
	sessionId: string;
}

export interface WebviewMessageRequestPathInfo {
	type: 'requestPathInfo';
	path: string;
}

export interface WebviewMessageRequestOpenDialog {
	type: 'requestOpenDialog';
}

export interface WebviewMessageOpenPath {
	type: 'openPath';
	path: string;
	kind: 'file' | 'folder';
}

export interface WebviewMessageShowError {
	type: 'showError';
	message: string;
}

export interface WebviewMessageCopyToClipboard {
	type: 'copyToClipboard';
	text: string;
}

/**
 * Ask the host to resolve an `@` query. Searching lives on the host because
 * `vscode.workspace.findFiles` already honours `files.exclude` / `search.exclude`
 * and shipping a whole workspace file list into the webview would be megabytes
 * on a large repo.
 */
export interface WebviewMessageRequestMentionCompletions {
	type: 'requestMentionCompletions';
	query: string;
	requestId: number;
}

export type WebviewToExtensionMessage =
	| WebviewMessageReady
	| WebviewMessageSubmitMessage
	| WebviewMessageCancel
	| WebviewMessageApproveTool
	| WebviewMessageDenyTool
	| WebviewMessageResolveTool
	| WebviewMessageShowDiff
	| WebviewMessageSetMode
	| WebviewMessageSetModel
	| WebviewMessageSetProvider
	| WebviewMessageListSessions
	| WebviewMessageResumeSession
	| WebviewMessageDeleteSession
	| WebviewMessageRequestPathInfo
	| WebviewMessageRequestOpenDialog
	| WebviewMessageOpenPath
	| WebviewMessageShowError
	| WebviewMessageCopyToClipboard
	| WebviewMessageRequestMentionCompletions;
