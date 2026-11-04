import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'ava';

const cliPath = fileURLToPath(new URL('./cli.tsx', import.meta.url));

function runCli(args: string[]) {
	return spawnSync(process.execPath, ['--import=tsx', cliPath, ...args], {
		encoding: 'utf8',
		timeout: 15_000,
		env: {
			...process.env,
			NODE_DISABLE_COMPILE_CACHE: '1',
			TSX_DISABLE_CACHE: '1',
		},
	});
}

test('unknown top-level flags and commands fail before the app starts', t => {
	const cases = [
		{
			args: ['--mdoe', 'plan', 'run', 'do a task'],
			error: 'Did you mean "--mode"?',
		},
		{
			args: ['--bogusflag', 'run', 'do a task'],
			error: 'Unknown option "--bogusflag".',
		},
		{
			args: ['reveiw', 'main'],
			error: 'Did you mean "review"?',
		},
		{
			args: ['conifg', 'list'],
			error: 'Did you mean "config"?',
		},
		{args: ['fix the tests'], error: 'Unknown command "fix the tests".'},
	];

	for (const {args, error} of cases) {
		const result = runCli(args);
		t.is(result.status, 1, result.stderr);
		t.true(result.stderr.includes(error), result.stderr);
		t.is(result.stdout, '');
	}
});

test('a command after an option is reported as misplaced, not unknown', t => {
	const result = runCli(['--trust-directory', 'daemon', 'start']);
	t.is(result.status, 1, result.stderr);
	t.true(
		result.stderr.includes(
			'Put "daemon" first: nanocoder daemon start --trust-directory',
		),
		result.stderr,
	);
	t.false(result.stderr.includes('Did you mean'), result.stderr);
});

test('worktree accepts global options after the PR number', t => {
	// Spawned without a TTY, so a run that gets past argument parsing stops
	// at the interactive-terminal check instead of creating a worktree.
	const result = runCli(['worktree', '42', '--provider', 'ollama', '--mode', 'plan']);
	t.false(result.stderr.includes('Usage: nanocoder worktree'), result.stderr);
	t.true(result.stderr.includes('requires an interactive terminal'), result.stderr);
});
