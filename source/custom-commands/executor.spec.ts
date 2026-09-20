import test from 'ava';
import type {CustomCommand} from '@/types/index';
import {CustomCommandExecutor} from './executor';

const executor = new CustomCommandExecutor();

// Helper to create test command objects
function createTestCommand(overrides?: Partial<CustomCommand>): CustomCommand {
	return {
		name: 'test',
		fullName: 'test',
		namespace: '',
		path: '/test/command.md',
		content: 'Test content',
		metadata: {},
		...overrides,
	};
}

test('execute returns prompt with command content', t => {
	const command = createTestCommand({content: 'This is a test command'});

	const result = executor.execute(command, []);
	t.true(result.includes('This is a test command'));
	t.true(result.includes('/test'));
});

test('execute substitutes cwd variable', t => {
	const command = createTestCommand({content: 'Working in {{cwd}}'});

	const result = executor.execute(command, []);
	const expectedCwd = process.cwd();
	t.true(result.includes(expectedCwd));
});

test('execute substitutes command variable', t => {
	const command = createTestCommand({content: 'Running {{command}}'});

	const result = executor.execute(command, []);
	t.true(result.includes('/test'));
});

test('execute substitutes parameter variables', t => {
	const command = createTestCommand({
		content: 'Arg1: {{arg1}}, Arg2: {{arg2}}',
		metadata: {
			parameters: ['arg1', 'arg2'],
		},
	});

	const result = executor.execute(command, ['value1', 'value2']);
	t.true(result.includes('value1'));
	t.true(result.includes('value2'));
});

test('execute handles missing parameters gracefully', t => {
	const command = createTestCommand({
		content: 'Arg1: {{arg1}}',
		metadata: {
			parameters: ['arg1', 'arg2'],
		},
	});

	const result = executor.execute(command, ['value1']);
	// Should still work, missing arg2 becomes empty string
	t.true(result.includes('value1'));
});

test('execute includes args variable with all arguments', t => {
	const command = createTestCommand({
		content: 'All args: {{args}}',
		metadata: {
			parameters: ['arg1', 'arg2'],
		},
	});

	const result = executor.execute(command, ['hello', 'world']);
	t.true(result.includes('hello world'));
});

test('execute wraps the prompt with the command name', t => {
	const command = createTestCommand();

	const result = executor.execute(command, []);
	t.true(result.includes('Executing custom command'));
	t.true(result.includes('/test'));
});

test('execute falls back to a parameter default when the arg is omitted', t => {
	const command = createTestCommand({
		content: 'Diff against {{base}}.',
		metadata: {parameters: ['base=origin/main']},
	});

	t.true(executor.execute(command, []).includes('Diff against origin/main.'));
	t.true(
		executor.execute(command, ['feature']).includes('Diff against feature.'),
	);
});

test('execute keeps a section when its parameter is provided', t => {
	const command = createTestCommand({
		content: 'PR #{{pr}}{{# issue }} linked to #{{issue}}{{/ issue }}.',
		metadata: {parameters: ['pr', 'issue']},
	});

	const result = executor.execute(command, ['123', '45']);
	t.true(result.includes('PR #123 linked to #45.'));
});

test('execute drops a section when its parameter is omitted', t => {
	const command = createTestCommand({
		content: 'PR #{{pr}}{{# issue }} linked to #{{issue}}{{/ issue }}.',
		metadata: {parameters: ['pr', 'issue']},
	});

	const result = executor.execute(command, ['123']);
	t.true(result.includes('PR #123.'));
	t.false(result.includes('linked to'));
});

test('execute supports inverted sections for an omitted parameter', t => {
	const command = createTestCommand({
		content: '{{^ issue }}No issue linked.{{/ issue }}{{# issue }}Issue #{{issue}}.{{/ issue }}',
		metadata: {parameters: ['pr', 'issue']},
	});

	t.true(executor.execute(command, ['123']).includes('No issue linked.'));
	t.true(executor.execute(command, ['123', '45']).includes('Issue #45.'));
});

test('formatHelp shows defaulted parameters as optional', t => {
	const command = createTestCommand({
		metadata: {parameters: ['pr_number', 'base=origin/main']},
	});

	const result = executor.formatHelp(command);
	t.true(result.includes('<pr_number>'));
	t.true(result.includes('[base=origin/main]'));
});

test('formatHelp returns command name', t => {
	const command = createTestCommand();

	const result = executor.formatHelp(command);
	t.true(result.includes('/test'));
});

test('formatHelp includes parameters', t => {
	const command = createTestCommand({
		metadata: {
			parameters: ['arg1', 'arg2'],
		},
	});

	const result = executor.formatHelp(command);
	t.true(result.includes('<arg1>'));
	t.true(result.includes('<arg2>'));
});

test('formatHelp includes description', t => {
	const command = createTestCommand({
		metadata: {
			description: 'This is a test command',
		},
	});

	const result = executor.formatHelp(command);
	t.true(result.includes('This is a test command'));
});

test('formatHelp includes aliases', t => {
	const command = createTestCommand({
		fullName: 'namespace:test',
		namespace: 'namespace',
		metadata: {
			aliases: ['t', 'testy'],
		},
	});

	const result = executor.formatHelp(command);
	t.true(result.includes('namespace:t'));
	t.true(result.includes('namespace:testy'));
});

test('formatHelp includes aliases without namespace', t => {
	const command = createTestCommand({
		metadata: {
			aliases: ['t', 'testy'],
		},
	});

	const result = executor.formatHelp(command);
	t.true(result.includes('t, testy'));
});
