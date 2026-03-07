#!/usr/bin/env node
import {render} from 'ink';
import {createRequire} from 'module';
import App from '@/app';

const require = createRequire(import.meta.url);
const {version} = require('../package.json');

// Parse CLI arguments
const args = process.argv.slice(2);

// Handle --version/-v flag
if (args.includes('--version') || args.includes('-v')) {
	console.log(version);
	process.exit(0);
}

// Handle --help/-h flag
if (args.includes('--help') || args.includes('-h')) {
	console.log(`
Usage: nanocoder [options] [command]

Commands:
  copilot login [provider-name]   Log in to GitHub Copilot (device flow). Saves credentials for the "GitHub Copilot" provider.

Options:
  -v, --version    Show version number
  -h, --help       Show help
  --vscode         Run in VS Code mode
  --vscode-port    Specify VS Code port
  run              Run in non-interactive mode
  `);
	process.exit(0);
}

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

// Handle copilot login from CLI (no App)
if (args[0] === 'copilot' && args[1] === 'login') {
	const providerName = args[2]?.trim() || 'GitHub Copilot';
	(async () => {
		try {
			const {runCopilotLoginFlow} = await import('@/auth/github-copilot');
			console.log('Starting GitHub Copilot login...');
			await runCopilotLoginFlow(providerName, {
				onShowCode(verificationUri, userCode) {
					console.log('');
					console.log('  1. Open this URL in your browser:');
					console.log('');
					console.log('     ' + verificationUri);
					console.log('');
					console.log('  2. Enter this code when prompted:');
					console.log('');
					console.log('     ' + userCode);
					console.log('');
					console.log('Waiting for you to complete login...');
				},
			});
			console.log('\nLogged in. Credential saved for "' + providerName + '".');
			process.exit(0);
		} catch (err) {
			console.error(err instanceof Error ? err.message : err);
			process.exit(1);
		}
	})();
} else {
	render(
		<App
			vscodeMode={vscodeMode}
			vscodePort={vscodePort}
			nonInteractivePrompt={nonInteractivePrompt}
			nonInteractiveMode={nonInteractiveMode}
		/>,
	);
}
