import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { WebviewToExtensionMessage, ExtensionToWebviewMessage } from './webview-protocol';

import { NanocoderAcpClient } from './acp-client';
import { DiffManager } from './diff-manager';

/**
 * How long an editor-driven prompt waits for the webview shell and the ACP
 * session before it is dropped. Without a bound, a prompt queued while the CLI
 * is down would fire whenever the connection eventually came up - long after
 * the user moved on from the code they clicked.
 */
const PENDING_PROMPT_TIMEOUT_MS = 30_000;

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'nanocoder.chatView';

	private _view?: vscode.WebviewView;
	private _isWebviewReady = false;
	/** Code lens prompt waiting on the webview shell and the ACP session. */
	private _pendingPrompt: string | null = null;
	private _pendingPromptTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _outputChannel: vscode.OutputChannel,
		private readonly _acpClient: NanocoderAcpClient,
		private readonly _diffManager: DiffManager
	) { 
		// Listen for session updates from ACP
		this._acpClient.onSessionUpdate = (update: any) => {
			this.handleDiffs(update);
			this.postMessage({
				type: 'acpUpdate',
				update
			});
		};

		this._acpClient.onPermissionRequested = (toolCallId: string, toolCall: any, options?: any[]) => {
			this.handleDiffs(toolCall);
			this.postMessage({
				type: 'permissionRequested',
				toolCallId,
				toolCall,
				options
			});
		};

		this._acpClient.onStateSync = (state: any) => {
			this.postMessage({
				type: 'syncState',
				...state
			});
		};

		this._acpClient.onConnectionReady = () => {
			this._initializeSessionIfReady();
		};
	}

	private handleDiffs(payload: any) {
		const update = payload?.update || payload;
		if (update?.content && Array.isArray(update.content)) {
			for (const block of update.content) {
				if (block.type === 'diff' && block.path) {
					this._diffManager.addPendingChange({
						type: 'file_change',
						id: payload.toolCallId || block.path, // fallback id
						filePath: block.path,
						originalContent: block.oldText || '',
						newContent: block.newText || '',
						toolName: update.title || update.name || 'edit',
						toolArgs: update.rawInput || {}
					});
				}
			}
		}
	}

	/**
	 * Reveal the chat view and run `text` as a prompt. An editor code lens can
	 * fire long before the sidebar has ever been opened, so the prompt is held
	 * until the shell reports ready and a session exists.
	 */
	public async sendPrompt(text: string) {
		this._queuePendingPrompt(text);
		await vscode.commands.executeCommand(`${ChatWebviewProvider.viewType}.focus`);
		await this._initializeSessionIfReady();
	}

	private _queuePendingPrompt(text: string) {
		this._clearPendingPrompt();
		this._pendingPrompt = text;
		this._pendingPromptTimer = setTimeout(() => {
			this._pendingPromptTimer = null;
			this._pendingPrompt = null;
			vscode.window.showWarningMessage(
				'Nanocoder: the agent did not start in time, so your editor request was not sent. Try again once the chat view is connected.',
			);
		}, PENDING_PROMPT_TIMEOUT_MS);
	}

	private _clearPendingPrompt() {
		if (this._pendingPromptTimer) {
			clearTimeout(this._pendingPromptTimer);
			this._pendingPromptTimer = null;
		}
		this._pendingPrompt = null;
	}

	/**
	 * Hand a queued prompt to the webview. Cleared before posting so a failed
	 * delivery can't be retried into a half-loaded shell.
	 */
	private _flushPendingPrompt() {
		const text = this._pendingPrompt;
		if (text === null) {
			return;
		}
		this._clearPendingPrompt();
		this.postMessage({type: 'runPrompt', text});
	}

	public requestCopyLastCodeBlock() {
		if (!this._view) {
			vscode.window.showInformationMessage('Nanocoder: open the Nanocoder chat view first.');
			return;
		}
		this.postMessage({type: 'copyLastCodeBlock'});
	}

	public toggleHistory() {
		if (this._view) {
			this._view.webview.postMessage({ type: 'toggleHistory' });
		}
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;
		// A re-resolve means a brand new shell that has not run its script yet.
		// Leaving the flag set from the previous one would let a queued prompt
		// post into a webview with no message listener attached, dropping it.
		this._isWebviewReady = false;
		webviewView.onDidDispose(() => {
			this._view = undefined;
			this._isWebviewReady = false;
		});

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				this._extensionUri
			]
		};

		// Preserve the webview DOM when user switches to another sidebar view.
		// Without this, VS Code destroys and recreates the webview every switch,
		// wiping the transcript even though the ACP session is still alive.
		// NOTE: retainContextWhenHidden is set on registerWebviewViewProvider in extension.ts.

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(
			(message: WebviewToExtensionMessage) => {
				switch (message.type) {
					case 'ready':
						this._outputChannel.appendLine('[Webview] Chat shell is ready.');
						this._isWebviewReady = true;
						this._initializeSessionIfReady();
						break;
					case 'submitMessage':
						this._outputChannel.appendLine(`[Webview] User submitted: ${message.text}`);
						this._handlePrompt(message.text, message.images);
						break;
					case 'cancel':
						this._outputChannel.appendLine('[Webview] User cancelled operation.');
						this._acpClient.cancel();
						break;
					case 'approveTool':
						this._outputChannel.appendLine(`[Webview] User approved tool: ${message.toolCallId}`);
						this._acpClient.resolvePermission(message.toolCallId, true);
						break;
					case 'denyTool':
						this._outputChannel.appendLine(`[Webview] User denied tool: ${message.toolCallId}`);
						this._acpClient.resolvePermission(message.toolCallId, false);
						break;
					case 'resolveTool':
						this._outputChannel.appendLine(`[Webview] User resolved tool: ${message.toolCallId} with option: ${message.optionId}`);
						this._acpClient.resolvePermission(message.toolCallId, message.optionId);
						break;
					case 'showDiff':
						this._outputChannel.appendLine(`[Webview] User requested to see diff for: ${message.toolCallId}`);
						this._diffManager.showDiff(message.toolCallId);
						break;

					case 'setMode':
						this._outputChannel.appendLine(`[Webview] User selected mode: ${message.mode}`);
						this._acpClient.setSessionMode(message.mode);
						break;
					case 'setProvider':
						this._outputChannel.appendLine(`[Webview] User selected provider: ${message.provider}`);
						this._acpClient.setSessionProvider(message.provider).then(() => {
							vscode.window.showInformationMessage(`Nanocoder: Provider switched to ${message.provider}`);
						});
						break;
					case 'setModel':
						this._outputChannel.appendLine(`[Webview] User selected model: ${message.model}`);
						this._acpClient.setSessionModel(message.model).then(() => {
							vscode.window.showInformationMessage(`Nanocoder: Model switched to ${message.model}`);
						});
						break;
					case 'listSessions':
						this._broadcastSessions();
						break;
					case 'resumeSession':
						this._outputChannel.appendLine(`[Webview] User resumed session: ${message.sessionId}`);
						this.postMessage({type: 'clear', isLoading: true});
						this._acpClient.resumeSession(message.sessionId).finally(() => {
							this.postMessage({type: 'sessionLoaded'});
						});
						break;
					case 'deleteSession':
						this._outputChannel.appendLine(`[Webview] User deleted session: ${message.sessionId}`);
						this._acpClient.deleteSession(message.sessionId).then(() => {
							this._broadcastSessions();
						});
						break;
					case 'requestPathInfo': {
						try {
							const stat = fs.statSync(message.path);
							const kind = stat.isDirectory() ? 'folder' : 'file';
							const name = path.basename(message.path);
							this.postMessage({ type: 'pathInfoResolved', path: message.path, name, kind });
						} catch {
							// path doesn't exist or access denied — silently ignore
						}
						break;
					}
					case 'requestOpenDialog': {
						vscode.window.showOpenDialog({
							canSelectFiles: true,
							canSelectFolders: true,
							canSelectMany: true,
							openLabel: 'Attach'
						}).then(uris => {
							if (uris && uris.length > 0) {
								uris.forEach(uri => {
									try {
										const stat = fs.statSync(uri.fsPath);
										const kind = stat.isDirectory() ? 'folder' : 'file';
										const name = path.basename(uri.fsPath);
										this.postMessage({ type: 'pathInfoResolved', path: uri.fsPath, name, kind });
									} catch {}
								});
							}
						});
						break;
					}
					case 'openPath': {
						const uri = vscode.Uri.file(message.path);
						if (message.kind === 'folder') {
							// Reveal and focus folder in Explorer sidebar
							vscode.commands.executeCommand('revealInExplorer', uri);
						} else {
							// Open file in editor
							vscode.window.showTextDocument(uri, { preview: false, preserveFocus: false });
						}
						break;
					}
					case 'showError':
						this._outputChannel.appendLine(`[Webview] Error: ${message.message}`);
						vscode.window.showErrorMessage(message.message);
						break;
					case 'copyToClipboard':
						this._copyToClipboard(message.text);
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

	private async _initializeSessionIfReady() {
		if (!this._isWebviewReady || !this._acpClient.connection) {
			return;
		}
		try {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			const cwd = workspaceFolder?.uri.fsPath || process.cwd();
			const sessionId = await this._acpClient.getOrCreateSession(cwd);
			if (sessionId) {
				this._outputChannel.appendLine(`[Extension] Session initialized automatically: ${sessionId}`);
				// Broadcast session list to populate History tab
				await this._broadcastSessions();
				this._flushPendingPrompt();
			}
		} catch (error) {
			this._outputChannel.appendLine(`Failed to initialize session on ready: ${error}`);
		}
	}

	// The webview extracts the text; the host owns the write because a
	// palette-triggered copy has no user gesture for navigator.clipboard.
	private async _copyToClipboard(text: string) {
		try {
			await vscode.env.clipboard.writeText(text);
			this.postMessage({type: 'copyResult', ok: true, chars: text.length});
		} catch (error) {
			this._outputChannel.appendLine(`Failed to write to clipboard: ${error}`);
			this.postMessage({type: 'copyResult', ok: false, error: String(error)});
		}
	}

	private async _broadcastSessions() {
		const sessions = await this._acpClient.listSessions();
		this.postMessage({type: 'updateSessions', sessions});
	}

	/**
	 * Expand @[file] and @[folder] references injected by the webview into
	 * file/directory contents. This resolves attached context inline so the LLM
	 * receives the content directly in the prompt, removing the need for a
	 * read_file / list_directory tool call. Without this, providers like Atlas
	 * Cloud that return HTTP 400 on tool-result messages would break every
	 * time the user attached a file or folder.
	 */
	private _expandContextAttachments(text: string): string {
		return text.replace(
			/@\[(file|folder)\] ([^\n]+)/g,
			(_match, kind: string, rawPath: string) => {
				const filePath = rawPath.trim();
				try {
					if (kind === 'folder') {
						// Emit a compact directory listing (names only, one per line)
						const entries = fs.readdirSync(filePath, { withFileTypes: true });
						const listing = entries
							.map(e => (e.isDirectory() ? `${e.name}/` : e.name))
							.join('\n');
						return `<context path="${filePath}" type="directory">\n${listing}\n</context>`;
					} else {
						const content = fs.readFileSync(filePath, 'utf8');
						return `<context path="${filePath}">\n${content}\n</context>`;
					}
				} catch (err) {
					// If we can't read the path, leave it as a plain mention so the
					// LLM still knows what the user was referring to.
					this._outputChannel.appendLine(`[Context] Could not read ${filePath}: ${err}`);
					return `<!-- could not read ${filePath}: ${err} -->`;
				}
			},
		);
	}

	private async _handlePrompt(text: string, images?: { data: string, mimeType: string }[]) {
		try {
			if (this._acpClient.hasPendingPermissions()) {
				vscode.window.showWarningMessage('Nanocoder: Please approve or deny the pending tool before sending a new message.');
				return;
			}

			// /clear resets the server-side conversation; wipe the visible
			// transcript too so the UI matches (the server's confirmation
			// message then streams into the fresh view).
			if (text.trim() === '/clear') {
				this.postMessage({type: 'clear'});
			}

			// Expand any @[file] / @[folder] attachments into their contents
			// before handing the prompt to the ACP client. This prevents
			// providers that reject tool-result messages (e.g. Atlas Cloud)
			// from returning 400 errors on every file-attached message.
			const expandedText = this._expandContextAttachments(text);

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
			});

			await this._acpClient.prompt(expandedText, images);
			// Signal turn completion so the Webview can flip back to the send button
			this.postMessage({type: 'acpUpdate', update: {sessionUpdate: 'prompt_response'}});
		} catch (error) {
			this._outputChannel.appendLine(`Prompt execution error: ${error}`);
			vscode.window.showErrorMessage(`Nanocoder Prompt error: ${error}`);
			// Always reset the button even on error
			this.postMessage({type: 'acpUpdate', update: {sessionUpdate: 'prompt_response'}});
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'chat-panel.html');
		let html = fs.readFileSync(htmlPath, 'utf8');

		const extVersion = vscode.extensions.getExtension('nanocollective.nanocoder')?.packageJSON.version || Date.now().toString();
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat-panel.js')).with({ query: `v=${extVersion}` });
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat-panel.css')).with({ query: `v=${extVersion}` });
		const markedUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'marked.min.js'));
		const nonce = getNonce();

		html = html.replace(/\{\{cspSource\}\}/g, webview.cspSource);
		html = html.replace(/\{\{nonce\}\}/g, nonce);
		html = html.replace(/\{\{styleUri\}\}/g, styleUri.toString());
		html = html.replace(/\{\{scriptUri\}\}/g, scriptUri.toString());
		html = html.replace(/\{\{markedUri\}\}/g, markedUri.toString());

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
