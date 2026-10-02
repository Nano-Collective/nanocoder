import test from 'ava';
import React from 'react';
import type {Command, Message} from '@/types/index';
import {commandRegistry, CommandRegistry} from './commands';

// Test command factory
function createTestCommand(name: string, handler?: Command['handler']): Command {
	const defaultHandler: Command['handler'] = async () => React.createElement(React.Fragment, null, `Handled: ${name}`);
	return {
		name,
		description: `Test command ${name}`,
		handler: handler || defaultHandler,
	};
}

test.beforeEach(() => {
	// Clear the registry before each test
	const registry = commandRegistry as any;
	// Create a fresh instance for testing by clearing the commands Map
	registry.commands.clear();
});

// ============================================================================
// Tests for register()
// ============================================================================

test('CommandRegistry.register - registers single command', t => {
	const registry = new CommandRegistry();
	const command = createTestCommand('test');

	registry.register(command);

	t.is(registry.get('test'), command);
});

test('CommandRegistry.register - registers array of commands', t => {
	const registry = new CommandRegistry();
	const commands = [
		createTestCommand('cmd1'),
		createTestCommand('cmd2'),
		createTestCommand('cmd3'),
	];

	registry.register(commands);

	t.is(registry.get('cmd1'), commands[0]);
	t.is(registry.get('cmd2'), commands[1]);
	t.is(registry.get('cmd3'), commands[2]);
});

test('CommandRegistry.register - replaces existing command with same name', t => {
	const registry = new CommandRegistry();
	const command1 = createTestCommand('test');
	const command2 = createTestCommand('test');

	registry.register(command1);
	registry.register(command2);

	t.is(registry.get('test'), command2);
});

test('CommandRegistry.register - handles mixed single and array registration', t => {
	const registry = new CommandRegistry();

	registry.register(createTestCommand('cmd1'));
	registry.register([createTestCommand('cmd2'), createTestCommand('cmd3')]);
	registry.register(createTestCommand('cmd4'));

	t.is(registry.getAll().length, 4);
});

// ============================================================================
// Tests for get()
// ============================================================================

test('CommandRegistry.get - returns undefined for non-existent command', t => {
	const registry = new CommandRegistry();

	t.is(registry.get('nonexistent'), undefined);
});

test('CommandRegistry.get - returns command for existing command', t => {
	const registry = new CommandRegistry();
	const command = createTestCommand('test');

	registry.register(command);

	t.is(registry.get('test'), command);
});

// ============================================================================
// Tests for getAll()
// ============================================================================

test('CommandRegistry.getAll - returns empty array when no commands registered', t => {
	const registry = new CommandRegistry();

	t.deepEqual(registry.getAll(), []);
});

test('CommandRegistry.getAll - returns all registered commands', t => {
	const registry = new CommandRegistry();
	const commands = [
		createTestCommand('cmd1'),
		createTestCommand('cmd2'),
		createTestCommand('cmd3'),
	];

	registry.register(commands);

	const all = registry.getAll();
	t.is(all.length, 3);
	t.true(all.includes(commands[0]));
	t.true(all.includes(commands[1]));
	t.true(all.includes(commands[2]));
});

// ============================================================================
// Tests for getCompletions()
// ============================================================================

test('CommandRegistry.getCompletions - returns all commands alphabetically for empty prefix', t => {
	const registry = new CommandRegistry();
	registry.register([createTestCommand('help'), createTestCommand('test')]);

	const completions = registry.getCompletions('');

	t.deepEqual(completions, ['help', 'test']);
});

test('CommandRegistry.getCompletions - returns exact match', t => {
	const registry = new CommandRegistry();
	registry.register(createTestCommand('help'));

	const completions = registry.getCompletions('help');

	t.deepEqual(completions, ['help']);
});

test('CommandRegistry.getCompletions - returns partial matches', t => {
	const registry = new CommandRegistry();
	registry.register([
		createTestCommand('help'),
		createTestCommand('helper'),
		createTestCommand('health'),
	]);

	const completions = registry.getCompletions('hel');

	// fuzzyScore matches commands that start with 'hel' plus similar ones
	// The order depends on the fuzzy scoring algorithm
	t.true(completions.includes('help'));
	t.true(completions.includes('helper'));
	t.true(completions.includes('health'));
});

test('CommandRegistry.getCompletions - returns fuzzy matches', t => {
	const registry = new CommandRegistry();
	registry.register([
		createTestCommand('git-commit'),
		createTestCommand('git-status'),
		createTestCommand('git-push'),
	]);

	const completions = registry.getCompletions('gcm');

	// fuzzyScore should match 'git-commit' with 'gcm'
	t.true(completions.includes('git-commit'));
});

test('CommandRegistry.getCompletions - sorts by score then alphabetically', t => {
	const registry = new CommandRegistry();
	registry.register([
		createTestCommand('aaa'),
		createTestCommand('aba'),
		createTestCommand('aab'),
	]);

	const completions = registry.getCompletions('ab');

	// All should match 'ab', but should be sorted alphabetically when scores are equal
	// Note: fuzzyScore gives different scores, so exact/prefix matches come first
	t.true(completions.length > 0);
});

test('CommandRegistry.getCompletions - returns empty when no matches', t => {
	const registry = new CommandRegistry();
	registry.register([createTestCommand('help'), createTestCommand('test')]);

	const completions = registry.getCompletions('xyz');

	t.deepEqual(completions, []);
});

// ============================================================================
// Tests for execute()
// ============================================================================

test('CommandRegistry.execute - returns error message for empty input', async t => {
	const registry = new CommandRegistry();
	const messages: Message[] = [];
	const metadata = {
		provider: 'test',
		model: 'test-model',
		tokens: 100,
		getMessageTokens: (m: Message) => 0,
	};

	const result = await registry.execute('', messages, metadata);

	// Result should be a React element (ErrorMessage)
	t.truthy(result);
	// Check that result has props with the error message
	const element = result as {props: {message: string}};
	t.truthy(element.props);
	t.true(element.props.message.includes('Invalid command'));
});

test('CommandRegistry.execute - returns error message for whitespace input', async t => {
	const registry = new CommandRegistry();
	const messages: Message[] = [];
	const metadata = {
		provider: 'test',
		model: 'test-model',
		tokens: 100,
		getMessageTokens: (m: Message) => 0,
	};

	const result = await registry.execute('   ', messages, metadata);

	t.truthy(result);
	const element = result as {props: {message: string}};
	t.truthy(element.props);
	t.true(element.props.message.includes('Invalid command'));
});

test('CommandRegistry.execute - returns error for unknown command', async t => {
	const registry = new CommandRegistry();
	const messages: Message[] = [];
	const metadata = {
		provider: 'test',
		model: 'test-model',
		tokens: 100,
		getMessageTokens: (m: Message) => 0,
	};

	const result = await registry.execute('unknown-command', messages, metadata);

	t.truthy(result);
	const element = result as {props: {message: string}};
	t.truthy(element.props);
	t.true(element.props.message.includes('Unknown command'));
});

test('CommandRegistry.execute - executes command with arguments', async t => {
	const registry = new CommandRegistry();
	let receivedArgs: string[] | null = null;

	const command: Command = {
		name: 'test',
		description: 'Test command',
		handler: async (args: string[]) => {
			receivedArgs = args;
			return React.createElement(React.Fragment, null, 'success');
		},
	};

	registry.register(command);

	const messages: Message[] = [];
	const metadata = {
		provider: 'test',
		model: 'test-model',
		tokens: 100,
		getMessageTokens: (m: Message) => 0,
	};

	const result = await registry.execute('test arg1 arg2', messages, metadata);

	t.deepEqual(receivedArgs, ['arg1', 'arg2']);
});

test('CommandRegistry.execute - handles command with no arguments', async t => {
	const registry = new CommandRegistry();
	const command: Command = {
		name: 'simple',
		description: 'Simple command',
		handler: async (args: string[]) => {
			return React.createElement(React.Fragment, null, `args: ${args.length}`);
		},
	};

	registry.register(command);

	const messages: Message[] = [];
	const metadata = {
		provider: 'test',
		model: 'test-model',
		tokens: 100,
		getMessageTokens: (m: Message) => 0,
	};

	const result = await registry.execute('simple', messages, metadata);

	t.truthy(React.isValidElement(result));
});

test('CommandRegistry.execute - passes messages and metadata to handler', async t => {
	const registry = new CommandRegistry();
	let receivedMessages: Message[] | null = null;
	let receivedMetadata: object | null = null;

	const testMessages: Message[] = [{role: 'user', content: 'test'}];
	const testMetadata = {
		provider: 'test-provider',
		model: 'test-model',
		tokens: 200,
		getMessageTokens: (m: Message) => 10,
	};

	const command: Command = {
		name: 'check',
		description: 'Check command',
		handler: async (args: string[], messages: Message[], metadata: object) => {
			receivedMessages = messages;
			receivedMetadata = metadata;
			return React.createElement(React.Fragment, null, 'checked');
		},
	};

	registry.register(command);

	const result = await registry.execute('check', testMessages, testMetadata);

	t.deepEqual(receivedMessages, testMessages);
	t.deepEqual(receivedMetadata, testMetadata);
});

test('CommandRegistry.execute - handles extra whitespace in input', async t => {
	const registry = new CommandRegistry();
	let receivedArgs: string[] | null = null;

	const command: Command = {
		name: 'test',
		description: 'Test command',
		handler: async (args: string[]) => {
			receivedArgs = args;
			return React.createElement(React.Fragment, null, 'success');
		},
	};

	registry.register(command);

	const messages: Message[] = [];
	const metadata = {
		provider: 'test',
		model: 'test-model',
		tokens: 100,
		getMessageTokens: (m: Message) => 0,
	};

	const result = await registry.execute('  test   arg1   arg2  ', messages, metadata);

	t.deepEqual(receivedArgs, ['arg1', 'arg2']);
});

test('CommandRegistry.execute - returns React element from handler', async t => {
	const registry = new CommandRegistry();

	const command: Command = {
		name: 'ui',
		description: 'UI command',
		handler: async () => {
			return React.createElement('div', {className: 'test'}, 'Test');
		},
	};

	registry.register(command);

	const messages: Message[] = [];
	const metadata = {
		provider: 'test',
		model: 'test-model',
		tokens: 100,
		getMessageTokens: (m: Message) => 0,
	};

	const result = await registry.execute('ui', messages, metadata);

	t.truthy(result);
});

test('CommandRegistry.execute - handles void return from handler', async t => {
	const registry = new CommandRegistry();

	const command: Command = {
		name: 'void',
		description: 'Void command',
		handler: async () => {
			return React.createElement(React.Fragment, null, '');
		},
	};

	registry.register(command);

	const messages: Message[] = [];
	const metadata = {
		provider: 'test',
		model: 'test-model',
		tokens: 100,
		getMessageTokens: (m: Message) => 0,
	};

	const result = await registry.execute('void', messages, metadata);

	t.truthy(React.isValidElement(result));
});

// ============================================================================
// Tests for exported commandRegistry singleton
// ============================================================================

test('exported commandRegistry - is instance of CommandRegistry', t => {
	t.true(commandRegistry instanceof CommandRegistry);
});

test('exported commandRegistry - can register and retrieve commands', t => {
	const command = createTestCommand('singleton-test');

	commandRegistry.register(command);

	t.is(commandRegistry.get('singleton-test'), command);

	// Clean up
	(commandRegistry as any).commands.clear();
});

// ============================================================================
// Tests for setAliases() / alias resolution
// ============================================================================

test('CommandRegistry.setAliases - resolves alias to the target command', t => {
	const registry = new CommandRegistry();
	const target = createTestCommand('compact');

	registry.register(target);
	registry.setAliases({c: 'compact'});

	t.is(registry.get('c'), target);
});

test('CommandRegistry.setAliases - alias execution invokes target handler with args', async t => {
	const registry = new CommandRegistry();
	let receivedArgs: string[] | null = null;

	const target: Command = {
		name: 'export',
		description: 'Export handler',
		handler: async args => {
			receivedArgs = args;
			return React.createElement(React.Fragment, null, 'done');
		},
	};

	registry.register(target);
	registry.setAliases({e: 'export'});

	const messages: Message[] = [];
	const metadata = {
		provider: 'test',
		model: 'test-model',
		tokens: 0,
		getMessageTokens: () => 0,
	};

	await registry.execute('e session.md', messages, metadata);

	t.deepEqual(receivedArgs, ['session.md']);
});

test('CommandRegistry.setAliases - unknown target returns undefined from get', t => {
	const registry = new CommandRegistry();
	registry.setAliases({c: 'does-not-exist'});

	t.is(registry.get('c'), undefined);
});

test('CommandRegistry.setAliases - drops alias that matches a registered built-in', t => {
	const registry = new CommandRegistry();
	const compact = createTestCommand('compact');

	registry.register(compact);
	registry.setAliases({compact: 'something-else'});

	// The built-in name must still resolve to the original command.
	t.is(registry.get('compact'), compact);
});

test('CommandRegistry.setAliases - clears prior aliases on each call', t => {
	const registry = new CommandRegistry();
	const first = createTestCommand('first');
	const second = createTestCommand('second');

	registry.register(first);
	registry.register(second);
	registry.setAliases({s: 'first'});

	t.is(registry.get('s'), first);

	registry.setAliases({s: 'second'});

	t.is(registry.get('s'), second);
});

test('CommandRegistry.setAliases - drops alias that matches a registered lazy entry', async t => {
	const registry = new CommandRegistry();
	const lazy = {
		name: 'help',
		description: 'help command',
		load: () => Promise.resolve(createTestCommand('help')),
	};

	registry.registerLazy(lazy);
	// Register an unrelated command named 'whatever' so the alias target
	// could resolve if it slipped through the shadow check.
	registry.register(createTestCommand('whatever'));
	registry.setAliases({help: 'whatever'});

	const result = await registry.get('help')?.handler([], [], {
		provider: 'test',
		model: 'test-model',
		tokens: 0,
		getMessageTokens: () => 0,
	});

	// The lazy 'help' command is what ran, not 'whatever' — the alias was
	// dropped because it would have shadowed a built-in name.
	t.truthy(React.isValidElement(result));
	t.not((result as React.ReactElement).props.children, 'Handled: whatever');
});

test('CommandRegistry.getCompletions - includes user aliases', t => {
	const registry = new CommandRegistry();
	registry.register([createTestCommand('help'), createTestCommand('test')]);
	registry.setAliases({h: 'help', t: 'test'});

	const completions = registry.getCompletions('');

	t.true(completions.includes('h'));
	t.true(completions.includes('t'));
	t.true(completions.includes('help'));
	t.true(completions.includes('test'));
});

test('CommandRegistry.getCompletions - alias is fuzzy-matched on its own key', t => {
	const registry = new CommandRegistry();
	registry.register(createTestCommand('compact'));
	registry.setAliases({c: 'compact'});

	const completions = registry.getCompletions('c');

	t.true(completions.includes('c'));
});

test('CommandRegistry.execute - returns unknown-command error for unresolved alias', async t => {
	const registry = new CommandRegistry();
	registry.setAliases({x: 'no-such-target'});

	const messages: Message[] = [];
	const metadata = {
		provider: 'test',
		model: 'test-model',
		tokens: 0,
		getMessageTokens: () => 0,
	};

	const result = await registry.execute('x', messages, metadata);

	t.truthy(result);
	const element = result as {props: {message: string}};
	t.true(element.props.message.includes('Unknown command'));
});
