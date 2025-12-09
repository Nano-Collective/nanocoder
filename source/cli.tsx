#!/usr/bin/env node
import {render} from 'ink';
import App from '@/app';

// Parse CLI arguments
const args = process.argv.slice(2);
const vscodeMode = args.includes('--vscode');

// Extract VS Code port if specified
let vscodePort: number | undefined;
const portArgIndex = args.findIndex(arg => arg === '--vscode-port');
if (portArgIndex !== -1 && args[portArgIndex + 1]) {
	const port = parseInt(args[portArgIndex + 1], 10);
	if (!isNaN(port) && port > 0 && port < 65536) {
		vscodePort = port;
	}
}

// Check for non-interactive mode (run command)
let nonInteractivePrompt: string | undefined;
const runCommandIndex = args.findIndex(arg => arg === 'run');
const afterRunArgs =
	runCommandIndex !== -1 ? args.slice(runCommandIndex + 1) : [];
if (runCommandIndex !== -1 && args[runCommandIndex + 1]) {
	// Filter out known flags after 'run' when constructing the prompt
	const promptArgs: string[] = [];
	const _knownFlags = new Set(['--vscode', '--vscode-port']);
	for (let i = 0; i < afterRunArgs.length; i++) {
		const arg = afterRunArgs[i];
		if (arg === '--vscode') {
			continue; // skip this flag
		} else if (arg === '--vscode-port') {
			i++; // skip this flag and its value
			continue;
		} else {
			promptArgs.push(arg);
		}
	}
	nonInteractivePrompt = promptArgs.join(' ');
}

const nonInteractiveMode = runCommandIndex !== -1;

render(
	<App
		vscodeMode={vscodeMode}
		vscodePort={vscodePort}
		nonInteractivePrompt={nonInteractivePrompt}
		nonInteractiveMode={nonInteractiveMode}
	/>,
);
