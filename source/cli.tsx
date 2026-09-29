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
import {readFileSync} from 'node:fs';
import nodeModule from 'node:module';
import {parseRunPrompt} from './run-prompt-args.js';

// Enable V8 compile cache (Node 22.8+). After the first run, Node caches
// bytecode for every module on disk so subsequent launches skip parsing
// entirely. Degrades gracefully on older Node versions.
if (typeof nodeModule.enableCompileCache === 'function') {
	nodeModule.enableCompileCache();
}

const require = nodeModule.createRequire(import.meta.url);

// Resolved inline rather than through `@/utils/package-version` to keep the
// fast path import-free (see the note above). A missing or malformed
// package.json must not throw here: this runs at module load, before any
// error handling exists, so it would take the whole CLI down.
const version = ((): string => {
	try {
		const packageJson = require('../package.json') as {version?: unknown};
		return typeof packageJson.version === 'string' && packageJson.version
			? packageJson.version
			: 'unknown';
	} catch {
		return 'unknown';
	}
})();

// Parse CLI arguments
const args = process.argv.slice(2);

// Storage diagnostics are independent of chat startup. JSON mode does not load Ink.
if (args[0] === 'storage') {
	const {runStorageCli} = await import('@/storage/cli');
	const exitCode = await runStorageCli(args.slice(1));
	// process.exit() can discard buffered JSON when stdout is piped. Drain both
	// streams before terminating; the remaining CLI must not boot after storage.
	await Promise.all([
		new Promise<void>(resolve =>
			process.stdout.write('', 'utf8', () => resolve()),
		),
		new Promise<void>(resolve =>
			process.stderr.write('', 'utf8', () => resolve()),
		),
	]);
	process.exit(exitCode);
}

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
		trustDirectory: args.includes('--trust-directory'),
	});
	if (result.output) console.log(result.output);
	process.exit(result.exitCode);
}

// Handle `nanocoder skills <sub>` — fast path, only loads the skill
// installer (no Ink, no providers, no tool registry).
if (args[0] === 'skills') {
	const {runSkillsCli, SKILLS_CLI_USAGE} = await import('@/skills/install');
	if (args[1] !== 'add') {
		console.error(SKILLS_CLI_USAGE);
		process.exit(args[1] ? 1 : 0);
	}
	const result = await runSkillsCli({
		projectRoot: process.cwd(),
		args: args.slice(2),
	});
	if (result.output) {
		if (result.exitCode === 0) console.log(result.output);
		else console.error(result.output);
	}
	process.exit(result.exitCode);
}

// Handle `nanocoder config <sub>` — fast path. Resolving the effective
// config only needs the config module graph, not Ink or the tool registry.
if (args[0] === 'config') {
	const {runConfigCli} = await import('@/config/config-cli');
	const result = runConfigCli(args[1], args.slice(2));
	if (result.exitCode === 0) {
		console.log(result.output);
	} else {
		console.error(result.output);
	}
	process.exit(result.exitCode);
}

// Handle `nanocoder init` without booting the interactive app. The shared
// initializer is also used by /init, so both entry points keep identical file
// generation and overwrite behavior.
if (args[0] === 'init') {
	if (args.includes('--help') || args.includes('-h')) {
		console.log(`
Usage: nanocoder init [options]

Options:
  --preset <type>   Apply a bundled project preset (react, nextjs, rust)
  -f, --force       Regenerate AGENTS.md if it already exists
  --lean            Skip CLAUDE.md when merging existing project guidance
  -h, --help        Show help for the init command

Examples:
  nanocoder init
  nanocoder init --preset react
  nanocoder init --preset nextjs
  nanocoder init --preset rust
  `);
		process.exit(0);
	}

	const [{parseInitArguments}, initializer] = await Promise.all([
		import('@/init/init-args'),
		import('@/init/initializer'),
	]);
	try {
		const options = parseInitArguments(args.slice(1));
		const result = initializer.initializeProject({
			projectPath: process.cwd(),
			...options,
		});

		console.log('Nanocoder project initialized successfully.');
		if (result.preset) console.log(`Preset: ${result.preset}`);
		for (const file of result.created) console.log(`Created: ${file}`);
		for (const file of result.preserved) {
			console.log(`Preserved existing file: ${file}`);
		}
		process.exit(0);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Unknown initialization error';
		const suffix =
			error instanceof initializer.ProjectAlreadyInitializedError
				? ' Use nanocoder init --force to regenerate.'
				: '';
		console.error(`${message}${suffix}`);
		process.exit(1);
	}
}

// Handle `nanocoder completion <shell>` — fast path, prints a static
// completion script and exits without loading any app code. The shell
// argument is required so a missing argument fails loudly with usage
// instead of silently installing the wrong script.
if (args[0] === 'completion') {
	const {runCompletionCli} = await import('@/cli-completions/cli');
	const result = runCompletionCli(args.slice(1));
	if (result.output) {
		if (result.stream === 'stderr') {
			console.error(result.output);
		} else {
			console.log(result.output);
		}
	}
	process.exit(result.exitCode);
}

// Handle --help/-h flag — fast path, no heavy imports
if (args.includes('--help') || args.includes('-h')) {
	console.log(`
Usage: nanocoder [options] [command]

Commands:
  init [options]                  Analyze the project and create AGENTS.md.
                                  Use --preset <react|nextjs|rust> for bundled defaults.
  copilot login [provider-name]   Log in to GitHub Copilot (device flow). Saves credentials for the "GitHub Copilot" provider.
  codex login [provider-name]     Log in to ChatGPT/Codex (device flow). Saves credentials for the "ChatGPT" provider.
  review <branch|pr-number>       Review a branch or PR diff for bugs, security issues, and style violations.
  daemon <subcommand>             Manage the per-project skill daemon.
                                  Subcommands: start, stop, status, logs, install, uninstall.
                                  start refuses to run in an untrusted directory; pass
                                  --trust-directory to bypass the check for this run only.
  skills add <target>             Install a skill bundle from a git repository.
                                  <target> is an index name, owner/repo, a git URL, or a local path.
                                  Flags: --ref, --subdir, --global, --force, --yes, --index.
  config <subcommand>             Inspect the resolved configuration and where each value came from.
                                  Subcommands: list, show [key], diff. Add --json for machine output.
  storage [--format json]         Inspect session and artifact storage (read-only).
                                  Interactive by default; JSON works without a TTY.
  completion <shell>              Generate a shell completion script (bash, zsh, or fish).
                                  Example: eval "$(nanocoder completion zsh)"

Options:
  -v, --version       Show version number
  -h, --help          Show help
  --vscode            Run in VS Code mode
  --vscode-port       Specify VS Code port
  --provider          Specify AI provider (must be configured in agents.config.json).
                      Quote names with spaces: --provider "GitHub Copilot"
  --model             Specify AI model (must be available for the provider)
  --context-max       Set maximum context length in tokens (supports k/K suffix, e.g. 128k)
  --mode              Start in a specific development mode (normal, auto-accept, yolo, plan,
                      architect). Defaults to "normal" for interactive sessions and
                      "auto-accept" for run mode.
  --prompt-file       Read the run prompt from a file instead of the command
                      line. Necessary for large prompts: Linux caps a single
                      argument at 128 KiB and execve fails with E2BIG.
  --trust-directory   Skip the first-run directory trust prompt for this run only.
                      Valid with the "run" command and "daemon start". Does not modify
                      the preferences file.
  --plain             Use a lightweight, Ink-free runtime for non-interactive runs.
                      Only valid with the "run" command. Auto-enables in CI / non-TTY.
  --no-plain          Force the Ink runtime even in CI / non-TTY environments.
  --alt-screen        Fullscreen TUI on the alternate screen buffer with in-app
                      scrolling (mouse wheel / PgUp / PgDn). Enabled by default.
  --no-alt-screen     Disable fullscreen TUI and force inline mode (main screen,
                      chat history in the terminal's native scrollback).
  --mouse             Mouse wheel scrolls the chat viewport in fullscreen mode, with
                      Shift+drag (Option+drag in iTerm2) to select text. Enabled by default.
  --no-mouse          Disable mouse reporting in fullscreen mode: native text selection
                      works directly, but the wheel no longer scrolls chat history.
  --json              Output execution results as a single well-formed JSON object to stdout.
                      Only valid with the "run" command. Always uses the plain runtime.
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
  nanocoder init --preset nextjs
  nanocoder skills add pr-reviewer
  nanocoder skills add Nano-Collective/nanocoder-skills --subdir skills/pr-reviewer
  nanocoder --provider openrouter --model google/gemini-3.1-flash run "analyze src/app.ts"
  nanocoder --provider ollama --model llama3.1 --context-max 128k
  nanocoder --mode yolo run "refactor database module"
  nanocoder --mode plan
  nanocoder --trust-directory run "analyze src/app.ts"
  nanocoder --plain run "summarize README.md"
  nanocoder --plain --json run "summarize README.md" | jq .finalText
  nanocoder review main
  nanocoder review feature/auth
  nanocoder review 42
  nanocoder --continue
  nanocoder --resume last
  nanocoder --resume
  nanocoder storage
  nanocoder storage --format json | jq .sections
  `);
	process.exit(0);
}

// Validate output format value to prevent injection
function isValidOutputFormat(value: unknown): value is 'text' | 'json' {
	return value === 'text' || value === 'json';
}

async function main(): Promise<void> {
	// Parse args and dispatch non-TUI branches BEFORE importing ink or @/app.
	// Those packages pull ~thousand+ modules; --acp / --plain / auth must stay
	// on the lightweight path. Ink + App load only in the final TUI branch.

	const vscodeMode = args.includes('--vscode');

	// Extract VS Code port if specified
	let vscodePort: number | undefined;
	const portArgIndex = args.findIndex(
		arg => arg === '--vscode-port' || arg.startsWith('--vscode-port='),
	);
	const portValue =
		portArgIndex === -1
			? undefined
			: args[portArgIndex].startsWith('--vscode-port=')
				? args[portArgIndex].slice('--vscode-port='.length)
				: args[portArgIndex + 1];
	if (portValue) {
		const port = parseInt(portValue, 10);
		if (!isNaN(port) && port > 0 && port < 65536) {
			vscodePort = port;
		}
	}

	// Extract --provider if specified — validate against allowlist pattern
	let cliProvider: string | undefined;
	const providerArgIndex = args.findIndex(
		arg => arg === '--provider' || arg.startsWith('--provider='),
	);
	const providerValue =
		providerArgIndex === -1
			? undefined
			: args[providerArgIndex].startsWith('--provider=')
				? args[providerArgIndex].slice('--provider='.length)
				: args[providerArgIndex + 1];
	if (providerValue) {
		// Provider names are free-form in agents.config.json and the wizard's
		// defaults include spaces, dots, slashes and parentheses ("GitHub
		// Copilot", "llama.cpp server", "ChatGPT / Codex"). Allow those, but
		// still refuse control characters and shell-ish punctuation.
		const value = providerValue;
		if (/^[a-zA-Z0-9 _./():+@-]+$/.test(value) && value.trim() !== '') {
			cliProvider = value.trim();
		} else {
			console.error(
				`Invalid --provider value: "${value}". Provider name may contain letters, digits, spaces and _ . / ( ) : + @ - only. Quote names with spaces, e.g. --provider "GitHub Copilot".`,
			);
			process.exit(1);
		}
	}

	// Extract --model if specified — validate against allowlist pattern
	let cliModel: string | undefined;
	const modelArgIndex = args.findIndex(
		arg => arg === '--model' || arg.startsWith('--model='),
	);
	const modelValue =
		modelArgIndex === -1
			? undefined
			: args[modelArgIndex].startsWith('--model=')
				? args[modelArgIndex].slice('--model='.length)
				: args[modelArgIndex + 1];
	if (modelValue) {
		// Allow alphanumeric, hyphen, underscore, dot, slash, colon, @ and + for
		// model ids like "claude-3.5-sonnet", "qwen2.5:7b" or "model@2024+beta"
		const value = modelValue;
		if (/^[a-zA-Z0-9_/.:@+-]+$/.test(value)) {
			cliModel = value;
		} else {
			console.error(
				`Invalid --model value: "${value}". Model name must contain only alphanumeric characters and - _ . / : @ +`,
			);
			process.exit(1);
		}
	}

	// Extract --context-max if specified (framework-free parser — no React/Ink)
	const contextMaxArgIndex = args.findIndex(
		arg => arg === '--context-max' || arg.startsWith('--context-max='),
	);
	const contextMaxValue =
		contextMaxArgIndex === -1
			? undefined
			: args[contextMaxArgIndex].startsWith('--context-max=')
				? args[contextMaxArgIndex].slice('--context-max='.length)
				: args[contextMaxArgIndex + 1];
	if (contextMaxValue) {
		const [{parseContextLimit}, {setSessionContextLimit}] = await Promise.all([
			import('@/utils/parse-context-limit'),
			import('@/models/index'),
		]);
		const limit = parseContextLimit(contextMaxValue);
		if (limit !== null) {
			setSessionContextLimit(limit);
		} else {
			console.error(
				`Invalid --context-max value: "${contextMaxValue}". Use a positive number, e.g. 8192 or 128k`,
			);
			process.exit(1);
		}
	}

	// Extract --mode if specified. Accept `--mode value` and `--mode=value`.
	// `@/app/types` is a tiny const module (no React/Ink) — safe before TUI.
	const {VALID_MODES} = await import('@/app/types');
	type CliMode = (typeof VALID_MODES)[number];
	let cliMode: CliMode | undefined;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		let rawValue: string | undefined;
		if (arg === '--mode') {
			rawValue = args[i + 1];
			if (!rawValue || rawValue.startsWith('-')) {
				console.error(
					`--mode requires a value. Must be one of: ${VALID_MODES.join(', ')}`,
				);
				process.exit(1);
			}
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

	// Check for non-interactive mode (run command). The filtering lives in
	// ./run-prompt-args so it exists exactly once — a hand-written copy of it
	// in cli.spec.ts had drifted six flags behind this.
	const runCommandIndex = args.indexOf('run');
	const isRunCommand = runCommandIndex !== -1;
	let nonInteractivePrompt = parseRunPrompt(args);

	// --prompt-file: read the prompt from a file rather than argv.
	//
	// Linux caps a *single* argv entry at MAX_ARG_STRLEN (32 pages = 131072
	// bytes), independently of the much larger ARG_MAX total, and execve fails
	// with E2BIG before the process starts. macOS has no equivalent per-argument
	// cap, so a caller that assembles a large prompt — anything that embeds file
	// contents — works in local testing and then cannot spawn at all on a Linux
	// CI runner. A file has no such ceiling.
	//
	// Takes precedence over a positional prompt: passing both is a caller bug,
	// and the file is the one that was asked for explicitly.
	const promptFileIndex = args.findIndex(
		arg => arg === '--prompt-file' || arg.startsWith('--prompt-file='),
	);
	const promptFile =
		promptFileIndex === -1
			? undefined
			: args[promptFileIndex].startsWith('--prompt-file=')
				? args[promptFileIndex].slice('--prompt-file='.length)
				: args[promptFileIndex + 1];
	if (promptFile !== undefined) {
		if (runCommandIndex === -1) {
			console.error('--prompt-file only applies to `nanocoder run`.');
			process.exit(1);
		}
		try {
			nonInteractivePrompt = readFileSync(promptFile, 'utf8');
		} catch (error) {
			console.error(
				`Could not read --prompt-file "${promptFile}": ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			process.exit(1);
		}
	}

	let nonInteractiveMode = isRunCommand;

	// Check for `nanocoder review <target>` — syntactic sugar for
	// `nanocoder run /review <target>`. The target is the branch or PR number
	// to review. Flags between `review` and the target are filtered the same
	// way as `run`. Lazy-loaded to keep it off the lightweight path.
	let isReviewCommand = false;
	let reviewPrompt: string | undefined;
	if (args[0] === 'review') {
		const {parseReviewCliArgs} = await import('./commands/review-cli');
		const result = parseReviewCliArgs(args);
		isReviewCommand = result.isReviewCommand;
		reviewPrompt = result.prompt;
		if (result.error) {
			console.error(`Error: ${result.error}`);
			process.exit(1);
		}
	}

	if (isRunCommand && isReviewCommand) {
		console.error('Cannot use both `run` and `review` in the same invocation.');
		process.exit(1);
	}

	if (isReviewCommand) {
		nonInteractivePrompt = reviewPrompt;
		nonInteractiveMode = true;
	}

	// `run` with nothing to run is a usage error on every runtime. Without this
	// the Ink branch was taken (the plain branch needs a prompt), which under
	// --plain or a non-TTY crashed on raw-mode stdin instead of explaining.
	if (isRunCommand && !nonInteractivePrompt?.trim()) {
		console.error(
			'`nanocoder run` needs a prompt. Try: nanocoder run "your task" or nanocoder run --prompt-file <path>',
		);
		process.exit(1);
	}

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
	// (rather than silently dropping) if the user passes it interactively
	// or with `review` (review is TTY-only but sets nonInteractiveMode).
	const trustDirectoryRequested = args.includes('--trust-directory');
	if (trustDirectoryRequested && !isRunCommand) {
		console.error(
			'--trust-directory only applies to non-interactive mode (`nanocoder run ...`); ignoring.',
		);
	}
	const trustDirectory = trustDirectoryRequested && isRunCommand;

	// --plain: lightweight, Ink-free runtime. Only valid with `run` in v1.
	// Auto-detect: enable when stdout isn't a TTY or the env looks like CI,
	// unless --no-plain forces the Ink path.
	const plainRequested = args.includes('--plain');
	const noPlainRequested = args.includes('--no-plain');
	if (plainRequested && noPlainRequested) {
		console.error('Cannot pass both --plain and --no-plain.');
		process.exit(1);
	}
	if (plainRequested && !isRunCommand) {
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

	if (outputFormat === 'json' && isReviewCommand) {
		console.error(
			'Error: --json cannot be used with `nanocoder review`. Review output is displayed in the interactive terminal.',
		);
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
		isRunCommand &&
		!noPlainRequested &&
		!vscodeMode &&
		(!process.stdout.isTTY || ciDetected);
	// --json is a plain-shell protocol: the Ink runtime has no JSON output, so
	// honouring the flag means taking the plain path even in a real terminal.
	if (outputFormat === 'json' && isRunCommand && noPlainRequested) {
		console.error(
			'Error: --json needs the plain shell and cannot be combined with --no-plain.',
		);
		process.exit(1);
	}
	const plainForJson = outputFormat === 'json' && isRunCommand;
	const plainMode = plainRequested || plainAuto || plainForJson;

	// Hard-error when `review` lands in a non-interactive context (piped
	// stdout, CI). The plain shell has no slash-command dispatch, so
	// `/review <target>` would be sent verbatim to the model as chat.
	if (isReviewCommand && !process.stdout.isTTY) {
		console.error(
			'Error: `nanocoder review` requires an interactive terminal (TTY).',
		);
		process.exit(1);
	}

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
		// Interactive TUI — load Ink + App only now.
		const [{render}, {default: App}] = await Promise.all([
			import('ink'),
			import('@/app'),
		]);

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
		// Screen mode: fullscreen (alt screen + in-app scroll) by DEFAULT.
		// Passing --no-alt-screen or setting alternateScreen:false in preferences
		// forces inline mode (main screen + native scrollback).
		const {getAlternateScreen, getMouseReporting} = await import(
			'@/config/preferences'
		);
		const altScreenAllowed =
			!args.includes('--no-alt-screen') &&
			(args.includes('--alt-screen') || getAlternateScreen());
		const useAltScreen =
			process.stdout.isTTY && !nonInteractiveMode && altScreenAllowed;
		const mouseReportingAllowed =
			!args.includes('--no-mouse') &&
			(args.includes('--mouse') || getMouseReporting());
		const useMouseReporting = useAltScreen && mouseReportingAllowed;
		// The stdin proxy below is needed in BOTH screen modes, because
		// bracketed paste applies to both — only mouse reporting is
		// fullscreen-only.
		const interactiveTty = process.stdout.isTTY && !nonInteractiveMode;
		let inkStdin: NodeJS.ReadStream | undefined;
		let stopInputForwarding: (() => void) | undefined;
		let restoreInputModes: (() => void) | undefined;
		if (useAltScreen) {
			process.stdout.write('\x1B[?1049h'); // Enter alternate screen

			// Wipe the screen on resize BEFORE Ink repaints (this listener is
			// registered first, so it runs first). When the terminal GROWS,
			// Ink's diff path only erases the old smaller frame and rewrites
			// from a misaligned cursor, leaving stale rows on screen. A clear
			// + home makes the next full-frame paint land on a clean buffer.
			process.stdout.on('resize', () => {
				process.stdout.write('\x1B[2J\x1B[H');
			});
		}
		if (interactiveTty) {
			const {
				ALTERNATE_SCROLL_OFF,
				ALTERNATE_SCROLL_ON,
				createUtf8InputDecoder,
				MOUSE_REPORTING_OFF,
				MOUSE_REPORTING_ON,
				stripMouseSequences,
				wheelEvents,
			} = await import('@/utils/terminal-mouse');
			const {
				createPasteExtractor,
				DISABLE_BRACKETED_PASTE,
				ENABLE_BRACKETED_PASTE,
				pasteEvents,
			} = await import('@/utils/terminal-paste');
			const {splitControlKeypresses} = await import(
				'@/utils/terminal-keypress'
			);

			// Bracketed paste in both screen modes. Without it the terminal
			// sends a paste as bare bytes, so the CR at each line break
			// reaches Ink as Enter and submits the prompt partway through.
			process.stdout.write(ENABLE_BRACKETED_PASTE);
			// Leaving it on would make the shell that inherits this terminal
			// receive paste markers as literal text.
			restoreInputModes = () => {
				process.stdout.write(DISABLE_BRACKETED_PASTE);
				if (useAltScreen) {
					process.stdout.write(
						useMouseReporting ? MOUSE_REPORTING_OFF : ALTERNATE_SCROLL_ON,
					);
				}
			};

			if (useAltScreen) {
				if (useMouseReporting) {
					// SGR mouse reporting so wheel scrolling reaches the app. The
					// alt screen has no native scrollback, so the terminal's own
					// wheel / scrollbar can't work — the app must receive wheel
					// events itself. Text selection then needs Shift+drag
					// (Option+drag in iTerm2).
					process.stdout.write(MOUSE_REPORTING_ON);
				} else {
					// Native text selection is opted into, so nothing consumes
					// wheel ticks — stop the terminal turning them into arrow
					// keys that would cycle prompt history.
					process.stdout.write(ALTERNATE_SCROLL_OFF);
				}
			}

			// Ink must never see the raw escape sequences (its keypress
			// parser would leak them into the chat input as text, and a
			// pasted newline would submit), so it reads from a filtered proxy
			// stream. Paste payloads are lifted out first and republished on
			// pasteEvents; mouse reports are then stripped from what's left,
			// with wheel ticks re-emitted on wheelEvents for the viewport.
			const {PassThrough} = await import('node:stream');
			const filtered = new PassThrough();
			const decodeInput = createUtf8InputDecoder();
			const extractPastes = createPasteExtractor();
			let carry = '';
			const forwardInput = (chunk: Buffer | string) => {
				const text = decodeInput(chunk);
				const split = extractPastes(text);
				for (const payload of split.pastes) {
					pasteEvents.emit('paste', payload);
				}
				const result = stripMouseSequences(split.clean, carry);
				carry = result.carry;
				for (const direction of result.wheel) {
					wheelEvents.emit('wheel', direction);
				}
				if (result.clean) {
					queueKeypresses(splitControlKeypresses(result.clean));
				}
			};
			// Ink drains everything buffered on each 'readable', so pieces
			// written back to back would merge again. Its 'readable' fires on
			// a nextTick, so writing one piece per setImmediate hands it each
			// piece as a separate read, in order.
			const pendingKeypresses: string[] = [];
			let drainScheduled = false;
			const drainKeypresses = () => {
				const next = pendingKeypresses.shift();
				if (next === undefined) {
					drainScheduled = false;
					return;
				}
				filtered.write(next);
				setImmediate(drainKeypresses);
			};
			const queueKeypresses = (pieces: string[]) => {
				pendingKeypresses.push(...pieces);
				if (!drainScheduled) {
					drainScheduled = true;
					drainKeypresses();
				}
			};
			process.stdin.on('data', forwardInput);
			stopInputForwarding = () => {
				pendingKeypresses.length = 0;
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
			restoreInputModes?.();
			if (useAltScreen) {
				if (useMouseReporting) {
					// Mouse reporting off
					process.stdout.write('\x1B[?1006l\x1B[?1000l');
				}
				// Back to the main screen buffer
				process.stdout.write('\x1B[?1049l');
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
