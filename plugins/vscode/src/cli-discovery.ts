import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { discoverCliPath, nodeExistsAlongside } from './cli-path-discovery';

export { nodeExistsAlongside };

let cachedShellPath: string | null | undefined;

/**
 * GUI-launched VS Code inherits launchd's minimal PATH, which can resolve an
 * old system node for the CLI's shebang (or for the `node dist/cli.js` dev
 * fallback) and crash the ACP process on startup. Ask the user's interactive
 * login shell for its PATH so version managers like nvm are included.
 */
export async function resolveShellPath(): Promise<string> {
	if (cachedShellPath === undefined) {
		cachedShellPath = await new Promise<string | null>((resolve) => {
			if (process.platform === 'win32') {
				resolve(null);
				return;
			}
			const shell = process.env.SHELL || '/bin/zsh';
			// -i so rc files run (nvm is typically initialised in .zshrc/.bashrc);
			// markers guard against rc files printing their own output.
			cp.execFile(shell, ['-ilc', 'command printf "__NANO_PATH__%s__NANO_PATH__" "$PATH"'], {timeout: 5000}, (error, stdout) => {
				const match = !error && stdout ? stdout.match(/__NANO_PATH__(.*?)__NANO_PATH__/s) : null;
				resolve(match?.[1] || null);
			});
		});
	}
	return cachedShellPath || process.env.PATH || '';
}

/** Environment for spawning the CLI, with PATH taken from the login shell. */
export async function resolveSpawnEnv(): Promise<NodeJS.ProcessEnv> {
	return {...process.env, PATH: await resolveShellPath()};
}

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

	// 3 & 4. Try which/where with the login-shell PATH; fall back to common
	// global installation directories (nvm, volta, fnm, pnpm, bun…).
	const env = await resolveSpawnEnv();
	return discoverCliPath(env);
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
