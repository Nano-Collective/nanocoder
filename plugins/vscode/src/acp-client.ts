import * as vscode from 'vscode';
import {ClientSideConnection} from '@agentclientprotocol/sdk';
import {AcpStateManager, ACPStatus} from './acp-state';

// We expect at least the version of the CLI where ACP was introduced
const MINIMUM_CLI_VERSION = '0.4.0';

export interface StateSyncPayload {
	mode?: string;
	availableModes: string[];
	model?: string;
	availableModels: string[];
	provider?: string;
	availableProviders: string[];
}

export class NanocoderAcpClient {
	public connection: ClientSideConnection | null = null;
	private outputChannel: vscode.OutputChannel;
	private stateManager: AcpStateManager;
	private _sessionId?: string;
	public onSessionUpdate?: (update: unknown) => void;
	public onPermissionRequested?: (toolCallId: string, toolCall: unknown, options?: any[]) => void;
	/** Fires with the tool call ids whose approval cards should be dismissed. */
	public onPermissionsCancelled?: (toolCallIds: string[]) => void;
	public onStateSync?: (state: StateSyncPayload) => void;
	public onConnectionReady?: () => void;
	public onTimelineUpdated?: (entries: Array<{
		id: string;
		seq: number;
		toolCallId: string;
		toolName: string;
		title: string;
		timestamp: string;
		filesChanged: string[];
	}>) => void;

	public currentMode?: string;
	public availableModes: string[] = [];
	public currentModel?: string;
	public availableModels: string[] = [];
	public currentProvider?: string;
	public availableProviders: string[] = [];

	private pendingPermissions = new Map<string, (response: unknown) => void>();
	/**
	 * Set while a cancel is in flight for the current turn. A cancelled prompt()
	 * rejects (the agent throws to abort its stream), but that's the user's own
	 * request succeeding, not a failure, so we swallow the toast for it here.
	 * This is a client-side backstop: older/unrelinked CLI builds may not yet
	 * resolve cancellation cleanly on their end, so we can't rely solely on the
	 * agent reporting it as a non-error.
	 */
	private cancelRequested = false;

	constructor(outputChannel: vscode.OutputChannel, stateManager: AcpStateManager) {
		this.outputChannel = outputChannel;
		this.stateManager = stateManager;

		// Settings Bridge: Listen for configuration changes
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('nanocoder.mode')) {
				const newMode = vscode.workspace.getConfiguration('nanocoder').get<string>('mode');
				if (newMode && newMode !== this.currentMode) {
					this.setSessionMode(newMode, false);
				}
			}
			if (e.affectsConfiguration('nanocoder.model')) {
				const newModel = vscode.workspace.getConfiguration('nanocoder').get<string>('model');
				if (newModel && newModel !== this.currentModel) {
					this.setSessionModel(newModel, false);
				}
			}
		});

	}

	notifyActiveEditorChanged(editor: vscode.TextEditor | undefined) {
		if (editor && this.connection && this._sessionId) {
			const uri = editor.document.uri.toString();
			const cursorPos = editor.selection.active;
			const visibleRange = editor.visibleRanges[0];
			const range = visibleRange ?? new vscode.Range(cursorPos, cursorPos);
			this.connection.unstable_didFocusDocument({
				sessionId: this._sessionId,
				uri,
				version: editor.document.version,
				position: { line: cursorPos.line, character: cursorPos.character },
				visibleRange: {
					start: { line: range.start.line, character: range.start.character },
					end: { line: range.end.line, character: range.end.character },
				},
			}).catch(() => { /* best-effort */ });
		}
	}

	hasPendingPermissions(): boolean {
		return this.pendingPermissions.size > 0;
	}

	setConnection(connection: ClientSideConnection): void {
		this.connection = connection;
		this._sessionId = undefined; // Clear any stale session to force re-creation
	}

	async handlePermissionRequest(params: any): Promise<unknown> {
		const toolCall = params.toolCall;
		const toolCallId = toolCall.toolCallId;
		
		return new Promise<unknown>((resolve) => {
			this.pendingPermissions.set(toolCallId, resolve);
			if (this.onPermissionRequested) {
				this.onPermissionRequested(toolCallId, toolCall, params.options);
			}
		});
	}

	/**
	 * Answer every outstanding permission request with `cancelled` and drop it.
	 * A leftover resolver keeps hasPendingPermissions() true, which blocks every
	 * later message until the window reloads.
	 */
	private _clearPendingPermissions(): void {
		if (this.pendingPermissions.size === 0) return;

		const toolCallIds = [...this.pendingPermissions.keys()];
		for (const resolve of this.pendingPermissions.values()) {
			resolve({outcome: {outcome: 'cancelled'}});
		}
		this.pendingPermissions.clear();

		if (this.onPermissionsCancelled) {
			this.onPermissionsCancelled(toolCallIds);
		}
	}

	resolvePermission(toolCallId: string, allowOrOptionId: boolean | string) {
		const resolver = this.pendingPermissions.get(toolCallId);
		if (resolver) {
			resolver({
				outcome: {
					outcome: 'selected',
					optionId: typeof allowOrOptionId === 'string' ? allowOrOptionId : (allowOrOptionId ? 'allow' : 'deny'),
				}
			});
			this.pendingPermissions.delete(toolCallId);
		}
	}

	async initializeHandshake(): Promise<boolean> {
		if (!this.connection) return false;

		try {
			const ext = vscode.extensions.getExtension('nanocollective.nanocoder-vscode');
			const version = ext?.packageJSON?.version || '0.3.0';

			// Perform ACP initialize handshake
			const initResult = await this.connection.initialize({
				clientInfo: {
					name: 'Nanocoder VS Code Extension',
					version: version,
				},
				protocolVersion: 1,
				clientCapabilities: {},
			});

			this.outputChannel.appendLine(`ACP Initialized. Agent version: ${initResult.agentInfo?.version || 'unknown'}`);

			// Version validation
			if (this.isVersionIncompatible(initResult.agentInfo?.version || '0.0.0')) {
				this.stateManager.setStatus(ACPStatus.VersionMismatch);
				vscode.window.showWarningMessage(
					`Nanocoder CLI version ${initResult.agentInfo?.version} is incompatible with this extension. Please update to >= ${MINIMUM_CLI_VERSION}.`
				);
				return false;
			}

			// Complete handshake
			this.stateManager.setStatus(ACPStatus.Connected);
			if (this.onConnectionReady) {
				this.onConnectionReady();
			}
			return true;
		} catch (error) {
			this.outputChannel.appendLine(`ACP Initialize failed: ${error}`);
			return false;
		}
	}

	async getOrCreateSession(cwd: string): Promise<string | undefined> {
		if (this._sessionId) {
			this.notifyStateSync();
			return this._sessionId;
		}
		if (!this.connection) return undefined;

		try {
			// Get VS Code settings for initial preferences
			const config = vscode.workspace.getConfiguration('nanocoder');
			const initialMode = config.get<string>('mode') || 'auto-accept';
			const initialModel = config.get<string>('model');

			const result = await this.connection.newSession({ cwd, mcpServers: [] });
			this._sessionId = result.sessionId;
			
			// Parse modes and configOptions
			if (result.modes) {
				this.currentMode = result.modes.currentModeId;
				this.availableModes = result.modes.availableModes.map((m: any) => m.id);
			}
			
			if (result.configOptions) {
				this._parseConfigOptions(result.configOptions);
			}

			// Force initial preferences if they differ
			if (this.currentMode && this.currentMode !== initialMode && this.availableModes.includes(initialMode)) {
				await this.setSessionMode(initialMode, false);
			}
			if (initialModel && this.currentModel && this.currentModel !== initialModel && this.availableModels.includes(initialModel)) {
				await this.setSessionModel(initialModel, false);
			}

			this.notifyStateSync();

			return this._sessionId;
		} catch (error) {
			this.outputChannel.appendLine(`Failed to create session: ${error}`);
			return undefined;
		}
	}

	notifyStateSync() {
		if (this.onStateSync && (this.currentMode || this.currentModel || this.currentProvider)) {
			this.onStateSync({
				mode: this.currentMode,
				availableModes: this.availableModes,
				model: this.currentModel,
				availableModels: this.availableModels,
				provider: this.currentProvider,
				availableProviders: this.availableProviders
			});
		}
	}

	async setSessionMode(modeId: string, persist = true): Promise<void> {
		if (!this.connection || !this._sessionId) return;
		try {
			await this.connection.setSessionMode({
				sessionId: this._sessionId,
				modeId
			});
			this.currentMode = modeId;
			this.notifyStateSync();

			if (persist) {
				const config = vscode.workspace.getConfiguration('nanocoder');
				// User setting scope
				await config.update('mode', modeId, vscode.ConfigurationTarget.Global);
			}
		} catch (error) {
			this.outputChannel.appendLine(`Failed to set mode: ${error}`);
		}
	}

	async setSessionProvider(providerId: string, persist = true): Promise<void> {
		if (!this.connection || !this._sessionId) return;
		try {
			const result = await this.connection.setSessionConfigOption({
				sessionId: this._sessionId,
				configId: 'provider',
				value: providerId
			});
			// Parse the response — server returns updated model list for the new provider
			if (result?.configOptions) {
				this._parseConfigOptions(result.configOptions);
			} else {
				// Fallback: at minimum update the current provider
				this.currentProvider = providerId;
			}
			this.notifyStateSync();
		} catch (error) {
			this.outputChannel.appendLine(`Failed to set provider: ${error}`);
		}
	}

	async setSessionModel(modelId: string, persist = true): Promise<void> {
		if (!this.connection || !this._sessionId) return;
		try {
			const result = await this.connection.setSessionConfigOption({
				sessionId: this._sessionId,
				configId: 'model',
				value: modelId
			});
			// Parse the response to get the authoritative current model back from server
			if (result?.configOptions) {
				this._parseConfigOptions(result.configOptions);
			} else {
				this.currentModel = modelId;
			}
			this.notifyStateSync();

			if (persist) {
				const config = vscode.workspace.getConfiguration('nanocoder');
				await config.update('model', modelId, vscode.ConfigurationTarget.Global);
			}
		} catch (error) {
			this.outputChannel.appendLine(`Failed to set model: ${error}`);
		}
	}

	/** Start a new conversation by clearing the cached session ID. */
	newChat(): void {
		// Abandoning the conversation abandons its approval prompts too.
		this._clearPendingPermissions();
		this._sessionId = undefined;
	}
	/**
	 * Send a prompt and return the agent's PromptResponse (carries the
	 * experimental per-turn `usage` field plus `_meta` extensions such as
	 * the estimated cost). Returns undefined on failure.
	 */
	async prompt(text: string, images?: { data: string, mimeType: string }[]): Promise<import('@agentclientprotocol/sdk').PromptResponse | undefined> {
		if (!this.connection || !this._sessionId) return undefined;
		this.cancelRequested = false;
		try {
			const promptData: import('@agentclientprotocol/sdk').ContentBlock[] = [{ type: 'text', text }];
			if (images && images.length > 0) {
				for (const img of images) {
					promptData.push({ type: 'image', data: img.data, mimeType: img.mimeType });
				}
			}
			return await this.connection.prompt({
				sessionId: this._sessionId,
				prompt: promptData
			});
		} catch (error) {
			this.outputChannel.appendLine(`Prompt failed: ${error}`);
			if (!this.cancelRequested) {
				vscode.window.showErrorMessage(`Nanocoder prompt failed: ${error}`);
			}
			return undefined;
		} finally {
			this.cancelRequested = false;
		}
	}

	async cancel(): Promise<void> {
		if (!this.connection || !this._sessionId) return;
		this.cancelRequested = true;
		// Before the notification, so the map is emptied even if cancel() throws.
		this._clearPendingPermissions();
		try {
			await this.connection.cancel({
				sessionId: this._sessionId
			});
		} catch (error) {
			this.outputChannel.appendLine(`Cancel failed: ${error}`);
		}
	}

	/** Parse configOptions array from any ACP response and update local state. */
	private _parseConfigOptions(configOptions: any[]): void {
		const modelOpt = configOptions.find((o: any) => o.id === 'model') as any;
		if (modelOpt) {
			this.currentModel = modelOpt.currentValue;
			this.availableModels = [];
			for (const opt of modelOpt.options || []) {
				if (opt.options && Array.isArray(opt.options)) {
					// Grouped options (e.g. provider > models)
					this.availableModels.push(...opt.options.map((o: any) => o.value || o));
				} else {
					// Flat option
					this.availableModels.push(opt.value || opt);
				}
			}
		}
		const providerOpt = configOptions.find((o: any) => o.id === 'provider') as any;
		if (providerOpt) {
			this.currentProvider = providerOpt.currentValue;
			this.availableProviders = providerOpt.options
				? providerOpt.options.map((o: any) => o.value || o)
				: [];
		}
	}

	private isVersionIncompatible(serverVersion: string): boolean {
		const parseVersion = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0);
		const [sMajor, sMinor, sPatch] = parseVersion(serverVersion);
		const [rMajor, rMinor, rPatch] = parseVersion(MINIMUM_CLI_VERSION);

		if (sMajor < rMajor) return true;
		if (sMajor === rMajor && sMinor < rMinor) return true;
		if (sMajor === rMajor && sMinor === rMinor && sPatch < rPatch) return true;
		
		return false; 
	}

	async listSessions(): Promise<Array<{sessionId: string; cwd: string; title?: string | null; updatedAt?: string | null}>> {
		if (!this.connection) return [];
		try {
			const result = await this.connection.listSessions({});
			return result.sessions.map((s: any) => ({
				sessionId: s.sessionId,
				cwd: s.cwd,
				title: s.title,
				updatedAt: s.updatedAt,
			}));
		} catch (error) {
			this.outputChannel.appendLine(`listSessions failed: ${error}`);
			return [];
		}
	}

	async renameSession(sessionId: string, title: string): Promise<void> {
		if (!this.connection) return;
		try {
			await this.connection.extMethod('renameSession', {sessionId, title});
		} catch (error) {
			this.outputChannel.appendLine(`renameSession failed: ${error}`);
			vscode.window.showErrorMessage(`Failed to rename session: ${error}`);
		}
	}

	async deleteSession(sessionId: string): Promise<void> {
		if (!this.connection) return;
		try {
			await this.connection.deleteSession({sessionId});
		} catch (error) {
			this.outputChannel.appendLine(`deleteSession failed: ${error}`);
			vscode.window.showErrorMessage(`Failed to delete session: ${error}`);
		}
	}

	async resumeSession(sessionId: string): Promise<void> {
		if (!this.connection) return;
		try {
			this._sessionId = sessionId;
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			const cwd = workspaceFolder?.uri.fsPath || process.cwd();
			await this.connection.resumeSession({sessionId, cwd});
		} catch (error) {
			this.outputChannel.appendLine(`resumeSession failed: ${error}`);
			vscode.window.showErrorMessage(`Failed to resume session: ${error}`);
		}
	}

	async listTimeline(): Promise<Array<{
		id: string;
		seq: number;
		toolCallId: string;
		toolName: string;
		title: string;
		timestamp: string;
		filesChanged: string[];
	}>> {
		if (!this.connection || !this._sessionId) return [];
		try {
			const result = await this.connection.extMethod('timeline/list', {
				sessionId: this._sessionId,
			});
			const entries = (result as {entries?: unknown}).entries;
			return Array.isArray(entries) ? entries : [];
		} catch (error) {
			this.outputChannel.appendLine(`listTimeline failed: ${error}`);
			return [];
		}
	}

	async revertTimeline(checkpointId: string): Promise<void> {
		if (!this.connection || !this._sessionId) return;
		try {
			await this.connection.extMethod('timeline/revert', {
				sessionId: this._sessionId,
				checkpointId,
			});
		} catch (error) {
			this.outputChannel.appendLine(`revertTimeline failed: ${error}`);
			vscode.window.showErrorMessage(`Failed to revert timeline: ${error}`);
			throw error;
		}
	}

}
