import * as vscode from 'vscode';
import {ClientSideConnection} from '@agentclientprotocol/sdk';
import {AcpStateManager, ACPStatus} from './acp-state';

// We expect at least the version of the CLI where ACP was introduced
const MINIMUM_CLI_VERSION = '0.4.0';

export class NanocoderAcpClient {
	public connection: ClientSideConnection | null = null;
	private outputChannel: vscode.OutputChannel;
	private stateManager: AcpStateManager;
	private _sessionId?: string;
	public onSessionUpdate?: (update: any) => void;
	public onPermissionRequested?: (toolCallId: string, toolCall: any) => void;
	public onStateSync?: (state: any) => void;
	public onConnectionReady?: () => void;

	public currentMode?: string;
	public availableModes: string[] = [];
	public currentModel?: string;
	public availableModels: string[] = [];

	private pendingPermissions = new Map<string, (response: any) => void>();

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

	async handlePermissionRequest(params: any): Promise<any> {
		const toolCall = params.toolCall;
		const toolCallId = toolCall.toolCallId;
		
		return new Promise<any>((resolve) => {
			this.pendingPermissions.set(toolCallId, resolve);
			if (this.onPermissionRequested) {
				this.onPermissionRequested(toolCallId, toolCall);
			}
		});
	}

	resolvePermission(toolCallId: string, allow: boolean) {
		const resolver = this.pendingPermissions.get(toolCallId);
		if (resolver) {
			resolver({
				outcome: {
					outcome: 'selected',
					optionId: allow ? 'allow' : 'deny',
				}
			});
			this.pendingPermissions.delete(toolCallId);
		}
	}

	async initializeHandshake(): Promise<boolean> {
		if (!this.connection) return false;

		try {
			// Perform ACP initialize handshake
			const initResult = await this.connection.initialize({
				clientInfo: {
					name: 'Nanocoder VS Code Extension',
					version: '0.1.0',
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
			const initialModel = config.get<string>('model') || 'google/gemini-3.5-flash';

			const result = await this.connection.newSession({ cwd, mcpServers: [] });
			this._sessionId = result.sessionId;
			
			// Parse modes and configOptions
			if (result.modes) {
				this.currentMode = result.modes.currentModeId;
				this.availableModes = result.modes.availableModes.map((m: any) => m.id);
			}
			
			if (result.configOptions) {
				const modelOpt = result.configOptions.find((o: any) => o.id === 'model') as any;
				if (modelOpt) {
					this.currentModel = modelOpt.currentValue;
					
					this.availableModels = [];
					for (const opt of modelOpt.options || []) {
						if (opt.options && Array.isArray(opt.options)) {
							// It's a group
							this.availableModels.push(...opt.options.map((o: any) => o.value || o));
						} else {
							// It's a flat option
							this.availableModels.push(opt.value || opt);
						}
					}
				}
			}

			// Force initial preferences if they differ
			if (this.currentMode && this.currentMode !== initialMode && this.availableModes.includes(initialMode)) {
				await this.setSessionMode(initialMode, false);
			}
			if (this.currentModel && this.currentModel !== initialModel && this.availableModels.includes(initialModel)) {
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
		if (this.onStateSync && (this.currentMode || this.currentModel)) {
			this.onStateSync({
				mode: this.currentMode,
				availableModes: this.availableModes,
				model: this.currentModel,
				availableModels: this.availableModels
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

	async setSessionModel(modelId: string, persist = true): Promise<void> {
		if (!this.connection || !this._sessionId) return;
		try {
			const result = await this.connection.setSessionConfigOption({
				sessionId: this._sessionId,
				configId: 'model',
				value: modelId
			});
			this.currentModel = modelId;
			this.notifyStateSync();

			if (persist) {
				const config = vscode.workspace.getConfiguration('nanocoder');
				await config.update('model', modelId, vscode.ConfigurationTarget.Global);
			}
		} catch (error) {
			this.outputChannel.appendLine(`Failed to set model: ${error}`);
		}
	}

	async prompt(text: string): Promise<void> {
		if (!this.connection || !this._sessionId) return;
		try {
			await this.connection.prompt({
				sessionId: this._sessionId,
				prompt: [{ type: 'text', text }]
			});
		} catch (error) {
			this.outputChannel.appendLine(`Prompt failed: ${error}`);
			vscode.window.showErrorMessage(`Nanocoder prompt failed: ${error}`);
		}
	}

	async cancel(): Promise<void> {
		if (!this.connection || !this._sessionId) return;
		try {
			await this.connection.cancel({
				sessionId: this._sessionId
			});
		} catch (error) {
			this.outputChannel.appendLine(`Cancel failed: ${error}`);
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

	async listSessions(): Promise<Array<{sessionId: string; cwd: string; title?: string | null}>> {
		if (!this.connection) return [];
		try {
			const result = await this.connection.listSessions({});
			return result.sessions.map((s: any) => ({
				sessionId: s.sessionId,
				cwd: s.cwd,
				title: s.title,
			}));
		} catch (error) {
			this.outputChannel.appendLine(`listSessions failed: ${error}`);
			return [];
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
			await this.connection.resumeSession({sessionId, cwd: ''});
		} catch (error) {
			this.outputChannel.appendLine(`resumeSession failed: ${error}`);
			vscode.window.showErrorMessage(`Failed to resume session: ${error}`);
		}
	}

	async proceedPlan(): Promise<void> {
		this.outputChannel.appendLine('ACP: proceedPlan requested. (TODO: Forward plan approval to server)');
		// TODO: Implement the correct ACP interaction for Proceed in Plan Mode.
	}

	async modifyPlan(): Promise<void> {
		this.outputChannel.appendLine('ACP: modifyPlan requested. (TODO: Forward refinement to server)');
	}

	async cancelPlan(): Promise<void> {
		this.outputChannel.appendLine('ACP: cancelPlan requested.');
		this.cancel();
	}
}
