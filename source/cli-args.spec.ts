import test from 'ava';
import {parseWorktreeArgs, validateCliArgs} from './cli-args.js';

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

test('suggests verify for a misspelled verify command', t => {
	t.is(
		validateCliArgs(['verfy', '--pr', '1']),
		'Unknown command "verfy". Did you mean "verify"?',
	);
});
