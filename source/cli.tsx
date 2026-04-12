#!/usr/bin/env node
// Suppress AI SDK warnings (e.g. unsupported features on reasoning models)
(globalThis as Record<string, unknown>).AI_SDK_LOG_WARNINGS = false;

// IMPORTANT: keep the top of this file free of heavy imports.
//
// The `--version` / `--help` flags are handled as a fast path that prints
// static text and exits before any React/Ink/tool/command/provider code is
// loaded. Adding a static `import` here would pull the entire app graph
// (~thousand+ modules via Ink + es-toolkit alone) into the fast path,
// defeating the purpose. Heavy imports live inside `main()` below and are
// pulled in via dynamic `await import()` only when the app actually boots.
import nodeModule from 'node:module';

// Enable V8 compile cache (Node 22.8+). After the first run, Node caches
// bytecode for every module on disk so subsequent launches skip parsing
// entirely. Degrades gracefully on older Node versions.
if (typeof nodeModule.enableCompileCache === 'function') {
	nodeModule.enableCompileCache();
}

const require = nodeModule.createRequire(import.meta.url);
const {version} = require('../package.json');

// Parse CLI arguments
const args = process.argv.slice(2);

// Handle --version/-v flag — fast path, no heavy imports
if (args.includes('--version') || args.includes('-v')) {
	console.log(version);
	process.exit(0);
}

// Handle --help/-h flag — fast path, no heavy imports
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
  --provider       Specify AI provider (must be configured in agents.config.json)
  --model          Specify AI model (must be available for the provider)
  --context-max    Set maximum context length in tokens (supports k/K suffix, e.g. 128k)
  run              Run in non-interactive mode

Examples:
  nanocoder --provider openrouter --model google/gemini-3.1-flash run "analyze src/app.ts"
  nanocoder --provider ollama --model llama3.1 --context-max 128k
  nanocoder run --provider openrouter "refactor database module"
  `);
	process.exit(0);
}

async function main(): Promise<void> {
	// Dynamic imports so the fast-path flag handlers above never pay for them.
	const [
		{render},
		{default: App},
		{parseContextLimit},
		{setSessionContextLimit},
	] = await Promise.all([
		import('ink'),
		import('@/app'),
		import('@/app/utils/handlers/context-max-handler'),
		import('@/models/index'),
	]);

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

	// Extract --provider if specified
	let cliProvider: string | undefined;
	const providerArgIndex = args.findIndex(arg => arg === '--provider');
	if (providerArgIndex !== -1 && args[providerArgIndex + 1]) {
		cliProvider = args[providerArgIndex + 1];
	}

	// Extract --model if specified
	let cliModel: string | undefined;
	const modelArgIndex = args.findIndex(arg => arg === '--model');
	if (modelArgIndex !== -1 && args[modelArgIndex + 1]) {
		cliModel = args[modelArgIndex + 1];
	}

	// Extract --context-max if specified
	const contextMaxArgIndex = args.findIndex(arg => arg === '--context-max');
	if (contextMaxArgIndex !== -1 && args[contextMaxArgIndex + 1]) {
		const limit = parseContextLimit(args[contextMaxArgIndex + 1]);
		if (limit !== null) {
			setSessionContextLimit(limit);
		} else {
			console.error(
				`Invalid --context-max value: "${args[contextMaxArgIndex + 1]}". Use a positive number, e.g. 8192 or 128k`,
			);
			process.exit(1);
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
		for (let i = 0; i < afterRunArgs.length; i++) {
			const arg = afterRunArgs[i];
			if (arg === '--vscode') {
				continue; // skip this flag
			} else if (arg === '--vscode-port') {
				i++; // skip this flag and its value
				continue;
			} else if (arg === '--provider') {
				i++; // skip this flag and its value
				continue;
			} else if (arg === '--model') {
				i++; // skip this flag and its value
				continue;
			} else if (arg === '--context-max') {
				i++; // skip this flag and its value
				continue;
			} else {
				promptArgs.push(arg);
			}
		}
		nonInteractivePrompt = promptArgs.join(' ');
	}

	const nonInteractiveMode = runCommandIndex !== -1;

	// Handle codex/copilot login from CLI (no App)
	if (args[0] === 'codex' && args[1] === 'login') {
		const providerName = args[2]?.trim() || 'ChatGPT';
		try {
			const {runCodexLoginFlow} = await import('@/auth/chatgpt-codex');
			console.log('Starting ChatGPT/Codex login...');
			await runCodexLoginFlow(providerName, {
				onShowCode(verificationUrl, userCode) {
					console.log('');
					console.log('  1. Open this URL in your browser:');
					console.log('');
					console.log('     ' + verificationUrl);
					console.log('');
					console.log('  2. Enter this code when prompted:');
					console.log('');
					console.log('     ' + userCode);
					console.log('');
					console.log('Waiting for you to complete login...');
				},
			});
			console.log('\nLogged in. Credentials saved for "' + providerName + '".');
			process.exit(0);
		} catch (err) {
			console.error(err instanceof Error ? err.message : err);
			process.exit(1);
		}
	} else if (args[0] === 'copilot' && args[1] === 'login') {
		const providerName = args[2]?.trim() || 'GitHub Copilot';
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
			console.log('\nLogged in. Credentials saved for "' + providerName + '".');
			process.exit(0);
		} catch (err) {
			console.error(err instanceof Error ? err.message : err);
			process.exit(1);
		}
	} else {
		render(
			<App
				vscodeMode={vscodeMode}
				vscodePort={vscodePort}
				nonInteractivePrompt={nonInteractivePrompt}
				nonInteractiveMode={nonInteractiveMode}
				cliProvider={cliProvider}
				cliModel={cliModel}
			/>,
		);
	}
}

main().catch(err => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
