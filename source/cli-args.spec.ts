import test from 'ava';
import {
	parseWorktreeArgs,
	validateCliArgs,
	validateInitArgs,
} from './cli-args.js';

test('suggests the correct option for a transposed unknown flag', t => {
	t.is(
		validateCliArgs(['--mdoe', 'plan', 'run', 'do a task']),
		'Unknown option "--mdoe". Did you mean "--mode"?',
	);
});

test('reports an unknown flag without a misleading suggestion', t => {
	t.is(
		validateCliArgs(['--bogusflag', 'run', 'do a task']),
		'Unknown option "--bogusflag". Run "nanocoder --help" to see available options.',
	);
});

test('suggests the correct command for a transposed unknown command', t => {
	t.is(
		validateCliArgs(['reveiw', 'main']),
		'Unknown command "reveiw". Did you mean "review"?',
	);
	t.is(
		validateCliArgs(['conifg', 'list']),
		'Unknown command "conifg". Did you mean "config"?',
	);
});

test('accepts known options and their values before run', t => {
	t.is(
		validateCliArgs([
			'--provider',
			'GitHub Copilot',
			'--model',
			'org/model@2024+beta',
			'--mode',
			'plan',
			'run',
		]),
		undefined,
	);
});

test('does not validate free-form prompt tokens after run', t => {
	t.is(
		validateCliArgs(['run', 'analyze', '--bogusflag', 'in this task']),
		undefined,
	);
});

test('accepts review targets and resume session identifiers', t => {
	t.is(validateCliArgs(['review', 'main']), undefined);
	t.is(validateCliArgs(['--resume', 'last']), undefined);
});

test('review rejects unknown options instead of calling them extra targets', t => {
	t.is(
		validateCliArgs(['review', '--bogus', 'main']),
		'Unknown option "--bogus". Run "nanocoder --help" to see available options.',
	);
	t.is(
		validateCliArgs(['review', 'main', '--mdoe', 'plan']),
		'Unknown option "--mdoe". Did you mean "--mode"?',
	);
	// `--resume` is a top-level flag, not a `run`/`review` flag: the scan and
	// review-cli's positional parser must agree, so it is reported here rather
	// than becoming an "extra argument".
	t.is(
		validateCliArgs(['review', '--resume', 'last', 'main']),
		'Unknown option "--resume". Run "nanocoder --help" to see available options.',
	);
	t.is(validateCliArgs(['review', 'main', '--json']), undefined);
});

test('init rejects unknown and unsupported options, accepting its own', t => {
	t.is(
		validateInitArgs(['init', '--bogus', '--preset', 'rust']),
		'Unknown option "--bogus". Run "nanocoder --help" to see available options.',
	);
	// Global flags are not honoured by `init`, so accepting them would ignore
	// them silently — the same symptom as an unknown option.
	t.is(
		validateInitArgs(['init', '--provider', 'ollama', '--preset', 'rust']),
		'Unknown option "--provider". Run "nanocoder --help" to see available options.',
	);
	t.is(
		validateInitArgs(['init', '--json']),
		'Unknown option "--json". Run "nanocoder --help" to see available options.',
	);
	t.is(
		validateInitArgs(['init', '--presett', 'rust']),
		'Unknown option "--presett". Did you mean "--preset"?',
	);
	t.is(
		validateInitArgs(['init', '--preset', 'rust', '--force', '--lean']),
		undefined,
	);
	t.is(validateInitArgs(['init', '--help']), undefined);
});

test('a negative number is only an option value for the numeric flags', t => {
	t.is(validateCliArgs(['--context-max', '-5', 'run', 'do a task']), undefined);
	t.is(validateCliArgs(['--vscode-port', '-1', 'run', 'do a task']), undefined);
	// Free-form values keep the stricter unknown-option detection.
	t.is(
		validateCliArgs(['--provider', '-5', 'run', 'do a task']),
		'Unknown option "-5". Did you mean "-c"?',
	);
	t.is(
		validateCliArgs(['--model', '-5', 'run', 'do a task']),
		'Unknown option "-5". Did you mean "-c"?',
	);
});

test('an explicitly empty option value is consumed, not read as a command', t => {
	t.is(validateCliArgs(['--vscode-port', '', 'run', 'hello']), undefined);
	t.is(validateCliArgs(['--mode', '', 'run', 'hello']), undefined);
});

test('suggests the login subcommand for codex and copilot', t => {
	t.is(
		validateCliArgs(['codex', 'logn']),
		'Unknown codex subcommand "logn". Did you mean "login"?',
	);
});

test('worktree accepts global options after the PR number', t => {
	t.is(validateCliArgs(['worktree', '42']), undefined);
	t.is(
		validateCliArgs(['worktree', '42', '--provider', 'ollama', '--mode', 'plan']),
		undefined,
	);
	t.is(validateCliArgs(['worktree', '42', '--model=llama3.1']), undefined);
	t.deepEqual(
		parseWorktreeArgs(['worktree', '42', '--provider', 'GitHub Copilot']),
		{positionals: ['42']},
	);
});

test('worktree rejects unknown options and extra positionals', t => {
	t.is(
		validateCliArgs(['worktree', '42', '--mdoe', 'plan']),
		'Unknown option "--mdoe". Did you mean "--mode"?',
	);
	t.regex(
		validateCliArgs(['worktree', '42', '43']) ?? '',
		/^Usage: nanocoder worktree <PR-number>/,
	);
	t.regex(
		validateCliArgs(['worktree', '--provider', 'ollama']) ?? '',
		/^Usage: nanocoder worktree <PR-number>/,
	);
});

test('a command typed after an option says to put it first', t => {
	t.is(
		validateCliArgs(['--trust-directory', 'daemon', 'start']),
		'Put "daemon" first: nanocoder daemon start --trust-directory',
	);
	t.is(
		validateCliArgs(['--provider', 'ollama', 'worktree', '42']),
		'Put "worktree" first: nanocoder worktree 42 --provider ollama',
	);
});

test('never suggests the command the user already typed', t => {
	for (const args of [
		['--trust-directory', 'daemon', 'start'],
		['--json', 'verify', '--pr', '1'],
		['--plain', 'review', 'main'],
	]) {
		const error = validateCliArgs(args) ?? '';
		t.notRegex(error, /Did you mean/);
		t.true(error.startsWith(`Put "${args[1]}" first`), error);
	}
});

test('suggests the option when one is typed without its dashes', t => {
	t.is(
		validateCliArgs(['acp']),
		'Unknown command "acp". Did you mean "--acp"?',
	);
	t.is(
		validateCliArgs(['vscode', '--vscode-port', '5000']),
		'Unknown command "vscode". Did you mean "--vscode"?',
	);
	t.is(
		validateCliArgs(['provider']),
		'Unknown command "provider". Did you mean "--provider"?',
	);
});

test('suggests verify for a misspelled verify command', t => {
	t.is(
		validateCliArgs(['verfy', '--pr', '1']),
		'Unknown command "verfy". Did you mean "verify"?',
	);
});
