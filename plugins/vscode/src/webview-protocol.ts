/**
 * Type-safe protocol for postMessage communication between the extension host
 * and the Sidebar Webview UI.
 */

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

export interface ExtensionMessagePlanReviewRequested {
	type: 'planReviewRequested';
	artifactPath: string;
}

export interface ExtensionMessagePlanReviewError {
	type: 'planReviewError';
	message: string;
}

export interface ExtensionMessageArtifactsUpdated {
	type: 'artifactsUpdated';
	artifacts: Array<{
		kind: 'implementation_plan' | 'task' | 'walkthrough';
		path: string;
	}>;
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
	| ExtensionMessagePlanReviewRequested
	| ExtensionMessagePlanReviewError
	| ExtensionMessageArtifactsUpdated
	| ExtensionMessageCopyLastCodeBlock
	| ExtensionMessageCopyResult;


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

export interface WebviewMessageApprovePlan {
	type: 'approvePlan';
}

export interface WebviewMessageRevisePlan {
	type: 'revisePlan';
}

export interface WebviewMessageCopyToClipboard {
	type: 'copyToClipboard';
	text: string;
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
	| WebviewMessageApprovePlan
	| WebviewMessageRevisePlan
	| WebviewMessageCopyToClipboard;
