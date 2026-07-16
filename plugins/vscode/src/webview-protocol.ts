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
	| ExtensionMessageShowPlanReview;


// ---------------------------------------------------------
// Messages: Webview -> Extension Host
// ---------------------------------------------------------

export interface WebviewMessageReady {
	type: 'ready';
}

export interface WebviewMessageSubmitMessage {
	type: 'submitMessage';
	text: string;
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

export interface WebviewMessageShowDiff {
	type: 'showDiff';
	toolCallId: string;
}

export interface WebviewMessageProceedPlan {
	type: 'proceedPlan';
}

export interface WebviewMessageModifyPlan {
	type: 'modifyPlan';
}

export interface WebviewMessageCancelPlan {
	type: 'cancelPlan';
}

export interface ExtensionMessageShowPlanReview {
	type: 'showPlanReview';
	description?: string;
}

export type WebviewToExtensionMessage =
	| WebviewMessageReady
	| WebviewMessageSubmitMessage
	| WebviewMessageCancel
	| WebviewMessageApproveTool
	| WebviewMessageDenyTool
	| WebviewMessageShowDiff
	| WebviewMessageProceedPlan
	| WebviewMessageModifyPlan
	| WebviewMessageCancelPlan;
