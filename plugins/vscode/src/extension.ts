import * as vscode from 'vscode';
import * as path from 'path';
import {WebSocketClient} from './websocket-client';
import {DiffManager} from './diff-manager';
import {
	ServerMessage,
	FileChangeMessage,
	CloseDiffMessage,
	DiagnosticInfo,
	OpenFileMessage,
} from './protocol';

const DEFAULT_PORT = 51820;

let wsClient: WebSocketClient;
let diffManager: DiffManager;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('Nanocoder');
	outputChannel.appendLine('Nanocoder extension activating...');

	// Initialize components
	wsClient = new WebSocketClient(outputChannel);
	diffManager = new DiffManager(context);

	// Create status bar item
	statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100,
	);
	statusBarItem.command = 'nanocoder.connect';
	updateStatusBar(false);
	statusBarItem.show();

	// Handle messages from CLI
	wsClient.onMessage(message => handleServerMessage(message));

	// Register commands
	context.subscriptions.push(
		vscode.commands.registerCommand('nanocoder.connect', connect),
		vscode.commands.registerCommand('nanocoder.disconnect', disconnect),
		vscode.commands.registerCommand('nanocoder.startCli', startCli),
		// Context menu command
		vscode.commands.registerCommand('nanocoder.askAboutCode', () =>
			sendCodeToNanocoder(),
		),
	);

	// Auto-connect if configured
	const config = vscode.workspace.getConfiguration('nanocoder');
	if (config.get<boolean>('autoConnect', true)) {
		setTimeout(() => connect(), 1000);
	}

	context.subscriptions.push(
		statusBarItem,
		outputChannel,
		{dispose: () => wsClient.disconnect()},
		{dispose: () => diffManager.dispose()},
	);

	outputChannel.appendLine('Nanocoder extension activated');
}

export function deactivate() {
	wsClient?.disconnect();
	diffManager?.dispose();
}

// Connection management
async function connect(): Promise<void> {
	const config = vscode.workspace.getConfiguration('nanocoder');
	const port = config.get<number>('serverPort', DEFAULT_PORT);

	updateStatusBar(false, 'Connecting...');

	const connected = await wsClient.connect(port);

	if (connected) {
		updateStatusBar(true);
		sendWorkspaceContext();
		vscode.window.showInformationMessage('Connected to Nanocoder CLI');
	} else {
		updateStatusBar(false);
		const action = await vscode.window.showWarningMessage(
			'Could not connect to Nanocoder CLI. Is it running?',
			'Start CLI',
			'Retry',
		);
		if (action === 'Start CLI') {
			startCli();
		} else if (action === 'Retry') {
			connect();
		}
	}
}

function disconnect(): void {
	wsClient.disconnect();
	updateStatusBar(false);
	vscode.window.showInformationMessage('Disconnected from Nanocoder CLI');
}

// Status bar updates
function updateStatusBar(connected: boolean, text?: string): void {
	if (text) {
		statusBarItem.text = `$(sync~spin) ${text}`;
	} else if (connected) {
		statusBarItem.text = '$(check) Nanocoder';
		statusBarItem.tooltip = 'Connected to Nanocoder CLI';
		statusBarItem.command = 'nanocoder.disconnect';
	} else {
		statusBarItem.text = '$(plug) Nanocoder';
		statusBarItem.tooltip = 'Click to connect to Nanocoder CLI';
		statusBarItem.command = 'nanocoder.connect';
	}
}

// Message handling
function handleServerMessage(message: ServerMessage): void {
	switch (message.type) {
		case 'file_change':
			handleFileChange(message);
			break;
		case 'close_diff':
			handleCloseDiff(message);
			break;
		case 'open_file':
			handleOpenFile(message);
			break;
		case 'status':
			if (message.model) {
				statusBarItem.text = `$(check) ${message.model}`;
			}
			break;
		case 'connection_ack':
			outputChannel.appendLine(
				`Connected to CLI v${message.cliVersion} (protocol v${message.protocolVersion})`,
			);
			break;
		case 'diagnostics_request':
			handleDiagnosticsRequest(message.filePath);
			break;
	}
}

function handleFileChange(message: FileChangeMessage): void {
	const config = vscode.workspace.getConfiguration('nanocoder');
	const showDiffPreview = config.get<boolean>('showDiffPreview', true);

	// Add to pending changes
	diffManager.addPendingChange(message);

	if (showDiffPreview) {
		// Show diff immediately
		diffManager.showDiff(message.id);
	}
}

function handleCloseDiff(message: CloseDiffMessage): void {
	// Close the diff preview when tool is confirmed/rejected in CLI
	diffManager.closeDiff(message.id);
}

function handleOpenFile(message: OpenFileMessage): void {
	// Open the file in VS Code editor for viewing
	const uri = vscode.Uri.file(message.filePath);
	vscode.window.showTextDocument(uri, {
		preview: true,
		preserveFocus: false,
		selection: new vscode.Range(0, 0, 0, 0), // Position cursor at start of file
	});
	outputChannel.appendLine(`Opened file: ${message.filePath}`);
}

function handleDiagnosticsRequest(filePath?: string): void {
	const diagnostics: DiagnosticInfo[] = [];

	if (filePath) {
		// Get diagnostics for specific file
		const uri = vscode.Uri.file(filePath);
		const fileDiagnostics = vscode.languages.getDiagnostics(uri);
		diagnostics.push(...convertDiagnostics(uri, fileDiagnostics));
	} else {
		// Get all diagnostics
		const allDiagnostics = vscode.languages.getDiagnostics();
		for (const [uri, fileDiagnostics] of allDiagnostics) {
			diagnostics.push(...convertDiagnostics(uri, fileDiagnostics));
		}
	}

	wsClient.send({
		type: 'diagnostics_response',
		diagnostics,
	});
}

function convertDiagnostics(
	uri: vscode.Uri,
	diagnostics: readonly vscode.Diagnostic[],
): DiagnosticInfo[] {
	return diagnostics.map(d => ({
		filePath: uri.fsPath,
		line: d.range.start.line + 1, // 1-indexed
		character: d.range.start.character + 1,
		message: d.message,
		severity: severityToString(d.severity),
		source: d.source,
	}));
}

function severityToString(
	severity: vscode.DiagnosticSeverity,
): DiagnosticInfo['severity'] {
	switch (severity) {
		case vscode.DiagnosticSeverity.Error:
			return 'error';
		case vscode.DiagnosticSeverity.Warning:
			return 'warning';
		case vscode.DiagnosticSeverity.Information:
			return 'info';
		case vscode.DiagnosticSeverity.Hint:
			return 'hint';
	}
}

function startCli(): void {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	const cwd = workspaceFolder?.uri.fsPath || process.cwd();

	// Create terminal and run nanocoder
	const terminal = vscode.window.createTerminal({
		name: 'Nanocoder',
		cwd,
	});

	terminal.sendText('nanocoder --vscode');
	terminal.show();

	// Try to connect after a delay
	setTimeout(() => connect(), 3000);
}

// Send workspace context to CLI
function sendWorkspaceContext(): void {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	const activeEditor = vscode.window.activeTextEditor;

	// Get open files
	const openFiles = vscode.workspace.textDocuments
		.filter(doc => doc.uri.scheme === 'file')
		.map(doc => doc.uri.fsPath);

	// Get diagnostics for open files
	const diagnostics: DiagnosticInfo[] = [];
	for (const filePath of openFiles) {
		const uri = vscode.Uri.file(filePath);
		const fileDiagnostics = vscode.languages.getDiagnostics(uri);
		diagnostics.push(...convertDiagnostics(uri, fileDiagnostics));
	}

	wsClient.send({
		type: 'context',
		workspaceFolder: workspaceFolder?.uri.fsPath,
		openFiles,
		activeFile: activeEditor?.document.uri.fsPath,
		diagnostics,
	});
}

// Send selected code to Nanocoder CLI
function sendCodeToNanocoder(): void {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showWarningMessage('No active editor');
		return;
	}

	const selection = editor.selection;
	if (selection.isEmpty) {
		vscode.window.showWarningMessage('No code selected');
		return;
	}

	if (!wsClient.isConnected()) {
		vscode.window
			.showWarningMessage(
				'Not connected to Nanocoder CLI',
				'Connect',
				'Start CLI',
			)
			.then(choice => {
				if (choice === 'Connect') {
					connect().then(() => sendCodeToNanocoder());
				} else if (choice === 'Start CLI') {
					startCli();
				}
			});
		return;
	}

	const selectedText = editor.document.getText(selection);
	const filePath = editor.document.uri.fsPath;
	const fileName = path.basename(filePath);
	const startLine = selection.start.line + 1;
	const endLine = selection.end.line + 1;

	// Prompt the user for their question
	vscode.window
		.showInputBox({
			prompt: 'What would you like to ask about this code?',
			placeHolder: 'Enter your question...',
		})
		.then(question => {
			if (question) {
				// Send just the question - the CLI will format the display and include the code
				sendPromptWithContext(question, filePath, selectedText, selection, {
					fileName,
					startLine,
					endLine,
				});
			}
		});
}

// Helper to send prompt with context
function sendPromptWithContext(
	prompt: string,
	filePath: string,
	selection: string,
	selectionRange: vscode.Selection,
	lineInfo: {fileName: string; startLine: number; endLine: number},
): void {
	wsClient.send({
		type: 'send_prompt',
		prompt,
		context: {
			filePath,
			selection,
			fileName: lineInfo.fileName,
			startLine: lineInfo.startLine,
			endLine: lineInfo.endLine,
			cursorPosition: {
				line: selectionRange.start.line,
				character: selectionRange.start.character,
			},
		},
	});

	vscode.window.showInformationMessage('Sent to Nanocoder CLI');
	outputChannel.appendLine(
		`Sent prompt to CLI: ${prompt.substring(0, 100)}...`,
	);
}
