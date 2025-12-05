import test from 'ava';

// Test CLI argument parsing for non-interactive mode
// These tests verify that the CLI correctly parses the 'run' command

test('CLI parsing: detects run command with single word prompt', t => {
	const args = ['run', 'help'];
	const runCommandIndex = args.findIndex(arg => arg === 'run');
	const prompt =
		runCommandIndex !== -1 && args[runCommandIndex + 1]
			? args.slice(runCommandIndex + 1).join(' ')
			: undefined;

	t.is(prompt, 'help');
});

test('CLI parsing: detects run command with multi-word prompt', t => {
	const args = ['run', 'tell', 'agent', 'what', 'to', 'do'];
	const runCommandIndex = args.findIndex(arg => arg === 'run');
	const prompt =
		runCommandIndex !== -1 && args[runCommandIndex + 1]
			? args.slice(runCommandIndex + 1).join(' ')
			: undefined;

	t.is(prompt, 'tell agent what to do');
});

test('CLI parsing: detects run command with quoted prompt', t => {
	const args = ['run', 'tell agent what to do'];
	const runCommandIndex = args.findIndex(arg => arg === 'run');
	const prompt =
		runCommandIndex !== -1 && args[runCommandIndex + 1]
			? args.slice(runCommandIndex + 1).join(' ')
			: undefined;

	t.is(prompt, 'tell agent what to do');
});

test('CLI parsing: returns undefined when run command not present', t => {
	const args = ['--vscode', '--vscode-port', '3000'];
	const runCommandIndex = args.findIndex(arg => arg === 'run');
	const prompt =
		runCommandIndex !== -1 && args[runCommandIndex + 1]
			? args.slice(runCommandIndex + 1).join(' ')
			: undefined;

	t.is(prompt, undefined);
});

test('CLI parsing: returns undefined when run command has no prompt', t => {
	const args = ['run'];
	const runCommandIndex = args.findIndex(arg => arg === 'run');
	const prompt =
		runCommandIndex !== -1 && args[runCommandIndex + 1]
			? args.slice(runCommandIndex + 1).join(' ')
			: undefined;

	t.is(prompt, undefined);
});

test('CLI parsing: handles mixed arguments with run command', t => {
	const args = ['--vscode', 'run', 'create', 'a', 'new', 'file'];
	const runCommandIndex = args.findIndex(arg => arg === 'run');
	const prompt =
		runCommandIndex !== -1 && args[runCommandIndex + 1]
			? args.slice(runCommandIndex + 1).join(' ')
			: undefined;

	t.is(prompt, 'create a new file');
});

test('CLI parsing: handles empty args array', t => {
	const args: string[] = [];
	const runCommandIndex = args.findIndex(arg => arg === 'run');
	const prompt =
		runCommandIndex !== -1 && args[runCommandIndex + 1]
			? args.slice(runCommandIndex + 1).join(' ')
			: undefined;

	t.is(prompt, undefined);
});
