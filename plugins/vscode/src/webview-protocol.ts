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

/** Sent when a cancel or a new chat drops permission prompts still on screen. */
export interface ExtensionMessagePermissionsCancelled {
	type: 'permissionsCancelled';
	toolCallIds: string[];
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

export interface TimelineCheckpoint {
	id: string;
	seq: number;
	toolCallId: string;
	toolName: string;
	title: string;
	timestamp: string;
	filesChanged: string[];
}

export interface ExtensionMessageUpdateTimeline {
	type: 'updateTimeline';
	entries: TimelineCheckpoint[];
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
	settings: {
		providers: Array<{ name: string; baseUrl?: string; models: string[]; apiKeySet: boolean }>;
		mcpServers: Array<{ name: string; transport: string; command?: string; url?: string }>;
		alwaysAllow: string[];
		defaultMode: string | null;
		autoCompact: { enabled: boolean; threshold: number; mode: string };
		reasoningTraces: boolean;
		sessions: { autoSave: boolean };
		webSearch: { configured: boolean };
	};
}

export interface ExtensionMessageSettingsUpdated {
	type: 'settingsUpdated';
	key: string;
	success: boolean;
	error?: string;
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
	| ExtensionMessageSyncState
	| ExtensionMessageUpdateSessions
	| ExtensionMessageSessionLoaded
	| ExtensionMessageSettingsData
	| ExtensionMessageSettingsUpdated
	| ExtensionMessageToggleSettings
	| ExtensionMessagePathInfoResolved
	| ExtensionMessagePlanReviewRequested
	| ExtensionMessagePlanReviewError
	| ExtensionMessageArtifactsUpdated
	| ExtensionMessageCopyLastCodeBlock
	| ExtensionMessageCopyResult
	| ExtensionMessageRunPrompt
	| ExtensionMessageMentionCompletions
	| ExtensionMessageUpdateTimeline;


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

export interface WebviewMessageRequestTimeline {
	type: 'requestTimeline';
}

export interface WebviewMessageRevertToCheckpoint {
	type: 'revertToCheckpoint';
	checkpointId: string;
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
	| WebviewMessageRequestSettings
	| WebviewMessageUpdateSetting
	| WebviewMessageOpenConfigFile
	| WebviewMessageRestartAcp
	| WebviewMessageRenameSession
	| WebviewMessageRequestPathInfo
	| WebviewMessageRequestOpenDialog
	| WebviewMessageOpenPath
	| WebviewMessageShowError
	| WebviewMessageApprovePlan
	| WebviewMessageRevisePlan
	| WebviewMessageCopyToClipboard
	| WebviewMessageRequestMentionCompletions
	| WebviewMessageRequestTimeline
	| WebviewMessageRevertToCheckpoint;
