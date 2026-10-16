import test from 'ava';
import {validateCliArgs} from './cli-args.js';

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
	t.is(
		validateCliArgs(['swarm', '--workers', '3', '--swarm-mode', 'apply', 'task']),
		undefined,
	);
	t.is(validateCliArgs(['--resume', 'last']), undefined);
});

test('suggests the login subcommand for codex and copilot', t => {
	t.is(
		validateCliArgs(['codex', 'logn']),
		'Unknown codex subcommand "logn". Did you mean "login"?',
	);
});
