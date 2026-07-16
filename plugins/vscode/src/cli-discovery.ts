import * as vscode from 'vscode';
import * as cp from 'child_process';

import * as fs from 'fs';
import * as path from 'path';

export async function findCliPath(): Promise<string | null> {
	// 1. Check for a custom configured path
	const config = vscode.workspace.getConfiguration('nanocoder');
	const customPath = config.get<string>('cliPath');
	if (customPath && fs.existsSync(customPath)) {
		return customPath;
	}

	// 2. Local development fallback: if we're in the nanocoder workspace
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders) {
		for (const folder of workspaceFolders) {
			const localCliPath = path.join(folder.uri.fsPath, 'dist', 'cli.js');
			if (fs.existsSync(localCliPath)) {
				// Use node to run the local JS file
				return `node ${localCliPath}`;
			}
		}
	}

	// 3. Fallback to global PATH
	return new Promise((resolve) => {
		const command = process.platform === 'win32' ? 'where.exe nanocoder' : 'which nanocoder';
		
		cp.exec(command, (error, stdout) => {
			if (error || !stdout.trim()) {
				resolve(null);
			} else {
				const lines = stdout.trim().split('\n');
				resolve(lines[0].trim());
			}
		});
	});
}

export async function promptInstallCli(): Promise<void> {
	const action = await vscode.window.showErrorMessage(
		'Nanocoder CLI not found. The extension requires the nanocoder CLI to be installed.',
		'Install'
	);

	if (action === 'Install') {
		const terminal = vscode.window.createTerminal('Install Nanocoder');
		terminal.show();
		// Pre-populate with the installation command but let the user run it
		terminal.sendText('npm install -g @nanocollective/nanocoder', false);
	}
}
