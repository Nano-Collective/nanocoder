import test from 'ava';

// Test command parsing edge cases
// These tests document the expected behavior of parsing patterns

test('bash command detection - message starting with !', t => {
	const message = '!ls -la';
	const isBashCommand = message.startsWith('!');
	t.true(isBashCommand);
});

test('bash command detection - message not starting with !', t => {
	const message = 'ls -la';
	const isBashCommand = message.startsWith('!');
	t.false(isBashCommand);
});

test('slash command detection - message starting with /', t => {
	const message = '/help';
	const isSlashCommand = message.startsWith('/');
	t.true(isSlashCommand);
});

test('slash command parsing - extracts command name correctly', t => {
	const message = '/model gpt-4';
	const commandName = message.slice(1).split(/\s+/)[0];
	t.is(commandName, 'model');
});

test('slash command parsing - handles command without args', t => {
	const message = '/clear';
	const commandName = message.slice(1).split(/\s+/)[0];
	t.is(commandName, 'clear');
});

test('slash command parsing - handles command with multiple args', t => {
	const message = '/checkpoint load my-checkpoint';
	const parts = message.slice(1).split(/\s+/);
	t.is(parts[0], 'checkpoint');
	t.is(parts[1], 'load');
	t.is(parts[2], 'my-checkpoint');
});

// Test custom command argument extraction
test('custom command args extraction - with arguments', t => {
	const message = '/mycommand arg1 arg2 arg3';
	const commandName = 'mycommand';
	const args = message
		.slice(commandName.length + 2)
		.trim()
		.split(/\s+/)
		.filter(arg => arg);

	t.deepEqual(args, ['arg1', 'arg2', 'arg3']);
});

test('custom command args extraction - no arguments', t => {
	const message = '/mycommand';
	const commandName = 'mycommand';
	const args = message
		.slice(commandName.length + 2)
		.trim()
		.split(/\s+/)
		.filter(arg => arg);

	t.deepEqual(args, []);
});

test('custom command args extraction - extra whitespace', t => {
	const message = '/mycommand   arg1    arg2  ';
	const commandName = 'mycommand';
	const args = message
		.slice(commandName.length + 2)
		.trim()
		.split(/\s+/)
		.filter(arg => arg);

	t.deepEqual(args, ['arg1', 'arg2']);
});

// Test checkpoint load detection
test('checkpoint load detection - load subcommand', t => {
	const commandParts = ['checkpoint', 'load'];
	const isCheckpointLoad =
		commandParts[0] === 'checkpoint' &&
		(commandParts[1] === 'load' || commandParts[1] === 'restore') &&
		commandParts.length === 2;
	t.true(isCheckpointLoad);
});

test('checkpoint load detection - restore subcommand', t => {
	const commandParts = ['checkpoint', 'restore'];
	const isCheckpointLoad =
		commandParts[0] === 'checkpoint' &&
		(commandParts[1] === 'load' || commandParts[1] === 'restore') &&
		commandParts.length === 2;
	t.true(isCheckpointLoad);
});

test('checkpoint load detection - with specific checkpoint name', t => {
	const commandParts = ['checkpoint', 'load', 'my-checkpoint'];
	const isCheckpointLoad =
		commandParts[0] === 'checkpoint' &&
		(commandParts[1] === 'load' || commandParts[1] === 'restore') &&
		commandParts.length === 2;
	// Should be false - specific checkpoint specified
	t.false(isCheckpointLoad);
});

test('checkpoint load detection - other checkpoint subcommand', t => {
	const commandParts = ['checkpoint', 'save'];
	const isCheckpointLoad =
		commandParts[0] === 'checkpoint' &&
		(commandParts[1] === 'load' || commandParts[1] === 'restore') &&
		commandParts.length === 2;
	t.false(isCheckpointLoad);
});

// Test setup-mcp command parsing
test('setup-mcp command parsing - extracts command name correctly', t => {
	const message = '/setup-mcp';
	const commandName = message.slice(1).split(/\s+/)[0];
	t.is(commandName, 'setup-mcp');
});

test('setup-mcp command parsing - handles command with extra whitespace', t => {
	const message = '/setup-mcp   ';
	const commandName = message.slice(1).split(/\s+/)[0];
	t.is(commandName, 'setup-mcp');
});
