import test from 'ava';

// Test CLI argument parsing for non-interactive mode
// These tests verify that the CLI correctly parses the 'run' command

// Helper function to parse prompt from args (mimics the logic in cli.tsx)
function parsePrompt(args: string[]): string | undefined {
	const runCommandIndex = args.findIndex(arg => arg === 'run');
	if (runCommandIndex !== -1 && args[runCommandIndex + 1]) {
		// Filter out known flags after 'run' when constructing the prompt
		const promptArgs: string[] = [];
		const afterRunArgs = args.slice(runCommandIndex + 1);
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
			} else if (arg === '--plain' || arg === '--no-plain') {
				continue; // skip this flag
			} else {
				promptArgs.push(arg);
			}
		}
		return promptArgs.join(' ');
	}
	return undefined;
}

test('CLI parsing: detects run command with single word prompt', t => {
	const args = ['run', 'help'];
	const prompt = parsePrompt(args);

	t.is(prompt, 'help');
});

test('CLI parsing: detects run command with multi-word prompt', t => {
	const args = ['run', 'tell', 'agent', 'what', 'to', 'do'];
	const prompt = parsePrompt(args);

	t.is(prompt, 'tell agent what to do');
});

test('CLI parsing: detects run command with quoted prompt', t => {
	const args = ['run', 'tell agent what to do'];
	const prompt = parsePrompt(args);

	t.is(prompt, 'tell agent what to do');
});

test('CLI parsing: returns undefined when run command not present', t => {
	const args = ['--vscode', '--vscode-port', '3000'];
	const prompt = parsePrompt(args);

	t.is(prompt, undefined);
});

test('CLI parsing: returns undefined when run command has no prompt', t => {
	const args = ['run'];
	const prompt = parsePrompt(args);

	t.is(prompt, undefined);
});

test('CLI parsing: handles mixed arguments with run command', t => {
	const args = ['--vscode', 'run', 'create', 'a', 'new', 'file'];
	const prompt = parsePrompt(args);

	t.is(prompt, 'create a new file');
});

test('CLI parsing: handles empty args array', t => {
	const args: string[] = [];
	const prompt = parsePrompt(args);

	t.is(prompt, undefined);
});

// New tests for flag filtering
test('CLI parsing: filters out --vscode flag after run command', t => {
	const args = ['run', 'create', 'a', 'file', '--vscode'];
	const prompt = parsePrompt(args);

	t.is(prompt, 'create a file');
});

test('CLI parsing: filters out --vscode-port flag and value after run command', t => {
	const args = ['run', 'create', 'a', 'file', '--vscode-port', '3000'];
	const prompt = parsePrompt(args);

	t.is(prompt, 'create a file');
});

test('CLI parsing: filters out both --vscode and --vscode-port flags after run command', t => {
	const args = [
		'run',
		'create',
		'a',
		'file',
		'--vscode',
		'--vscode-port',
		'3000',
	];
	const prompt = parsePrompt(args);

	t.is(prompt, 'create a file');
});

test('CLI parsing: filters out flags mixed with prompt words', t => {
	const args = [
		'run',
		'create',
		'--vscode',
		'a',
		'--vscode-port',
		'3000',
		'file',
	];
	const prompt = parsePrompt(args);

	t.is(prompt, 'create a file');
});

// New tests for version and help flags
test('CLI parsing: detects --version flag', t => {
	const args = ['--version'];
	const hasVersionFlag = args.includes('--version') || args.includes('-v');

	t.true(hasVersionFlag);
});

test('CLI parsing: detects -v flag', t => {
	const args = ['-v'];
	const hasVersionFlag = args.includes('--version') || args.includes('-v');

	t.true(hasVersionFlag);
});

test('CLI parsing: detects --help flag', t => {
	const args = ['--help'];
	const hasHelpFlag = args.includes('--help') || args.includes('-h');

	t.true(hasHelpFlag);
});

test('CLI parsing: detects -h flag', t => {
	const args = ['-h'];
	const hasHelpFlag = args.includes('--help') || args.includes('-h');

	t.true(hasHelpFlag);
});

test('CLI parsing: version flag takes precedence over other arguments', t => {
	const args = ['--version', '--vscode', 'run', 'some', 'command'];
	const hasVersionFlag = args.includes('--version') || args.includes('-v');

	t.true(hasVersionFlag);
});

test('CLI parsing: help flag takes precedence over other arguments', t => {
	const args = ['--help', '--vscode', 'run', 'some', 'command'];
	const hasHelpFlag = args.includes('--help') || args.includes('-h');

	t.true(hasHelpFlag);
});

test('CLI parsing: detects version flag with other arguments', t => {
	const args = ['--vscode', '-v', '--vscode-port', '3000'];
	const hasVersionFlag = args.includes('--version') || args.includes('-v');

	t.true(hasVersionFlag);
});

test('CLI parsing: detects help flag with other arguments', t => {
	const args = ['--vscode', '-h', '--vscode-port', '3000'];
	const hasHelpFlag = args.includes('--help') || args.includes('-h');

	t.true(hasHelpFlag);
});

// --context-max flag tests
test('CLI parsing: filters out --context-max flag and value after run command', t => {
	const args = ['run', 'analyze', 'code', '--context-max', '128k'];
	const prompt = parsePrompt(args);

	t.is(prompt, 'analyze code');
});

test('CLI parsing: filters out --context-max mixed with other flags after run', t => {
	const args = [
		'run',
		'--provider',
		'ollama',
		'--context-max',
		'32000',
		'analyze',
		'code',
	];
	const prompt = parsePrompt(args);

	t.is(prompt, 'analyze code');
});

test('CLI parsing: extracts --context-max value from args', t => {
	const args = ['--context-max', '128k', 'run', 'hello'];
	const contextMaxArgIndex = args.findIndex(arg => arg === '--context-max');

	t.is(contextMaxArgIndex, 0);
	t.is(args[contextMaxArgIndex + 1], '128k');
});

test('CLI parsing: --context-max with numeric value', t => {
	const args = ['--context-max', '32000', 'run', 'hello'];
	const contextMaxArgIndex = args.findIndex(arg => arg === '--context-max');

	t.is(contextMaxArgIndex, 0);
	t.is(args[contextMaxArgIndex + 1], '32000');
});

// --plain / --no-plain flag tests. The plain-mode resolution rule mirrors
// the logic in cli.tsx: explicit --plain wins, --no-plain forces Ink, and
// otherwise it auto-enables for `run` invocations on a non-TTY or in CI.
function resolvePlainMode(opts: {
	args: string[];
	stdoutIsTTY: boolean;
	env: NodeJS.ProcessEnv;
}): {plainMode: boolean; vscodeMode: boolean} {
	const {args, stdoutIsTTY, env} = opts;
	const nonInteractiveMode = args.includes('run');
	const vscodeMode = args.includes('--vscode');
	const plainRequested = args.includes('--plain');
	const noPlainRequested = args.includes('--no-plain');
	const ciDetected =
		env.CI === 'true' ||
		Boolean(
			env.GITHUB_ACTIONS ||
				env.GITLAB_CI ||
				env.BUILDKITE ||
				env.CIRCLECI ||
				env.JENKINS_URL,
		);
	const plainAuto =
		nonInteractiveMode &&
		!noPlainRequested &&
		!vscodeMode &&
		(!stdoutIsTTY || ciDetected);
	return {plainMode: plainRequested || plainAuto, vscodeMode};
}

test('plain mode: filters --plain and --no-plain from prompt args', t => {
	t.is(parsePrompt(['run', 'do', '--plain', 'a', 'thing']), 'do a thing');
	t.is(parsePrompt(['run', 'do', '--no-plain', 'a', 'thing']), 'do a thing');
});

test('plain mode: explicit --plain enables it on a TTY without CI', t => {
	const {plainMode} = resolvePlainMode({
		args: ['--plain', 'run', 'hi'],
		stdoutIsTTY: true,
		env: {},
	});
	t.true(plainMode);
});

test('plain mode: auto-enables for run on a non-TTY', t => {
	const {plainMode} = resolvePlainMode({
		args: ['run', 'hi'],
		stdoutIsTTY: false,
		env: {},
	});
	t.true(plainMode);
});

test('plain mode: auto-enables for run when CI=true', t => {
	const {plainMode} = resolvePlainMode({
		args: ['run', 'hi'],
		stdoutIsTTY: true,
		env: {CI: 'true'},
	});
	t.true(plainMode);
});

test('plain mode: auto-enables for run when GITHUB_ACTIONS is set', t => {
	const {plainMode} = resolvePlainMode({
		args: ['run', 'hi'],
		stdoutIsTTY: true,
		env: {GITHUB_ACTIONS: 'true'},
	});
	t.true(plainMode);
});

test('plain mode: --no-plain wins over auto-detection', t => {
	const {plainMode} = resolvePlainMode({
		args: ['--no-plain', 'run', 'hi'],
		stdoutIsTTY: false,
		env: {CI: 'true'},
	});
	t.false(plainMode);
});

test('plain mode: stays off for interactive sessions even on a non-TTY', t => {
	const {plainMode} = resolvePlainMode({
		args: [],
		stdoutIsTTY: false,
		env: {CI: 'true'},
	});
	t.false(plainMode);
});

test('plain mode: --vscode suppresses auto-detection', t => {
	const {plainMode, vscodeMode} = resolvePlainMode({
		args: ['--vscode', 'run', 'hi'],
		stdoutIsTTY: false,
		env: {CI: 'true'},
	});
	t.false(plainMode);
	t.true(vscodeMode);
});

// --alt-screen / --no-alt-screen flag tests. The resolution rule mirrors
// the logic in cli.tsx: --no-alt-screen always wins (forces inline), then
// --alt-screen or the "alternateScreen" preference opt in, and the whole
// thing is gated on being an interactive TTY session (never in
// nonInteractiveMode, e.g. `run`, and never off a real TTY).
function resolveAltScreenMode(opts: {
	args: string[];
	stdoutIsTTY: boolean;
	nonInteractiveMode: boolean;
	preferenceAlternateScreen: boolean;
}): boolean {
	const {args, stdoutIsTTY, nonInteractiveMode, preferenceAlternateScreen} =
		opts;
	const altScreenAllowed =
		!args.includes('--no-alt-screen') &&
		(args.includes('--alt-screen') || preferenceAlternateScreen === true);
	return stdoutIsTTY && !nonInteractiveMode && altScreenAllowed;
}

test('alt-screen: off by default (no flag, no preference)', t => {
	const useAltScreen = resolveAltScreenMode({
		args: [],
		stdoutIsTTY: true,
		nonInteractiveMode: false,
		preferenceAlternateScreen: false,
	});
	t.false(useAltScreen);
});

test('alt-screen: --alt-screen flag turns it on over a TTY', t => {
	const useAltScreen = resolveAltScreenMode({
		args: ['--alt-screen'],
		stdoutIsTTY: true,
		nonInteractiveMode: false,
		preferenceAlternateScreen: false,
	});
	t.true(useAltScreen);
});

test('alt-screen: "alternateScreen" preference turns it on without the flag', t => {
	const useAltScreen = resolveAltScreenMode({
		args: [],
		stdoutIsTTY: true,
		nonInteractiveMode: false,
		preferenceAlternateScreen: true,
	});
	t.true(useAltScreen);
});

test('alt-screen: --no-alt-screen overrides the flag', t => {
	const useAltScreen = resolveAltScreenMode({
		args: ['--alt-screen', '--no-alt-screen'],
		stdoutIsTTY: true,
		nonInteractiveMode: false,
		preferenceAlternateScreen: false,
	});
	t.false(useAltScreen);
});

test('alt-screen: --no-alt-screen overrides the persisted preference', t => {
	const useAltScreen = resolveAltScreenMode({
		args: ['--no-alt-screen'],
		stdoutIsTTY: true,
		nonInteractiveMode: false,
		preferenceAlternateScreen: true,
	});
	t.false(useAltScreen);
});

test('alt-screen: never enabled off a non-TTY, even with the flag', t => {
	const useAltScreen = resolveAltScreenMode({
		args: ['--alt-screen'],
		stdoutIsTTY: false,
		nonInteractiveMode: false,
		preferenceAlternateScreen: false,
	});
	t.false(useAltScreen);
});

test('alt-screen: never enabled for non-interactive `run` mode, even with the flag', t => {
	const useAltScreen = resolveAltScreenMode({
		args: ['--alt-screen'],
		stdoutIsTTY: true,
		nonInteractiveMode: true,
		preferenceAlternateScreen: false,
	});
	t.false(useAltScreen);
});

test('alt-screen: flag and preference both true is not double-negated', t => {
	const useAltScreen = resolveAltScreenMode({
		args: ['--alt-screen'],
		stdoutIsTTY: true,
		nonInteractiveMode: false,
		preferenceAlternateScreen: true,
	});
	t.true(useAltScreen);
});

// --continue / -c and --resume / -r flag parsing tests. Mirrors the logic in
// cli.tsx: mutual exclusion, optional id/index after --resume, and rejection
// when combined with the `run` command.
function resolveResumeFlags(args: string[]): {
	continueRequested: boolean;
	resumeRequested: boolean;
	resumeArg: string | undefined;
	mutuallyExclusiveError: boolean;
	nonInteractiveError: boolean;
} {
	const runCommandIndex = args.findIndex(arg => arg === 'run');
	const nonInteractiveMode = runCommandIndex !== -1;

	const continueRequested =
		args.includes('--continue') || args.includes('-c');
	const resumeFlagIndex = args.findIndex(
		arg => arg === '--resume' || arg === '-r',
	);
	const resumeRequested = resumeFlagIndex !== -1;

	const mutuallyExclusiveError = continueRequested && resumeRequested;

	let resumeArg: string | undefined;
	if (resumeRequested) {
		const next = args[resumeFlagIndex + 1];
		if (next && !next.startsWith('-') && next !== 'run') {
			resumeArg = next;
		}
	}

	const nonInteractiveError =
		(continueRequested || resumeRequested) &&
		nonInteractiveMode &&
		!mutuallyExclusiveError;

	return {
		continueRequested,
		resumeRequested,
		resumeArg,
		mutuallyExclusiveError,
		nonInteractiveError,
	};
}

test('resume flags: detects --continue', t => {
	const {continueRequested} = resolveResumeFlags(['--continue']);
	t.true(continueRequested);
});

test('resume flags: detects -c shorthand', t => {
	const {continueRequested} = resolveResumeFlags(['-c']);
	t.true(continueRequested);
});

test('resume flags: detects --resume with no id', t => {
	const {resumeRequested, resumeArg} = resolveResumeFlags(['--resume']);
	t.true(resumeRequested);
	t.is(resumeArg, undefined);
});

test('resume flags: detects -r shorthand with no id', t => {
	const {resumeRequested, resumeArg} = resolveResumeFlags(['-r']);
	t.true(resumeRequested);
	t.is(resumeArg, undefined);
});

test('resume flags: captures an id after --resume', t => {
	const {resumeRequested, resumeArg} = resolveResumeFlags([
		'--resume',
		'last',
	]);
	t.true(resumeRequested);
	t.is(resumeArg, 'last');
});

test('resume flags: captures a numeric index after -r', t => {
	const {resumeArg} = resolveResumeFlags(['-r', '2']);
	t.is(resumeArg, '2');
});

test('resume flags: captures a raw uuid after --resume', t => {
	const {resumeArg} = resolveResumeFlags([
		'--resume',
		'123e4567-e89b-42d3-a456-426614174000',
	]);
	t.is(resumeArg, '123e4567-e89b-42d3-a456-426614174000');
});

test('resume flags: does not treat a following flag as the resume id', t => {
	const {resumeArg} = resolveResumeFlags(['--resume', '--alt-screen']);
	t.is(resumeArg, undefined);
});

test('resume flags: does not treat a following `run` as the resume id', t => {
	const {resumeArg} = resolveResumeFlags(['--resume', 'run', 'do a thing']);
	t.is(resumeArg, undefined);
});

test('resume flags: --continue and --resume together is an error', t => {
	const {mutuallyExclusiveError} = resolveResumeFlags([
		'--continue',
		'--resume',
	]);
	t.true(mutuallyExclusiveError);
});

test('resume flags: -c and -r together is an error', t => {
	const {mutuallyExclusiveError} = resolveResumeFlags(['-c', '-r']);
	t.true(mutuallyExclusiveError);
});

test('resume flags: neither flag alone is not a mutual-exclusion error', t => {
	t.false(resolveResumeFlags(['--continue']).mutuallyExclusiveError);
	t.false(resolveResumeFlags(['--resume']).mutuallyExclusiveError);
	t.false(resolveResumeFlags([]).mutuallyExclusiveError);
});

test('resume flags: --continue combined with `run` is an error', t => {
	const {nonInteractiveError} = resolveResumeFlags(['--continue', 'run', 'hi']);
	t.true(nonInteractiveError);
});

test('resume flags: --resume combined with `run` is an error', t => {
	const {nonInteractiveError} = resolveResumeFlags(['--resume', 'run', 'hi']);
	t.true(nonInteractiveError);
});

test('resume flags: --continue without `run` is not a non-interactive error', t => {
	const {nonInteractiveError} = resolveResumeFlags(['--continue']);
	t.false(nonInteractiveError);
});
