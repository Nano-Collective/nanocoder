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

// Handle `nanocoder daemon <sub>` — fast path, only loads the daemon
// module graph (no Ink, no providers, no tool registry).
if (args[0] === 'daemon') {
	const sub = args[1];
	const valid = [
		'start',
		'stop',
		'status',
		'logs',
		'install',
		'uninstall',
	] as const;
	type DaemonSub = (typeof valid)[number];
	if (!sub || !(valid as readonly string[]).includes(sub)) {
		console.error(
			'Usage: nanocoder daemon <start|stop|status|logs|install|uninstall>',
		);
		process.exit(sub ? 1 : 0);
	}
	const {runDaemonCli} = await import('@/daemon/cli');
	const result = await runDaemonCli(sub as DaemonSub, {
		projectRoot: process.cwd(),
	});
	if (result.output) console.log(result.output);
	process.exit(result.exitCode);
}

// Handle --help/-h flag — fast path, no heavy imports
if (args.includes('--help') || args.includes('-h')) {
	console.log(`
Usage: nanocoder [options] [command]

Commands:
  copilot login [provider-name]   Log in to GitHub Copilot (device flow). Saves credentials for the "GitHub Copilot" provider.
  daemon <subcommand>             Manage the per-project skill daemon.
                                  Subcommands: start, stop, status, logs, install, uninstall.

Options:
  -v, --version       Show version number
  -h, --help          Show help
  --vscode            Run in VS Code mode
  --vscode-port       Specify VS Code port
  --provider          Specify AI provider (must be configured in agents.config.json)
  --model             Specify AI model (must be available for the provider)
  --context-max       Set maximum context length in tokens (supports k/K suffix, e.g. 128k)
  --mode              Start in a specific development mode (normal, auto-accept, yolo, plan).
                      Defaults to "normal" for interactive sessions and "auto-accept" for run mode.
  --trust-directory   Skip the first-run directory trust prompt for this run only.
                      Only valid with the "run" command. Does not modify the preferences file.
  --plain             Use a lightweight, Ink-free runtime for non-interactive runs.
                      Only valid with the "run" command. Auto-enables in CI / non-TTY.
  --no-plain          Force the Ink runtime even in CI / non-TTY environments.
  --json              Output execution results as a single well-formed JSON object to stdout.
                      Only valid with the "run" command.
  --output-format     Specify stdout format ('text' or 'json'). Synonym for --json.
  --acp               Run as an ACP (Agent Client Protocol) server for editor integration.
                      Communicates via JSON-RPC over stdin/stdout.
  run                 Run in non-interactive mode

Examples:
  nanocoder --provider openrouter --model google/gemini-3.1-flash run "analyze src/app.ts"
  nanocoder --provider ollama --model llama3.1 --context-max 128k
  nanocoder --mode yolo run "refactor database module"
  nanocoder --mode plan
  nanocoder --trust-directory run "analyze src/app.ts"
  nanocoder --plain run "summarize README.md"
  nanocoder --plain --json run "summarize README.md" | jq .finalText
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

	// Extract --mode if specified. Accept `--mode value` and `--mode=value`.
	const {VALID_MODES} = await import('@/app/types');
	type CliMode = (typeof VALID_MODES)[number];
	let cliMode: CliMode | undefined;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		let rawValue: string | undefined;
		if (arg === '--mode' && args[i + 1]) {
			rawValue = args[i + 1];
		} else if (arg.startsWith('--mode=')) {
			rawValue = arg.slice('--mode='.length);
		}
		if (rawValue === undefined) continue;
		if ((VALID_MODES as readonly string[]).includes(rawValue)) {
			cliMode = rawValue as CliMode;
		} else {
			console.error(
				`Invalid --mode value: "${rawValue}". Must be one of: ${VALID_MODES.join(', ')}`,
			);
			process.exit(1);
		}
		break;
	}

	// Extract --json or --output-format json. Accept spaced and fused formats.
	let outputFormat: 'text' | 'json' = 'text';
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--json') {
			outputFormat = 'json';
			break;
		} else if (arg === '--output-format' && args[i + 1]) {
			if (args[i + 1] === 'json') {
				outputFormat = 'json';
			} else if (args[i + 1] !== 'text') {
				console.error(
					`Invalid --output-format value: "${args[i + 1]}". Must be 'text' or 'json'.`,
				);
				process.exit(1);
			}
			break;
		} else if (arg.startsWith('--output-format=')) {
			const rawValue = arg.slice('--output-format='.length);
			if (rawValue === 'json') {
				outputFormat = 'json';
			} else if (rawValue !== 'text') {
				console.error(
					`Invalid --output-format value: "${rawValue}". Must be 'text' or 'json'.`,
				);
				process.exit(1);
			}
			break;
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
			} else if (arg === '--mode') {
				i++; // skip this flag and its value
				continue;
			} else if (arg.startsWith('--mode=')) {
				continue; // skip fused form
			} else if (arg === '--json') {
				continue; // skip this flag
			} else if (arg === '--output-format') {
				i++; // skip this flag and its value
				continue;
			} else if (arg.startsWith('--output-format=')) {
				continue; // skip fused form
			} else if (arg === '--trust-directory') {
				continue; // skip this flag
			} else if (arg === '--plain' || arg === '--no-plain') {
				continue; // skip this flag
			} else {
				promptArgs.push(arg);
			}
		}
		nonInteractivePrompt = promptArgs.join(' ');
	}

	const nonInteractiveMode = runCommandIndex !== -1;

	// Validate execution constraints for --json rules
	if (outputFormat === 'json' && !nonInteractiveMode) {
		console.error("Error: --json can only be used with the 'run' command.");
		process.exit(1);
	}

	// --trust-directory is only respected with `run`. Surface a warning
	// (rather than silently dropping) if the user passes it interactively.
	const trustDirectoryRequested = args.includes('--trust-directory');
	if (trustDirectoryRequested && !nonInteractiveMode) {
		console.error(
			'--trust-directory only applies to non-interactive mode (`nanocoder run ...`); ignoring.',
		);
	}
	const trustDirectory = trustDirectoryRequested && nonInteractiveMode;

	// --plain: lightweight, Ink-free runtime. Only valid with `run` in v1.
	// Auto-detect: enable when stdout isn't a TTY or the env looks like CI,
	// unless --no-plain forces the Ink path.
	const plainRequested = args.includes('--plain');
	const noPlainRequested = args.includes('--no-plain');
	if (plainRequested && noPlainRequested) {
		console.error('Cannot pass both --plain and --no-plain.');
		process.exit(1);
	}
	if (plainRequested && !nonInteractiveMode) {
		console.error(
			'--plain requires the `run` subcommand in this version. Try: nanocoder --plain run "..."',
		);
		process.exit(1);
	}
	if (plainRequested && vscodeMode) {
		console.error('Cannot combine --plain with --vscode.');
		process.exit(1);
	}

	// Enforce exclusive stdout protocol constraints
	if (outputFormat === 'json' && vscodeMode) {
		console.error('Error: --json cannot be combined with --vscode.');
		process.exit(1);
	}

	const ciDetected =
		process.env.CI === 'true' ||
		Boolean(
			process.env.GITHUB_ACTIONS ||
				process.env.GITLAB_CI ||
				process.env.BUILDKITE ||
				process.env.CIRCLECI ||
				process.env.JENKINS_URL,
		);
	const plainAuto =
		nonInteractiveMode &&
		!noPlainRequested &&
		!vscodeMode &&
		(!process.stdout.isTTY || ciDetected);
	const plainMode = plainRequested || plainAuto;

	// --acp: Agent Client Protocol server mode for editor integration
	const acpMode = args.includes('--acp');

	if (outputFormat === 'json' && acpMode) {
		console.error('Error: --json cannot be combined with --acp.');
		process.exit(1);
	}

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
	} else if (acpMode) {
		const {runAcpServer} = await import('@/acp/acp-server');
		await runAcpServer({cliProvider, cliModel, appVersion: version});
	} else if (plainMode && nonInteractivePrompt) {
		// Headless, Ink-free path. Note: --plain is currently only valid with
		// `run`, so we must have a non-empty prompt here.
		const {runPlainShell} = await import('@/plain/shell');
		await runPlainShell({
			prompt: nonInteractivePrompt,
			developmentMode: cliMode ?? 'auto-accept',
			cliProvider,
			cliModel,
			trustDirectory,
			outputFormat,
		});
	} else {
		// Prevent Node's global performance entry buffer from growing without
		// bound during long Ink sessions. See issue #521.
		const {installPerfBufferGuard} = await import('@/utils/perf-buffer');
		installPerfBufferGuard();
		render(
			<App
				vscodeMode={vscodeMode}
				vscodePort={vscodePort}
				nonInteractivePrompt={nonInteractivePrompt}
				nonInteractiveMode={nonInteractiveMode}
				cliProvider={cliProvider}
				cliModel={cliModel}
				cliMode={cliMode}
				trustDirectory={trustDirectory}
			/>,
		);
	}
}

main().catch(err => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
