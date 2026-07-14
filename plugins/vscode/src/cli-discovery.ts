import * as vscode from 'vscode';
import * as cp from 'child_process';

export async function findCliPath(): Promise<string | null> {
	return new Promise((resolve) => {
		// Attempt to run `nanocoder --version` to see if it exists in PATH
		const command = process.platform === 'win32' ? 'where.exe nanocoder' : 'which nanocoder';
		
		cp.exec(command, (error, stdout) => {
			if (error || !stdout.trim()) {
				// We can try to fall back to typical global install paths if we want,
				// but 'nanocoder' should be in the PATH if installed properly.
				resolve(null);
			} else {
				// Get the first result if there are multiple (more common on Windows)
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
