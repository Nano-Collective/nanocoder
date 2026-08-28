import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { WebviewToExtensionMessage, ExtensionToWebviewMessage, MentionItem } from './webview-protocol';



import { NanocoderAcpClient } from './acp-client';
import { DiffManager } from './diff-manager';
import { SettingsManager } from './settings-manager';
import { searchMentions, MentionSearchDeps } from './mention-search';
import { readCappedFile, readCappedDirectory } from './context-attachment';

/**
 * Excluded from `@` search regardless of user settings — never useful context.
 * Merged with the user's own excludes in `_mentionExcludeGlob`.
 */
const MENTION_ALWAYS_EXCLUDE = [
	'**/node_modules/**',
	'**/.git/**',
	'**/dist/**',
	'**/out/**',
	'**/build/**',
	'**/.next/**',
	'**/coverage/**',
];

/**
 * How long an editor-driven prompt waits for the webview shell and the ACP
 * session before it is dropped. Without a bound, a prompt queued while the CLI
 * is down would fire whenever the connection eventually came up - long after
 * the user moved on from the code they clicked.
 */
const PENDING_PROMPT_TIMEOUT_MS = 30_000;

export class ChatWebviewProvider
	implements vscode.WebviewViewProvider, vscode.Disposable {
	public static readonly viewType = 'nanocoder.chatView';

	private _view?: vscode.WebviewView;
	private _isWebviewReady = false;
	private _timelineRefreshTimer?: ReturnType<typeof setTimeout>;
	/** Non-null while a timeline revert is in flight. See `_handleRevert`. */
	private _revertReplayBuffer: any[] | null = null;
	/** Code lens prompt waiting on the webview shell and the ACP session. */
	private _pendingPrompt: string | null = null;
	private _pendingPromptTimer: ReturnType<typeof setTimeout> | null = null;

	private readonly _settingsManager: SettingsManager;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _outputChannel: vscode.OutputChannel,
		private readonly _acpClient: NanocoderAcpClient,
		private readonly _diffManager: DiffManager
	) {
		this._settingsManager = new SettingsManager(this._outputChannel);
		// Listen for session updates from ACP
		this._acpClient.onSessionUpdate = (update: any) => {
			this.handleDiffs(update);
			// A revert replays the whole truncated thread from inside the
			// timeline/revert call, so those updates arrive before the call
			// resolves. Hold them until we know the revert succeeded, then
			// clear and flush; a refused revert drops them and leaves the
			// existing thread on screen.
			if (this._revertReplayBuffer) {
				this._revertReplayBuffer.push(update);
				return;
			}
			this.postMessage({
				type: 'acpUpdate',
				update
			});
			const kind = update?.update?.sessionUpdate ?? update?.sessionUpdate;
			if (kind === 'tool_call' || kind === 'tool_call_update') {
				this.scheduleTimelineRefresh();
			}
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

		this._acpClient.onPermissionsCancelled = (toolCallIds: string[]) => {
			this.postMessage({
				type: 'permissionsCancelled',
				toolCallIds
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
						id: update.toolCallId || payload.toolCallId || block.path, // fallback id
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

	/**
	 * Registered with the extension's subscriptions so a deactivate cannot
	 * leave the pending-prompt timer running against a disposed view.
	 */
	public dispose() {
		this._clearPendingPrompt();
		if (this._timelineRefreshTimer) {
			clearTimeout(this._timelineRefreshTimer);
			this._timelineRefreshTimer = undefined;
		}
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

	public toggleSettings() {
		if (this._view) {
			this._view.webview.postMessage({ type: 'toggleSettings' });
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
			// A disposal can land after a newer view has already been resolved
			// (VS Code tears the old one down late). Without this guard that
			// stale event would null out the live view and drop its state.
			if (this._view !== webviewView) {
				return;
			}
			this._view = undefined;
			this._isWebviewReady = false;
			// A queued prompt is deliberately kept: a disposal is usually a
			// re-reveal in progress, and the next resolve is what delivers it.
			// The timeout is what bounds the wait if no view comes back.
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
							this._broadcastTimeline();
						});
						break;
					case 'deleteSession':
						this._outputChannel.appendLine(`[Webview] User deleted session: ${message.sessionId}`);
						this._acpClient.deleteSession(message.sessionId).then(() => {
							this._broadcastSessions();
						});
						break;
					case 'renameSession':
						this._outputChannel.appendLine(`[Webview] User renamed session: ${message.sessionId} -> ${message.title}`);
						this._acpClient.renameSession(message.sessionId, message.title).then(() => {
							this._broadcastSessions();
						});
						break;
					case 'requestSettings':
						this._outputChannel.appendLine('[Webview] Settings data requested.');
						this._handleRequestSettings();
						break;
					case 'updateSetting':
						this._outputChannel.appendLine(`[Webview] Update setting: ${message.key}`);
						this._handleUpdateSetting(message.key, message.value);
						break;
					case 'openConfigFile':
						this._outputChannel.appendLine(`[Webview] Open config file: ${message.file}`);
						this._handleOpenConfigFile(message.file);
						break;
					case 'restartAcp':
						this._outputChannel.appendLine('[Webview] Restart ACP requested.');
						vscode.commands.executeCommand('nanocoder.restartAcp');
						break;
					case 'requestPathInfo': {
						try {
							const stat = fs.statSync(message.path);
							const kind = stat.isDirectory() ? 'folder' : 'file';
							const name = path.basename(message.path);
							this.postMessage({ type: 'pathInfoResolved', path: message.path, name, kind });
						} catch (err) {
							// Path doesn't exist or access denied. Nothing to attach, but
							// log it — a drop that resolves to a bad path is otherwise a
							// completely silent no-op with no way to diagnose it.
							this._outputChannel.appendLine(
								`[Webview] Could not resolve dropped path "${message.path}": ${err}`,
							);
						}
						break;
					}
					case 'requestMentionCompletions': {
						this._handleMentionCompletions(message.query, message.requestId);
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
					case 'requestTimeline':
						this._broadcastTimeline();
						break;
					case 'revertToCheckpoint':
						this._handleRevert(message.checkpointId);
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
				await this._broadcastTimeline();
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

	private scheduleTimelineRefresh() {
		if (this._timelineRefreshTimer) {
			clearTimeout(this._timelineRefreshTimer);
		}
		this._timelineRefreshTimer = setTimeout(() => {
			this._broadcastTimeline();
		}, 150);
	}

	private async _broadcastTimeline() {
		const entries = await this._acpClient.listTimeline();
		this.postMessage({type: 'updateTimeline', entries});
	}

	/**
	 * Clearing the panel before the revert resolves would leave it blank with
	 * nothing to replay into it whenever the revert is refused (an in-flight
	 * turn, a dropped connection). So buffer the agent's replay instead, and
	 * only clear once the revert has actually happened.
	 */
	private async _handleRevert(checkpointId: string) {
		this._outputChannel.appendLine(`[Webview] User reverted timeline to ${checkpointId}`);
		const buffer: any[] = [];
		this._revertReplayBuffer = buffer;
		try {
			await this._acpClient.revertTimeline(checkpointId);
		} catch {
			// Error toast is raised by the ACP client. The thread is untouched,
			// so drop whatever was buffered and leave the panel as it was.
			return;
		} finally {
			this._revertReplayBuffer = null;
		}

		this.postMessage({type: 'clear', isLoading: true});
		for (const update of buffer) {
			this.postMessage({type: 'acpUpdate', update});
		}
		this.postMessage({type: 'sessionLoaded'});
		await this._broadcastTimeline();
	}

	private _handleRequestSettings() {
		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
		const settings = this._settingsManager.readSettings(cwd);
		this.postMessage({type: 'settingsData', settings});
	}

	private _handleUpdateSetting(key: string, value: unknown) {
		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
		const result = this._settingsManager.updateSetting(cwd, key, value);
		this.postMessage({
			type: 'settingsUpdated',
			key,
			success: result.success,
			error: result.error,
		});

		// If successful, send refreshed settings so the UI stays in sync
		if (result.success) {
			const settings = this._settingsManager.readSettings(cwd);
			this.postMessage({type: 'settingsData', settings});
		} else {
			vscode.window.showErrorMessage(`Failed to save setting '${key}': ${result.error}`);
		}
	}

	private async _handleOpenConfigFile(file: string) {
		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
		const paths = this._settingsManager.getConfigPaths(cwd);
		const filePath =
			file === 'agents.config.json' ? paths.agentsConfig
			: file === '.mcp.json' ? paths.mcpConfig
			: paths.preferences;

		try {
			if (!fs.existsSync(filePath)) {
				fs.mkdirSync(path.dirname(filePath), {recursive: true});
				// Seed .mcp.json with the wrapper the loader expects, so an empty
				// file is still a usable starting point. Matches the CLI's
				// settings-json-config.tsx.
				const seed = file === '.mcp.json' ? '{\n\t"mcpServers": {}\n}\n' : '{}\n';
				fs.writeFileSync(filePath, seed, 'utf-8');
			}
			const doc = await vscode.workspace.openTextDocument(filePath);
			await vscode.window.showTextDocument(doc);
		} catch {
			vscode.window.showErrorMessage(
				`Could not open ${file} at ${filePath}. Ensure the file exists.`,
			);
		}
	}

	/**
	 * Exclude glob for `@` search.
	 *
	 * VS Code *replaces* its default excludes when `findFiles` is given an
	 * explicit exclude rather than merging with them, so passing only the list
	 * below would put `.env`, secrets and anything else the user hid via
	 * `files.exclude` into the dropdown. Both settings are folded in by hand.
	 * `search.exclude` is included too: it never applies to `findFiles`, but a
	 * file picker honouring it is what users expect.
	 */
	private _mentionExcludeGlob(scope?: vscode.Uri): string {
		const globs = new Set(MENTION_ALWAYS_EXCLUDE);

		for (const section of ['files.exclude', 'search.exclude']) {
			// Scoped to the folder being searched: both settings are
			// folder-overridable, and reading them unscoped would miss that.
			const patterns = vscode.workspace
				.getConfiguration(undefined, scope)
				.get<Record<string, boolean>>(section);
			if (!patterns) {
				continue;
			}
			for (const [glob, enabled] of Object.entries(patterns)) {
				// A `when` clause resolves to a non-boolean; those are sibling
				// conditions we cannot evaluate here, so we leave them alone.
				if (enabled === true) {
					globs.add(glob);
				}
			}
		}

		// A single-element brace list is invalid in some glob parsers, and the set
		// can never be empty here, but the guard keeps that assumption local.
		const list = [...globs];
		return list.length === 1 ? list[0] : `{${list.join(',')}}`;
	}

	/**
	 * Bind the workspace-search primitives that `searchMentions` needs. Kept
	 * separate from the search itself so the ranking and matching logic stays
	 * unit-testable without an extension host.
	 */
	private _mentionSearchDeps(): MentionSearchDeps {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		const workspaceRoot = workspaceFolder?.uri.fsPath || process.cwd();
		const exclude = this._mentionExcludeGlob(workspaceFolder?.uri);

		return {
			workspaceRoot,
			openEditors: () => {
				const paths: string[] = [];
				for (const group of vscode.window.tabGroups.all) {
					for (const tab of group.tabs) {
						const input = tab.input;
						if (input instanceof vscode.TabInputText && input.uri.scheme === 'file') {
							paths.push(input.uri.fsPath);
						}
					}
				}
				return paths;
			},
			findFiles: async (glob, limit) => {
				const uris = await vscode.workspace.findFiles(
					workspaceFolder ? new vscode.RelativePattern(workspaceFolder, glob) : glob,
					exclude,
					limit,
				);
				return uris.map(uri => uri.fsPath);
			},
		};
	}

	private async _handleMentionCompletions(query: string, requestId: number) {
		let items: MentionItem[] = [];
		try {
			items = await searchMentions(query, this._mentionSearchDeps());
		} catch (error) {
			this._outputChannel.appendLine(`[Mention] Search failed for "${query}": ${error}`);
		}
		// Answer even on failure, so the webview clears its in-flight state and
		// the dropdown closes instead of hanging on a stale result set.
		this.postMessage({ type: 'mentionCompletions', requestId, items });
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
						const listing = readCappedDirectory(filePath);
						return `<context path="${filePath}" type="directory">\n${listing}\n</context>`;
					} else {
						// Capped rather than a bare readFileSync: `@` makes attaching
						// a lockfile or a minified bundle one keystroke, and an
						// uncapped read would silently eat the whole context window.
						const content = readCappedFile(filePath);
						if (content === null) {
							this._outputChannel.appendLine(`[Context] Skipped unreadable or binary file ${filePath}`);
							return `<!-- skipped ${filePath}: unreadable or binary -->`;
						}
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
				// The webview has already drawn the user bubble and flipped to
				// the loading state, and no turn is going to start - so end the
				// turn here or the composer spins until the user hits Escape.
				this.postMessage({type: 'acpUpdate', update: {sessionUpdate: 'prompt_response'}});
				return;
			}

			// /clear resets the server-side conversation; wipe the visible
			// transcript too so the UI matches (the server's confirmation
			// message then streams into the fresh view).
			if (text.trim() === '/clear') {
				this.postMessage({type: 'clear'});
				this.postMessage({type: 'updateTimeline', entries: []});
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
				this.postMessage({type: 'acpUpdate', update: {sessionUpdate: 'prompt_response', outcome: 'failed'}});
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

			const response = await this._acpClient.prompt(expandedText, images);
			const outcome = response?.stopReason === 'cancelled'
				? 'cancelled'
				: response
					? 'completed'
					: 'failed';
			// Signal turn completion so the Webview can flip back to the send
			// button. Forward the per-turn token usage and estimated cost so
			// the webview can render the usage indicator under the response.
			this.postMessage({
				type: 'acpUpdate',
				update: {
					sessionUpdate: 'prompt_response',
					outcome,
					usage: response?.usage,
					cost: (response?._meta as Record<string, any> | undefined)?.['nanocoder/usage']?.cost,
				},
			});
		} catch (error) {
			this._outputChannel.appendLine(`Prompt execution error: ${error}`);
			vscode.window.showErrorMessage(`Nanocoder Prompt error: ${error}`);
			// Always reset the button even on error
			this.postMessage({type: 'acpUpdate', update: {sessionUpdate: 'prompt_response', outcome: 'failed'}});
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'chat-panel.html');
		let html = fs.readFileSync(htmlPath, 'utf8');

		const extVersion = vscode.extensions.getExtension('nanocollective.nanocoder')?.packageJSON.version || Date.now().toString();
		// Bust the webview cache per asset rather than per extension version, so
		// editing a media file in the dev host shows up on reload. Never let a
		// missing asset take the whole panel down with it: chat-panel.css is a
		// build output, and before this existed an unbuilt one merely rendered
		// the panel unstyled instead of throwing out of getHtml.
		const assetVersion = (fileName: string) => {
			try {
				// fileName is never user input — every call site passes a media/
				// filename literal. Basename keeps the join inside media/.
				const safeName = path.basename(fileName);
				const assetPath = path.join(this._extensionUri.fsPath, 'media', safeName); // nosemgrep
				return `${extVersion}-${fs.statSync(assetPath).mtimeMs}`;
			} catch {
				return extVersion;
			}
		};
		const scriptUri = webview
			.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat-panel.js'))
			.with({query: `v=${assetVersion('chat-panel.js')}`});
		const styleUri = webview
			.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat-panel.css'))
			.with({query: `v=${assetVersion('chat-panel.css')}`});
		const markedUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'marked.min.js'));
		const mentionUtilsUri = webview
			.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'mention-utils.js'))
			.with({query: `v=${assetVersion('mention-utils.js')}`});
		const uriUtilsUri = webview
			.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'uri-utils.js'))
			.with({query: `v=${assetVersion('uri-utils.js')}`});
		const slashCommandUtilsUri = webview
			.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'slash-command-utils.js'))
			.with({query: `v=${assetVersion('slash-command-utils.js')}`});
		const nonce = getNonce();

		html = html.replace(/\{\{cspSource\}\}/g, webview.cspSource);
		html = html.replace(/\{\{nonce\}\}/g, nonce);
		html = html.replace(/\{\{styleUri\}\}/g, styleUri.toString());
		html = html.replace(/\{\{scriptUri\}\}/g, scriptUri.toString());
		html = html.replace(/\{\{markedUri\}\}/g, markedUri.toString());
		html = html.replace(/\{\{mentionUtilsUri\}\}/g, mentionUtilsUri.toString());
		html = html.replace(/\{\{uriUtilsUri\}\}/g, uriUtilsUri.toString());
		html = html.replace(/\{\{slashCommandUtilsUri\}\}/g, slashCommandUtilsUri.toString());

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
