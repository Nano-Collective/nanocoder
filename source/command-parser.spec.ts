import test from 'ava';
import { parseInput } from './command-parser';

test('parseInput - parses bash commands with ! prefix', t => {
	const result = parseInput('!ls -la');

	t.false(result.isCommand);
	t.true(result.isBashCommand);
	t.is(result.bashCommand, 'ls -la');
});

test('parseInput - handles empty bash command', t => {
	const result = parseInput('!');

	t.false(result.isCommand);
	t.true(result.isBashCommand);
	t.is(result.bashCommand, '');
});

test('parseInput - handles bash command with spaces', t => {
	const result = parseInput('!   echo "hello world"   ');

	t.false(result.isCommand);
	t.true(result.isBashCommand);
	t.is(result.bashCommand, 'echo "hello world"');
});

test('parseInput - trims whitespace after ! prefix', t => {
	const result = parseInput('! git status');

	t.false(result.isCommand);
	t.true(result.isBashCommand);
	t.is(result.bashCommand, 'git status');
});

test('parseInput - returns non-command for text without prefix', t => {
	const result = parseInput('Hello world');

	t.false(result.isCommand);
	t.is(result.isBashCommand, undefined);
});

test('parseInput - parses regular commands with / prefix', t => {
	const result = parseInput('/command arg1 arg2');

	t.true(result.isCommand);
	t.is(result.isBashCommand, undefined);
	t.is(result.command, 'command');
	t.deepEqual(result.args, ['arg1', 'arg2']);
	t.is(result.fullCommand, 'command arg1 arg2');
});

test('parseInput - handles empty command', t => {
	const result = parseInput('/');

	t.true(result.isCommand);
	t.is(result.isBashCommand, undefined);
	t.is(result.command, '');
	t.deepEqual(result.args, []);
	t.is(result.fullCommand, '');
});

test('parseInput - handles command without arguments', t => {
	const result = parseInput('/help');

	t.true(result.isCommand);
	t.is(result.isBashCommand, undefined);
	t.is(result.command, 'help');
	t.deepEqual(result.args, []);
	t.is(result.fullCommand, 'help');
});

test('parseInput - handles command with single argument', t => {
	const result = parseInput('/init my-project');

	t.true(result.isCommand);
	t.is(result.isBashCommand, undefined);
	t.is(result.command, 'init');
	t.deepEqual(result.args, ['my-project']);
	t.is(result.fullCommand, 'init my-project');
});

test('parseInput - handles multiple whitespace between arguments', t => {
	const result = parseInput('/test    arg1     arg2');

	t.true(result.isCommand);
	t.is(result.isBashCommand, undefined);
	t.is(result.command, 'test');
	t.deepEqual(result.args, ['arg1', 'arg2']);
	t.is(result.fullCommand, 'test    arg1     arg2');
});

test('parseInput - trims whitespace from input', t => {
	const result = parseInput('   /command arg1   ');

	t.true(result.isCommand);
	t.is(result.isBashCommand, undefined);
	t.is(result.command, 'command');
	t.deepEqual(result.args, ['arg1']);
	t.is(result.fullCommand, 'command arg1');
});

test('parseInput - handles empty string input', t => {
	const result = parseInput('');

	t.false(result.isCommand);
	t.is(result.isBashCommand, undefined);
});

test('parseInput - handles whitespace-only input', t => {
	const result = parseInput('   ');

	t.false(result.isCommand);
	t.is(result.isBashCommand, undefined);
});

test('parseInput - handles / followed by whitespace', t => {
	const result = parseInput('/   ');

	t.true(result.isCommand);
	t.is(result.isBashCommand, undefined);
	t.is(result.command, '');
	t.deepEqual(result.args, []);
	t.is(result.fullCommand, '');
});

test('parseInput - preserves argument case and special characters', t => {
	const result = parseInput('/echo "Hello World" --flag=value');

	t.true(result.isCommand);
	t.is(result.isBashCommand, undefined);
	t.is(result.command, 'echo');
	t.deepEqual(result.args, ['"Hello', 'World"', '--flag=value']);
	t.is(result.fullCommand, 'echo "Hello World" --flag=value');
});