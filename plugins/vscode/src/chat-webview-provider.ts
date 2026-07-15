import * as vscode from 'vscode';
import { WebviewToExtensionMessage, ExtensionToWebviewMessage } from './webview-protocol';

import { NanocoderAcpClient } from './acp-client';

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'nanocoder.chatView';

	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _outputChannel: vscode.OutputChannel,
		private readonly _acpClient: NanocoderAcpClient
	) { 
		// Listen for session updates from ACP
		this._acpClient.onSessionUpdate = (update: any) => {
			this.postMessage({
				type: 'acpUpdate',
				update
			} as any);
		};
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				this._extensionUri
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(
			(message: WebviewToExtensionMessage) => {
				switch (message.type) {
					case 'ready':
						this._outputChannel.appendLine('[Webview] Chat shell is ready.');
						break;
					case 'submitMessage':
						this._outputChannel.appendLine(`[Webview] User submitted: ${message.text}`);
						this._handlePrompt(message.text);
						break;
					case 'cancel':
						this._outputChannel.appendLine('[Webview] User cancelled operation.');
						this._acpClient.cancel();
						break;
				}
			}
		);
	}

	public postMessage(message: ExtensionToWebviewMessage) {
		if (this._view) {
			this._view.webview.postMessage(message);
		}
	}

	private async _handlePrompt(text: string) {
		try {
			// Make sure we have a session
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			const cwd = workspaceFolder?.uri.fsPath || process.cwd();
			
			const sessionId = await this._acpClient.getOrCreateSession(cwd);
			if (!sessionId) {
				vscode.window.showErrorMessage('Nanocoder: Failed to create ACP session.');
				return;
			}
			
			// Let the webview know we started thinking
			this.postMessage({
				type: 'acpUpdate',
				update: {
					type: 'agent_thought_chunk',
					content: '' // Webview can use this as a trigger to show a loading state if desired
				}
			} as any);

			await this._acpClient.prompt(text);
		} catch (error) {
			this._outputChannel.appendLine(`Prompt execution error: ${error}`);
			vscode.window.showErrorMessage(`Nanocoder Prompt error: ${error}`);
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const fs = require('fs');
		const path = require('path');
		
		const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'chat-panel.html');
		let html = fs.readFileSync(htmlPath, 'utf8');

		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat-panel.js'));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat-panel.css'));
		const nonce = getNonce();

		html = html.replace(/\{\{cspSource\}\}/g, webview.cspSource);
		html = html.replace(/\{\{nonce\}\}/g, nonce);
		html = html.replace(/\{\{styleUri\}\}/g, styleUri.toString());
		html = html.replace(/\{\{scriptUri\}\}/g, scriptUri.toString());

		return html;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
