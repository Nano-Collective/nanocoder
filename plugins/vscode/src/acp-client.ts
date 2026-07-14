import * as vscode from 'vscode';
import {ClientSideConnection} from '@agentclientprotocol/sdk';
import {AcpStateManager, ACPStatus} from './acp-state';

// We expect at least the version of the CLI where ACP was introduced
const MINIMUM_CLI_VERSION = '0.4.0'; // Example baseline

export class NanocoderAcpClient {
	public connection: ClientSideConnection | null = null;
	private outputChannel: vscode.OutputChannel;
	private stateManager: AcpStateManager;

	constructor(outputChannel: vscode.OutputChannel, stateManager: AcpStateManager) {
		this.outputChannel = outputChannel;
		this.stateManager = stateManager;
	}

	setConnection(conn: ClientSideConnection) {
		this.connection = conn;
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

	private isVersionIncompatible(serverVersion: string): boolean {
		// A simple semver check could go here. For now, if they have an ACP-capable CLI,
		// it's likely compatible with the basic initialize(). If we need stricter checks,
		// we can parse the x.y.z format here.
		return false; 
	}
}
