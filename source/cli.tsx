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
import type {WebRuntimeBridge} from '@/web/runtime-bridge';

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
const webMode = args.includes('--web') || args.includes('--gui');

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
  --web, --gui        Start local browser-based web mode
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
  --alt-screen        Fullscreen TUI on the alternate screen buffer with in-app
                      scrolling (mouse wheel / PgUp / PgDn). Persistent version:
                      "alternateScreen": true in preferences.json.
  --no-alt-screen     Force the default inline mode (main screen, chat history in
                      the terminal's native scrollback), overriding the preference.
  --json              Output execution results as a single well-formed JSON object to stdout.
                      Only valid with the "run" command.
  --output-format     Specify stdout format ('text' or 'json'). Synonym for --json.
  --acp               Run as an ACP (Agent Client Protocol) server for editor integration.
                      Communicates via JSON-RPC over stdin/stdout.
  -c, --continue      Resume the most recent session for the current directory, silently.
                      Starts a fresh session if none exists. Interactive mode only.
  -r, --resume [id]   Resume a session by id or 1-based list index (e.g. "last", "2",
                      or a session uuid). With no id, opens the session picker at
                      startup. Mutually exclusive with --continue. Interactive mode only.
  run                 Run in non-interactive mode

Examples:
  nanocoder --provider openrouter --model google/gemini-3.1-flash run "analyze src/app.ts"
  nanocoder --provider ollama --model llama3.1 --context-max 128k
  nanocoder --web
  nanocoder --gui
  nanocoder --mode yolo run "refactor database module"
  nanocoder --mode plan
  nanocoder --trust-directory run "analyze src/app.ts"
  nanocoder --plain run "summarize README.md"
  nanocoder --plain --json run "summarize README.md" | jq .finalText
  nanocoder --continue
  nanocoder --resume last
  nanocoder --resume
  `);
	process.exit(0);
}

// Validate output format value to prevent injection
function isValidOutputFormat(value: unknown): value is 'text' | 'json' {
	return value === 'text' || value === 'json';
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

	// Extract --provider if specified — validate against allowlist pattern
	let cliProvider: string | undefined;
	const providerArgIndex = args.findIndex(arg => arg === '--provider');
	if (providerArgIndex !== -1 && args[providerArgIndex + 1]) {
		// Allow alphanumeric, hyphen, underscore only to prevent injection
		const value = args[providerArgIndex + 1];
		if (/^[a-zA-Z0-9_-]+$/.test(value)) {
			cliProvider = value;
		} else {
			console.error(
				`Invalid --provider value: "${value}". Provider name must contain only alphanumeric characters, hyphens, and underscores.`,
			);
			process.exit(1);
		}
	}

	// Extract --model if specified — validate against allowlist pattern
	let cliModel: string | undefined;
	const modelArgIndex = args.findIndex(arg => arg === '--model');
	if (modelArgIndex !== -1 && args[modelArgIndex + 1]) {
		// Allow alphanumeric, hyphen, underscore, dot, slash for model names like "claude-3.5-sonnet"
		const value = args[modelArgIndex + 1];
		if (/^[a-zA-Z0-9_/.:-]+$/.test(value)) {
			cliModel = value;
		} else {
			console.error(
				`Invalid --model value: "${value}". Model name must contain only alphanumeric characters, hyphens, underscores, dots, and slashes.`,
			);
			process.exit(1);
		}
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
			const value = args[i + 1];
			if (!isValidOutputFormat(value)) {
				console.error(
					`Invalid --output-format value: "${value}". Must be 'text' or 'json'.`,
				);
				process.exit(1);
			}
			outputFormat = value;
			break;
		} else if (arg.startsWith('--output-format=')) {
			const rawValue = arg.slice('--output-format='.length);
			if (!isValidOutputFormat(rawValue)) {
				console.error(
					`Invalid --output-format value: "${rawValue}". Must be 'text' or 'json'.`,
				);
				process.exit(1);
			}
			outputFormat = rawValue;
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
			} else if (arg === '--no-alt-screen' || arg === '--alt-screen') {
				continue; // skip this flag
			} else if (arg === '--web' || arg === '--gui') {
				continue; // skip this flag
			} else {
				promptArgs.push(arg);
			}
		}
		nonInteractivePrompt = promptArgs.join(' ');
	}

	const nonInteractiveMode = runCommandIndex !== -1;

	// --continue/-c and --resume/-r: session resume flags for the interactive
	// TUI only (mirrors Claude Code's -c/-r). Mutually exclusive.
	const continueRequested = args.includes('--continue') || args.includes('-c');
	const resumeFlagIndex = args.findIndex(
		arg => arg === '--resume' || arg === '-r',
	);
	const resumeRequested = resumeFlagIndex !== -1;

	if (continueRequested && resumeRequested) {
		console.error('Cannot pass both --continue and --resume.');
		process.exit(1);
	}

	// A bare --resume (no id) opens the session picker at startup. Only treat
	// the next token as an id/index if it isn't another flag or `run`.
	let resumeArg: string | undefined;
	if (resumeRequested) {
		const next = args[resumeFlagIndex + 1];
		if (next && !next.startsWith('-') && next !== 'run') {
			resumeArg = next;
		}
	}

	if ((continueRequested || resumeRequested) && nonInteractiveMode) {
		console.error(
			'--continue/-c and --resume/-r are only supported for the interactive session (not with `run`).',
		);
		process.exit(1);
	}

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

		// Resolve --continue/--resume <id> into a Session BEFORE rendering, so
		// the app can apply it on first mount (see App's initialSession prop).
		// A bare --resume (no id) instead opens the picker at startup — no
		// resolution needed here.
		let initialSession: import('@/session/session-manager').Session | undefined;
		const openSessionSelectorOnStart = resumeRequested && !resumeArg;
		if (continueRequested || resumeRequested) {
			const {sessionManager} = await import('@/session/session-manager');
			try {
				await sessionManager.initialize();
			} catch (error) {
				console.error(
					`Failed to initialize sessions: ${error instanceof Error ? error.message : error}`,
				);
				process.exit(1);
			}
		}
		if (continueRequested || (resumeRequested && resumeArg)) {
			const {resolveSession} = await import('@/session/resolve-session');

			if (continueRequested) {
				const outcome = await resolveSession('last', process.cwd());
				if (outcome.ok) {
					initialSession = outcome.session;
				} else {
					console.log(
						'No previous session found for this directory — starting fresh.',
					);
				}
			} else {
				const outcome = await resolveSession(resumeArg, process.cwd());
				if (!outcome.ok) {
					console.error(outcome.message);
					process.exit(1);
				}
				initialSession = outcome.session;
			}
		}

		// Switch to alternate screen buffer (like vim/less/htop) for the
		// interactive TUI only. Run mode (`nanocoder run …`) prints a
		// transcript the user needs to keep after exit — the alt screen
		// would discard it when restoring the original buffer.
		// Screen mode: inline (main screen + native scrollback) by DEFAULT —
		// the terminal's own scrollbar, wheel, and search work there.
		// Fullscreen (alt screen + in-app scroll) is opt-in via --alt-screen
		// or the alternateScreen:true preference; --no-alt-screen forces
		// inline regardless of the preference.
		const {loadPreferences} = await import('@/config/preferences');
		const altScreenAllowed =
			!args.includes('--no-alt-screen') &&
			(args.includes('--alt-screen') ||
				loadPreferences().alternateScreen === true);
		const useAltScreen =
			process.stdout.isTTY && !nonInteractiveMode && altScreenAllowed;
		let inkStdin: NodeJS.ReadStream | undefined;
		let stopInputForwarding: (() => void) | undefined;
		if (useAltScreen) {
			process.stdout.write('\x1B[?1049h'); // Enter alternate screen
			// SGR mouse reporting so wheel scrolling reaches the app. The alt
			// screen has no native scrollback, so the terminal's own wheel /
			// scrollbar can't work — the app must receive wheel events itself.
			// (Text selection needs Shift+drag while mouse reporting is on.)
			process.stdout.write('\x1B[?1000h\x1B[?1006h');

			// Wipe the screen on resize BEFORE Ink repaints (this listener is
			// registered first, so it runs first). When the terminal GROWS,
			// Ink's diff path only erases the old smaller frame and rewrites
			// from a misaligned cursor, leaving stale rows on screen. A clear
			// + home makes the next full-frame paint land on a clean buffer.
			process.stdout.on('resize', () => {
				process.stdout.write('\x1B[2J\x1B[H');
			});

			// Ink must never see the raw mouse sequences (its keypress parser
			// would leak them into the chat input as text), so it reads from a
			// filtered proxy stream: mouse reports are stripped, wheel ticks
			// are re-emitted on the wheelEvents bus for the chat viewport.
			const {PassThrough} = await import('node:stream');
			const {stripMouseSequences, wheelEvents} = await import(
				'@/utils/terminal-mouse'
			);
			const filtered = new PassThrough();
			let carry = '';
			const forwardInput = (chunk: Buffer | string) => {
				const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
				const result = stripMouseSequences(text, carry);
				carry = result.carry;
				for (const direction of result.wheel) {
					wheelEvents.emit('wheel', direction);
				}
				if (result.clean) {
					filtered.write(result.clean);
				}
			};
			process.stdin.on('data', forwardInput);
			stopInputForwarding = () => {
				process.stdin.off('data', forwardInput);
				process.stdin.pause();
			};
			// TTY facade: Ink checks isTTY for raw-mode support and calls
			// setRawMode/ref/unref — delegate those to the real stdin.
			inkStdin = Object.assign(filtered, {
				isTTY: true,
				setRawMode: (mode: boolean) => {
					process.stdin.setRawMode?.(mode);
					return inkStdin;
				},
				ref: () => process.stdin.ref(),
				unref: () => process.stdin.unref(),
			}) as unknown as NodeJS.ReadStream;
		}

		let webRuntimeBridge: WebRuntimeBridge | undefined;
		if (webMode) {
			const [
				{createWebRuntimeBridge},
				{startLocalWebServer},
				{getShutdownManager},
			] = await Promise.all([
				import('@/web/runtime-bridge'),
				import('@/web/server'),
				import('@/utils/shutdown'),
			]);
			let broadcastEvent: Parameters<typeof createWebRuntimeBridge>[0] =
				() => {};
			webRuntimeBridge = createWebRuntimeBridge(event => {
				broadcastEvent(event);
			});
			const webServer = await startLocalWebServer({
				onClientEvent: webRuntimeBridge.handleClientEvent,
			});
			broadcastEvent = webServer.broadcastEvent;

			getShutdownManager().register({
				name: 'web-server',
				priority: 10,
				handler: webServer.close,
			});

			console.log('Nanocoder web mode started.');
			console.log(`Local URL: ${webServer.url}`);
			console.log('Press Ctrl+C to stop.');
		}

		const result = render(
			<App
				vscodeMode={vscodeMode}
				vscodePort={vscodePort}
				nonInteractivePrompt={nonInteractivePrompt}
				nonInteractiveMode={nonInteractiveMode}
				cliProvider={cliProvider}
				cliModel={cliModel}
				cliMode={cliMode}
				trustDirectory={trustDirectory}
				altScreenActive={useAltScreen}
				initialSession={initialSession}
				openSessionSelectorOnStart={openSessionSelectorOnStart}
				webRuntimeBridge={webRuntimeBridge}
			/>,
			{
				// Ctrl+C is handled inside App (routed through the shutdown
				// manager) so the exit-render handler below can paint the
				// farewell frame before the process dies.
				exitOnCtrlC: false,
				...(inkStdin ? {stdin: inkStdin} : {}),
			},
		);

		let terminalRestored = false;
		const restoreTerminal = () => {
			if (terminalRestored) return;
			terminalRestored = true;
			stopInputForwarding?.();
			if (useAltScreen) {
				// Mouse reporting off, then back to the main screen buffer.
				process.stdout.write('\x1B[?1006l\x1B[?1000l\x1B[?1049l');
			}
		};

		// On ANY graceful shutdown (Ctrl+C, /exit, fatal error): erase the
		// live Ink region (input box, status lines — the Static transcript
		// stays in the terminal), stop Ink from repainting, restore the
		// screen mode, and leave a simple farewell. clear() BEFORE unmount()
		// is deliberate: clear syncs the erased frame as current so
		// unmount's final render skips rewriting it, and unmount prevents
		// any late React state update (e.g. /exit's Goodbye message) from
		// repainting over the farewell. Priority 0 = runs before other
		// teardown.
		const {getShutdownManager} = await import('@/utils/shutdown');
		getShutdownManager().register({
			name: 'tui-exit-render',
			priority: 0,
			handler: async () => {
				result.clear();
				result.unmount();
				restoreTerminal();
				process.stdout.write('Exiting...\n');
			},
		});

		// Fallback restore for exit paths that bypass the shutdown manager
		// (idempotent — the shutdown handler above usually runs first).
		result.waitUntilExit().then(() => {
			restoreTerminal();
		});
	}
}

main().catch(err => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
