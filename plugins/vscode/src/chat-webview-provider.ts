import * as vscode from 'vscode';
import { WebviewToExtensionMessage, ExtensionToWebviewMessage } from './webview-protocol';

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'nanocoder.chatView';

	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _outputChannel: vscode.OutputChannel
	) { }

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
						// In Phase 3, we'll route this to ACP client prompt()
						break;
					case 'cancel':
						this._outputChannel.appendLine('[Webview] User cancelled operation.');
						// In Phase 3, we'll route this to ACP client cancel()
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
