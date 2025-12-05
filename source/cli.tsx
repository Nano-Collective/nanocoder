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
if (runCommandIndex !== -1 && args[runCommandIndex + 1]) {
	// Join all remaining args after 'run' as the prompt
	nonInteractivePrompt = args.slice(runCommandIndex + 1).join(' ');
}

render(
	<App
		vscodeMode={vscodeMode}
		vscodePort={vscodePort}
		nonInteractivePrompt={nonInteractivePrompt}
	/>,
);
