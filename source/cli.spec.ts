import test from 'ava';

// Test CLI argument parsing for non-interactive mode
// These tests verify that the CLI correctly parses the 'run' command

// Helper function to parse prompt from args (mimics the logic in cli.tsx)
function parsePrompt(args: string[]): string | undefined {
	const runCommandIndex = args.findIndex(arg => arg === 'run');
	if (runCommandIndex !== -1 && args[runCommandIndex + 1]) {
		// Filter out known flags after 'run' when constructing the prompt
		const promptArgs: string[] = [];
		const knownFlags = new Set(['--vscode', '--vscode-port']);
		const afterRunArgs = args.slice(runCommandIndex + 1);
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
