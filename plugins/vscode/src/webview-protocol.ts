/**
 * Type-safe protocol for postMessage communication between the extension host
 * and the Sidebar Webview UI.
 */
import type {SettingsData} from './settings-manager';

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

/** Sent when a cancel or a new chat drops permission prompts still on screen. */
export interface ExtensionMessagePermissionsCancelled {
	type: 'permissionsCancelled';
	toolCallIds: string[];
}



export interface ExtensionMessageSyncState {
	type: 'syncState';
	mode?: string;
	availableModes: string[];
	model?: string;
	availableModels: string[];
	provider?: string;
	availableProviders: string[];
}

/** ACP child-process / handshake status so the composer is not stuck on "Loading...". */
export interface ExtensionMessageConnectionStatus {
	type: 'connectionStatus';
	status: 'connecting' | 'connected' | 'error';
	message?: string;
}

export interface ExtensionMessageCopyLastCodeBlock {
	type: 'copyLastCodeBlock';
}

/** Prompt built by an editor code lens; the composer submits it verbatim. */
export interface ExtensionMessageRunPrompt {
	type: 'runPrompt';
	text: string;
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
		updatedAt?: string | null;
	}>;
}

export interface ExtensionMessageSettingsData {
	type: 'settingsData';
	settings: SettingsData & {
		showTokenUsage: boolean;
		providerTemplates: Record<
			string,
			{
				name: string;
				sdk: string;
				url: string;
				requiresKey: boolean;
				models: string[];
			}
		>;
	};
}

export interface ExtensionMessageSettingsUpdated {
	type: 'settingsUpdated';
	key: string;
	success: boolean;
	error?: string;
}

export interface ExtensionMessageProviderResult {
	type: 'addProviderResult';
	success: boolean;
	error?: string;
}

export interface ExtensionMessageTokenUsageVisibility {
	type: 'tokenUsageVisibility';
	showTokenUsage: boolean;
}

export interface ExtensionMessageToggleSettings {
	type: 'toggleSettings';
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

/** One `@` autocomplete suggestion. */
export interface MentionItem {
	/** Absolute path — what the composer stores in `attachedPaths`. */
	path: string;
	/** Basename: the chip label and the dropdown's primary line. */
	name: string;
	/** Workspace-relative, forward slashes — the dropdown's secondary line. */
	relPath: string;
	kind: 'file' | 'folder';
	/** Currently open in an editor tab, which both ranks it up and labels it. */
	isEditor: boolean;
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

/** A submitted prompt is waiting behind the in-flight turn. */
export interface ExtensionMessagePromptQueued {
	type: 'promptQueued';
	id: string;
}

/** The host has started (or dequeued) this prompt as the active turn. */
export interface ExtensionMessagePromptStarted {
	type: 'promptStarted';
	id: string;
}

/** Waiting prompts were discarded (Stop / Escape, new chat, /clear, resume). */
export interface ExtensionMessagePromptQueueCleared {
	type: 'promptQueueCleared';
	ids: string[];
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
	| ExtensionMessagePermissionsCancelled
	| ExtensionMessageProviderResult
	| ExtensionMessageSyncState
	| ExtensionMessageConnectionStatus
	| ExtensionMessageUpdateSessions
	| ExtensionMessageSessionLoaded
	| ExtensionMessageSettingsData
	| ExtensionMessageSettingsUpdated
	| ExtensionMessageTokenUsageVisibility
	| ExtensionMessageToggleSettings
	| ExtensionMessagePathInfoResolved
	| ExtensionMessagePlanReviewRequested
	| ExtensionMessagePlanReviewError
	| ExtensionMessageArtifactsUpdated
	| ExtensionMessageCopyLastCodeBlock
	| ExtensionMessageCopyResult
	| ExtensionMessageRunPrompt
	| ExtensionMessageMentionCompletions
	| ExtensionMessagePromptQueued
	| ExtensionMessagePromptStarted
	| ExtensionMessagePromptQueueCleared;

// ---------------------------------------------------------
// Messages: Webview -> Extension Host
// ---------------------------------------------------------

export interface WebviewMessageReady {
	type: 'ready';
}

export interface WebviewMessageSubmitMessage {
	type: 'submitMessage';
	/** Client-generated id so the host can queue, start, or discard this prompt. */
	id: string;
	text: string;
	images?: { data: string; mimeType: string }[];
}

export interface WebviewMessageRetryMessage {
	type: 'retryMessage';
	text: string;
	images?: { data: string; mimeType: string }[];
}

export interface WebviewMessageCancel {
	type: 'cancel';
}

/** Remove one waiting prompt before it starts. Does not cancel the in-flight turn. */
export interface WebviewMessageCancelQueuedMessage {
	type: 'cancelQueuedMessage';
	id: string;
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

export interface WebviewMessageRequestSettings {
	type: 'requestSettings';
}

export interface WebviewMessageUpdateSetting {
	type: 'updateSetting';
	key: string;
	value: unknown;
}

export interface WebviewMessageOpenConfigFile {
	type: 'openConfigFile';
	file: 'agents.config.json' | 'nanocoder-preferences.json' | '.mcp.json';
}

export interface WebviewMessageRestartAcp {
	type: 'restartAcp';
}

export interface WebviewMessageRenameSession {
	type: 'renameSession';
	sessionId: string;
	title: string;
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

export interface WebviewMessageAddProvider {
	type: 'addProvider';
	provider: {
		name: string;
		sdkProvider: string;
		baseUrl?: string;
		apiKey?: string;
		models?: string[];
	};
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

/**
 * Ask the host to resolve an `@` query. Searching lives on the host because
 * only the host can reach `vscode.workspace.findFiles` and the user's
 * `files.exclude` / `search.exclude` settings, and because shipping a whole
 * workspace file list into the webview would be megabytes on a large repo.
 * Note `findFiles` does *not* honour those settings on its own once an explicit
 * exclude is passed - see `_mentionExcludeGlob` in `chat-webview-provider.ts`.
 */
export interface WebviewMessageRequestMentionCompletions {
	type: 'requestMentionCompletions';
	query: string;
	requestId: number;
}

export type WebviewToExtensionMessage =
	| WebviewMessageReady
	| WebviewMessageSubmitMessage
	| WebviewMessageRetryMessage
	| WebviewMessageCancel
	| WebviewMessageCancelQueuedMessage
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
	| WebviewMessageRequestSettings
	| WebviewMessageUpdateSetting
	| WebviewMessageOpenConfigFile
	| WebviewMessageRestartAcp
	| WebviewMessageRenameSession
	| WebviewMessageRequestPathInfo
	| WebviewMessageRequestOpenDialog
	| WebviewMessageOpenPath
	| WebviewMessageShowError
	| WebviewMessageAddProvider
	| WebviewMessageApprovePlan
	| WebviewMessageRevisePlan
	| WebviewMessageCopyToClipboard
	| WebviewMessageRequestMentionCompletions;
