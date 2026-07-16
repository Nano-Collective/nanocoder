import * as vscode from 'vscode';
import {ClientSideConnection} from '@agentclientprotocol/sdk';
import {AcpStateManager, ACPStatus} from './acp-state';

// We expect at least the version of the CLI where ACP was introduced
const MINIMUM_CLI_VERSION = '0.4.0'; // Example baseline

export class NanocoderAcpClient {
	public connection: ClientSideConnection | null = null;
	private outputChannel: vscode.OutputChannel;
	private stateManager: AcpStateManager;
	private _sessionId?: string;
	public onSessionUpdate?: (update: any) => void;
	public onPermissionRequested?: (toolCallId: string, toolCall: any) => void;

	private pendingPermissions = new Map<string, (response: any) => void>();

	constructor(outputChannel: vscode.OutputChannel, stateManager: AcpStateManager) {
		this.outputChannel = outputChannel;
		this.stateManager = stateManager;
	}

	hasPendingPermissions(): boolean {
		return this.pendingPermissions.size > 0;
	}

	setConnection(conn: ClientSideConnection) {
		this.connection = conn;
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
			return true;
		} catch (error) {
			this.outputChannel.appendLine(`ACP Initialize failed: ${error}`);
			return false;
		}
	}

	async getOrCreateSession(cwd: string): Promise<string | undefined> {
		if (this._sessionId) return this._sessionId;
		if (!this.connection) return undefined;

		try {
			const result = await this.connection.newSession({ cwd, mcpServers: [] });
			this._sessionId = result.sessionId;
			return this._sessionId;
		} catch (error) {
			this.outputChannel.appendLine(`Failed to create session: ${error}`);
			return undefined;
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
		// A simple semver check could go here. For now, if they have an ACP-capable CLI,
		// it's likely compatible with the basic initialize(). If we need stricter checks,
		// we can parse the x.y.z format here.
		return false; 
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
