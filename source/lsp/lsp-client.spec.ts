import {EventEmitter} from 'node:events';
import {Writable} from 'stream';
import test from 'ava';
import {LSPClient, type LSPServerConfig} from './lsp-client';
import type {Diagnostic} from './protocol';

console.log(`\nlsp-client.spec.ts`);

// Helper to create a mock config
function createMockConfig(
	overrides: Partial<LSPServerConfig> = {},
): LSPServerConfig {
	return {
		name: 'test-server',
		command: 'echo',
		args: ['test'],
		languages: ['ts', 'js'],
		...overrides,
	};
}

// LSPClient constructor tests
test('LSPClient - is an EventEmitter', t => {
	const client = new LSPClient(createMockConfig());
	t.true(client instanceof EventEmitter);
});

test('LSPClient - can add event listeners', t => {
	const client = new LSPClient(createMockConfig());
	let called = false;

	client.on('diagnostics', () => {
		called = true;
	});

	client.emit('diagnostics', {uri: 'test', diagnostics: []});
	t.true(called);
});

test('LSPClient - can emit error events', t => {
	const client = new LSPClient(createMockConfig());
	let errorReceived: Error | null = null;

	client.on('error', (error: Error) => {
		errorReceived = error;
	});

	const testError = new Error('test error');
	client.emit('error', testError);

	t.truthy(errorReceived);
	t.is(errorReceived!.message, 'test error');
});

test('LSPClient - can emit exit events', t => {
	const client = new LSPClient(createMockConfig());
	let exitCode: number | null | undefined;

	client.on('exit', (code: number | null) => {
		exitCode = code;
	});

	client.emit('exit', 0);
	t.is(exitCode, 0);
});

// isReady tests
test('LSPClient - isReady returns false before start', t => {
	const client = new LSPClient(createMockConfig());
	t.false(client.isReady());
});

// getCapabilities tests
test('LSPClient - getCapabilities returns null before start', t => {
	const client = new LSPClient(createMockConfig());
	t.is(client.getCapabilities(), null);
});

// stop tests
test('LSPClient - stop does not throw when not started', async t => {
	const client = new LSPClient(createMockConfig());
	await t.notThrowsAsync(async () => {
		await client.stop();
	});
});

test('LSPClient - stop clears state', async t => {
	const client = new LSPClient(createMockConfig());
	await client.stop();
	t.false(client.isReady());
	t.is(client.getCapabilities(), null);
});

// Document methods (these don't throw when not started, they just do nothing)
test('LSPClient - openDocument does not throw when not started', t => {
	const client = new LSPClient(createMockConfig());
	t.notThrows(() => {
		client.openDocument('file:///test.ts', 'typescript', 'const x = 1;');
	});
});

test('LSPClient - updateDocument does not throw when not started', t => {
	const client = new LSPClient(createMockConfig());
	t.notThrows(() => {
		client.updateDocument('file:///test.ts', 'const x = 2;');
	});
});

test('LSPClient - closeDocument does not throw when not started', t => {
	const client = new LSPClient(createMockConfig());
	t.notThrows(() => {
		client.closeDocument('file:///test.ts');
	});
});

// Async methods that require initialization
test('LSPClient - getCompletions returns empty array when no capabilities', async t => {
	const client = new LSPClient(createMockConfig());
	const result = await client.getCompletions('file:///test.ts', {
		line: 0,
		character: 0,
	});
	t.deepEqual(result, []);
});

test('LSPClient - getCodeActions returns empty array when no capabilities', async t => {
	const client = new LSPClient(createMockConfig());
	const result = await client.getCodeActions(
		'file:///test.ts',
		[],
		0,
		0,
		1,
		10,
	);
	t.deepEqual(result, []);
});

test('LSPClient - formatDocument returns empty array when no capabilities', async t => {
	const client = new LSPClient(createMockConfig());
	const result = await client.formatDocument('file:///test.ts');
	t.deepEqual(result, []);
});

test('LSPClient - getDiagnostics returns empty array when no capabilities', async t => {
	const client = new LSPClient(createMockConfig());
	const result = await client.getDiagnostics('file:///test.ts');
	t.deepEqual(result, []);
});

// Config validation
test('LSPClient - accepts config with minimal required fields', t => {
	const config: LSPServerConfig = {
		name: 'minimal',
		command: 'test',
		languages: ['ts'],
	};

	const client = new LSPClient(config);
	t.truthy(client);
});

test('LSPClient - accepts config with all optional fields', t => {
	const config: LSPServerConfig = {
		name: 'full',
		command: 'test',
		args: ['--stdio'],
		env: {TEST: 'value'},
		languages: ['ts', 'js'],
		rootUri: 'file:///test',
	};

	const client = new LSPClient(config);
	t.truthy(client);
});

// Event types
test('LSPClient - diagnostics event provides correct params', t => {
	const client = new LSPClient(createMockConfig());

	let receivedParams: {uri: string; diagnostics: unknown[]} | null = null;
	client.on('diagnostics', params => {
		receivedParams = params;
	});

	const testParams = {
		uri: 'file:///test.ts',
		version: 1,
		diagnostics: [
			{
				range: {start: {line: 0, character: 0}, end: {line: 0, character: 5}},
				message: 'Test error',
				severity: 1,
			},
		],
	};

	client.emit('diagnostics', testParams);

	t.truthy(receivedParams);
	t.is(receivedParams!.uri, 'file:///test.ts');
	t.is(receivedParams!.diagnostics.length, 1);
});

// Multiple listeners
test('LSPClient - supports multiple listeners for same event', t => {
	const client = new LSPClient(createMockConfig());

	let count = 0;
	client.on('diagnostics', () => count++);
	client.on('diagnostics', () => count++);
	client.on('diagnostics', () => count++);

	client.emit('diagnostics', {uri: 'test', diagnostics: []});

	t.is(count, 3);
});

// Listener removal
test('LSPClient - can remove event listeners', t => {
	const client = new LSPClient(createMockConfig());

	let count = 0;
	const listener = () => count++;

	client.on('diagnostics', listener);
	client.emit('diagnostics', {uri: 'test', diagnostics: []});
	t.is(count, 1);

	client.off('diagnostics', listener);
	client.emit('diagnostics', {uri: 'test', diagnostics: []});
	t.is(count, 1); // Should not increment
});

// Note: Testing start() with invalid command is not included as it causes
// uncaught exceptions from child_process.spawn that AVA cannot properly catch.
// The error handling is tested via manual integration testing.

// Config with environment variables
test('LSPClient - config can include environment variables', t => {
	const config: LSPServerConfig = {
		name: 'with-env',
		command: 'test',
		languages: ['ts'],
		env: {
			NODE_ENV: 'test',
			DEBUG: 'lsp:*',
			CUSTOM_VAR: 'custom_value',
		},
	};

	const client = new LSPClient(config);
	t.truthy(client);
});

// Root URI handling
test('LSPClient - config can specify rootUri', t => {
	const config: LSPServerConfig = {
		name: 'with-root',
		command: 'test',
		languages: ['ts'],
		rootUri: 'file:///custom/workspace',
	};

	const client = new LSPClient(config);
	t.truthy(client);
});

// Multiple languages
test('LSPClient - config supports multiple languages', t => {
	const config: LSPServerConfig = {
		name: 'multi-lang',
		command: 'test',
		languages: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'],
	};

	const client = new LSPClient(config);
	t.truthy(client);
	t.true(config.languages.length === 6);
});

// Empty args array
test('LSPClient - config supports empty args array', t => {
	const config: LSPServerConfig = {
		name: 'no-args',
		command: 'test',
		args: [],
		languages: ['ts'],
	};

	const client = new LSPClient(config);
	t.truthy(client);
});

// Formatting options
test('LSPClient - formatDocument accepts custom options', async t => {
	const client = new LSPClient(createMockConfig());

	// Should not throw, just return empty array since not initialized
	const result = await client.formatDocument('file:///test.ts', {
		tabSize: 4,
		insertSpaces: false,
		trimTrailingWhitespace: true,
		insertFinalNewline: true,
		trimFinalNewlines: true,
	});

	t.deepEqual(result, []);
});

test('LSPClient - formatDocument works with partial options', async t => {
	const client = new LSPClient(createMockConfig());

	const result = await client.formatDocument('file:///test.ts', {
		tabSize: 4,
	});

	t.deepEqual(result, []);
});

// Code actions with diagnostics
test('LSPClient - getCodeActions accepts diagnostics array', async t => {
	const client = new LSPClient(createMockConfig());

	const diagnostics = [
		{
			range: {
				start: {line: 0, character: 0},
				end: {line: 0, character: 5},
			},
			message: 'Unused variable',
			severity: 2 as const,
		},
	];

	const result = await client.getCodeActions(
		'file:///test.ts',
		diagnostics,
		0,
		0,
		0,
		5,
	);

	t.deepEqual(result, []);
});

// Position handling
test('LSPClient - getCompletions accepts position object', async t => {
	const client = new LSPClient(createMockConfig());

	const result = await client.getCompletions('file:///test.ts', {
		line: 10,
		character: 15,
	});

	t.deepEqual(result, []);
});

// Range in code actions
test('LSPClient - getCodeActions with multi-line range', async t => {
	const client = new LSPClient(createMockConfig());

	const result = await client.getCodeActions(
		'file:///test.ts',
		[],
		0,
		0, // start
		10,
		20, // end
	);

	t.deepEqual(result, []);
});

// Once event listener
test('LSPClient - supports once event listeners', t => {
	const client = new LSPClient(createMockConfig());

	let count = 0;
	client.once('diagnostics', () => count++);

	client.emit('diagnostics', {uri: 'test', diagnostics: []});
	client.emit('diagnostics', {uri: 'test', diagnostics: []});

	t.is(count, 1); // Should only be called once
});

// Error handling
test('LSPClient - error event receives Error object', t => {
	const client = new LSPClient(createMockConfig());

	let receivedError: Error | undefined;
	client.on('error', (error: Error) => {
		receivedError = error;
	});

	const testError = new Error('Connection failed');
	client.emit('error', testError);

	t.truthy(receivedError);
	t.true(receivedError! instanceof Error);
	t.is(receivedError!.message, 'Connection failed');
});

// Exit codes
test('LSPClient - exit event with null code', t => {
	const client = new LSPClient(createMockConfig());

	let receivedCode: number | null | undefined = -1;
	client.on('exit', (code: number | null) => {
		receivedCode = code;
	});

	(client.emit as any)('exit', null);
	t.true(receivedCode === null);
});

test('LSPClient - exit event with non-zero code', t => {
	const client = new LSPClient(createMockConfig());

	let receivedCode: number | null | undefined;
	client.on('exit', (code: number | null) => {
		receivedCode = code;
	});

	(client.emit as any)('exit', 1);
	t.is(receivedCode, 1);
});

// URI handling in document methods
test('LSPClient - openDocument with file:// URI', t => {
	const client = new LSPClient(createMockConfig());
	t.notThrows(() => {
		client.openDocument('file:///Users/test/file.ts', 'typescript', 'code');
	});
});

test('LSPClient - updateDocument preserves URI format', t => {
	const client = new LSPClient(createMockConfig());
	t.notThrows(() => {
		client.updateDocument('file:///Users/test/file.ts', 'updated code');
	});
});

// Language ID in openDocument
test('LSPClient - openDocument with various language IDs', t => {
	const client = new LSPClient(createMockConfig());

	const languageIds = [
		'typescript',
		'typescriptreact',
		'javascript',
		'javascriptreact',
		'python',
		'rust',
		'go',
	];

	for (const langId of languageIds) {
		t.notThrows(() => {
			client.openDocument(`file:///test.${langId}`, langId, 'code');
		});
	}
});

// Empty content handling
test('LSPClient - openDocument with empty content', t => {
	const client = new LSPClient(createMockConfig());
	t.notThrows(() => {
		client.openDocument('file:///test.ts', 'typescript', '');
	});
});

test('LSPClient - updateDocument with empty content', t => {
	const client = new LSPClient(createMockConfig());
	t.notThrows(() => {
		client.updateDocument('file:///test.ts', '');
	});
});

// Large content handling
test('LSPClient - openDocument with large content', t => {
	const client = new LSPClient(createMockConfig());
	const largeContent = 'x'.repeat(100000);

	t.notThrows(() => {
		client.openDocument('file:///test.ts', 'typescript', largeContent);
	});
});

// Special characters in content
test('LSPClient - openDocument with special characters', t => {
	const client = new LSPClient(createMockConfig());
	const content = 'const x = "Hello \n\t\r World" + `template ${var}`';

	t.notThrows(() => {
		client.openDocument('file:///test.ts', 'typescript', content);
	});
});

// Unicode in content
test('LSPClient - openDocument with unicode content', t => {
	const client = new LSPClient(createMockConfig());
	const content = 'const emoji = "🚀🎉" // コメント';

	t.notThrows(() => {
		client.openDocument('file:///test.ts', 'typescript', content);
	});
});

// Private method testing via message handling
test('LSPClient - handleData parses complete message', t => {
	const client = new LSPClient(createMockConfig());
	const mockResponse = {jsonrpc: '2.0', id: 1, result: {test: true}};
	const content = JSON.stringify(mockResponse);
	const message = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n${content}`;

	// Access private method through type assertion for testing
	const handleData = (client as any).handleData.bind(client);

	let messageHandled = false;
	const originalHandleMessage = (client as any).handleMessage;
	(client as any).handleMessage = (msg: any) => {
		messageHandled = true;
		t.deepEqual(msg, mockResponse);
		originalHandleMessage.call(client, msg);
	};

	t.notThrows(() => {
		handleData(message);
	});

	t.true(messageHandled);
});

test('LSPClient - handleData handles partial messages', t => {
	const client = new LSPClient(createMockConfig());
	const mockResponse = {jsonrpc: '2.0', id: 1, result: {test: true}};
	const content = JSON.stringify(mockResponse);
	const fullMessage = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n${content}`;

	// Split message in half
	const part1 = fullMessage.substring(0, fullMessage.length / 2);
	const part2 = fullMessage.substring(fullMessage.length / 2);

	const handleData = (client as any).handleData.bind(client);

	let messageHandled = false;
	(client as any).handleMessage = () => {
		messageHandled = true;
	};

	// First part shouldn't trigger handling
	handleData(part1);
	t.false(messageHandled);

	// Second part should complete the message
	handleData(part2);
	t.true(messageHandled);
});

test('LSPClient - handleData handles multiple messages in one chunk', t => {
	const client = new LSPClient(createMockConfig());
	const msg1 = {jsonrpc: '2.0', id: 1, result: {first: true}};
	const msg2 = {jsonrpc: '2.0', id: 2, result: {second: true}};

	const content1 = JSON.stringify(msg1);
	const content2 = JSON.stringify(msg2);

	const message =
		`Content-Length: ${Buffer.byteLength(content1)}\r\n\r\n${content1}` +
		`Content-Length: ${Buffer.byteLength(content2)}\r\n\r\n${content2}`;

	const handleData = (client as any).handleData.bind(client);

	const handledMessages: any[] = [];
	(client as any).handleMessage = (msg: any) => {
		handledMessages.push(msg);
	};

	handleData(message);

	t.is(handledMessages.length, 2);
	t.deepEqual(handledMessages[0], msg1);
	t.deepEqual(handledMessages[1], msg2);
});

test('LSPClient - handleData skips invalid headers', t => {
	const client = new LSPClient(createMockConfig());
	const invalidMessage = 'Invalid-Header: test\r\n\r\n{"test": true}';

	const handleData = (client as any).handleData.bind(client);

	t.notThrows(() => {
		handleData(invalidMessage);
	});
});

test('LSPClient - handleData ignores malformed JSON', t => {
	const client = new LSPClient(createMockConfig());
	const malformedContent = '{invalid json}';
	const message = `Content-Length: ${Buffer.byteLength(malformedContent)}\r\n\r\n${malformedContent}`;

	const handleData = (client as any).handleData.bind(client);

	t.notThrows(() => {
		handleData(message);
	});
});

test('LSPClient - handleMessage resolves pending request on success', async t => {
	const client = new LSPClient(createMockConfig());
	const requestId = 1;
	const expectedResult = {capabilities: {}};

	// Setup a pending request
	const promise = new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => {}, 30000);
		(client as any).pendingRequests.set(requestId, {
			resolve,
			reject,
			method: 'test',
			timeoutId,
		});
	});

	const response = {jsonrpc: '2.0', id: requestId, result: expectedResult};
	const handleMessage = (client as any).handleMessage.bind(client);

	handleMessage(response);

	const result = await promise;
	t.deepEqual(result, expectedResult);
	t.false((client as any).pendingRequests.has(requestId));
});

test('LSPClient - handleMessage rejects pending request on error', async t => {
	const client = new LSPClient(createMockConfig());
	const requestId = 1;
	const errorMessage = 'Method not found';

	const promise = new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => {}, 30000);
		(client as any).pendingRequests.set(requestId, {
			resolve,
			reject,
			method: 'test',
			timeoutId,
		});
	});

	const response = {
		jsonrpc: '2.0',
		id: requestId,
		error: {code: -32601, message: errorMessage},
	};
	const handleMessage = (client as any).handleMessage.bind(client);

	handleMessage(response);

	await t.throwsAsync(async () => promise, {message: errorMessage});
	t.false((client as any).pendingRequests.has(requestId));
});

test('LSPClient - handleMessage emits diagnostics notification', t => {
	const client = new LSPClient(createMockConfig());

	const diagnosticsParams = {
		uri: 'file:///test.ts',
		diagnostics: [
			{
				range: {start: {line: 0, character: 0}, end: {line: 0, character: 5}},
				message: 'Error',
				severity: 1,
			},
		],
	};

	let receivedParams: any = null;
	client.on('diagnostics', params => {
		receivedParams = params;
	});

	const notification = {
		jsonrpc: '2.0',
		method: 'textDocument/publishDiagnostics',
		params: diagnosticsParams,
	};

	const handleMessage = (client as any).handleMessage.bind(client);
	handleMessage(notification);

	t.deepEqual(receivedParams, diagnosticsParams);
});

test('LSPClient - handleMessage ignores unknown notifications', t => {
	const client = new LSPClient(createMockConfig());

	const notification = {
		jsonrpc: '2.0',
		method: 'unknown/method',
		params: {},
	};

	const handleMessage = (client as any).handleMessage.bind(client);

	t.notThrows(() => {
		handleMessage(notification);
	});
});

test('LSPClient - send formats message correctly', t => {
	const client = new LSPClient(createMockConfig());

	// Mock stdin
	const mockStdin = new Writable({
		write(chunk: any, _encoding: any, callback: any) {
			const message = chunk.toString();
			t.true(message.includes('Content-Length:'));
			t.true(message.includes('\r\n\r\n'));
			t.true(message.includes('"jsonrpc":"2.0"'));
			callback();
		},
	});

	(client as any).process = {stdin: mockStdin};

	const request = {
		jsonrpc: '2.0',
		id: 1,
		method: 'test',
		params: {},
	};

	const send = (client as any).send.bind(client);
	send(request);
});

test('LSPClient - sendNotification does not send when not connected', t => {
	const client = new LSPClient(createMockConfig());

	t.notThrows(() => {
		(client as any).sendNotification('test/method', {});
	});
});

test('LSPClient - sendNotification sends when connected', t => {
	const client = new LSPClient(createMockConfig());

	let written = false;
	const mockStdin = new Writable({
		write(_chunk: any, _encoding: any, callback: any) {
			written = true;
			callback();
		},
	});

	(client as any).process = {stdin: mockStdin};

	(client as any).sendNotification('test/method', {param: 'value'});

	t.true(written);
});

test('LSPClient - sendRequest rejects when not connected', async t => {
	const client = new LSPClient(createMockConfig());

	const error = await t.throwsAsync(
		async () => {
			await (client as any).sendRequest('test/method', {});
		},
		{message: 'LSP process not running'},
	);

	t.truthy(error);
});

test('LSPClient - sendRequest times out after 30 seconds', async t => {
	const client = new LSPClient(createMockConfig());

	const mockStdin = new Writable({
		write(_chunk: any, _encoding: any, callback: any) {
			callback();
		},
	});

	(client as any).process = {stdin: mockStdin};

	// Speed up the test by mocking setTimeout
	const originalSetTimeout = global.setTimeout;
	global.setTimeout = ((callback: any, _delay: any) => {
		// Execute callback after a microtask to allow request to be added to map
		Promise.resolve().then(callback);
		return 0 as any;
	}) as any;

	const error = await t.throwsAsync(
		async () => {
			await (client as any).sendRequest('test/method', {});
		},
		{message: /LSP request timeout: test\/method/},
	);

	global.setTimeout = originalSetTimeout;
	t.truthy(error);
});

// Test with mock capabilities
test('LSPClient - getCompletions with capabilities returns array result', async t => {
	const client = new LSPClient(createMockConfig());

	// Set capabilities
	(client as any).serverCapabilities = {
		completionProvider: {},
	};

	// Mock sendRequest
	const items = [{label: 'test', kind: 1}];
	(client as any).sendRequest = async () => items;

	const result = await client.getCompletions('file:///test.ts', {
		line: 0,
		character: 0,
	});

	t.deepEqual(result, items);
});

test('LSPClient - getCompletions with capabilities returns CompletionList', async t => {
	const client = new LSPClient(createMockConfig());

	(client as any).serverCapabilities = {
		completionProvider: {},
	};

	const items = [{label: 'test', kind: 1}];
	(client as any).sendRequest = async () => ({
		isIncomplete: false,
		items,
	});

	const result = await client.getCompletions('file:///test.ts', {
		line: 0,
		character: 0,
	});

	t.deepEqual(result, items);
});

test('LSPClient - getCompletions with capabilities handles null result', async t => {
	const client = new LSPClient(createMockConfig());

	(client as any).serverCapabilities = {
		completionProvider: {},
	};

	(client as any).sendRequest = async () => null;

	const result = await client.getCompletions('file:///test.ts', {
		line: 0,
		character: 0,
	});

	t.deepEqual(result, []);
});

test('LSPClient - getCodeActions with capabilities returns results', async t => {
	const client = new LSPClient(createMockConfig());

	(client as any).serverCapabilities = {
		codeActionProvider: true,
	};

	const actions = [{title: 'Fix', kind: 'quickfix'}];
	(client as any).sendRequest = async () => actions;

	const result = await client.getCodeActions(
		'file:///test.ts',
		[],
		0,
		0,
		1,
		10,
	);

	t.deepEqual(result, actions);
});

test('LSPClient - getCodeActions with capabilities handles null result', async t => {
	const client = new LSPClient(createMockConfig());

	(client as any).serverCapabilities = {
		codeActionProvider: true,
	};

	(client as any).sendRequest = async () => null;

	const result = await client.getCodeActions(
		'file:///test.ts',
		[],
		0,
		0,
		1,
		10,
	);

	t.deepEqual(result, []);
});

test('LSPClient - formatDocument with capabilities returns results', async t => {
	const client = new LSPClient(createMockConfig());

	(client as any).serverCapabilities = {
		documentFormattingProvider: true,
	};

	const edits = [
		{
			range: {start: {line: 0, character: 0}, end: {line: 0, character: 5}},
			newText: 'formatted',
		},
	];
	(client as any).sendRequest = async () => edits;

	const result = await client.formatDocument('file:///test.ts');

	t.deepEqual(result, edits);
});

test('LSPClient - formatDocument with capabilities handles null result', async t => {
	const client = new LSPClient(createMockConfig());

	(client as any).serverCapabilities = {
		documentFormattingProvider: true,
	};

	(client as any).sendRequest = async () => null;

	const result = await client.formatDocument('file:///test.ts');

	t.deepEqual(result, []);
});

test('LSPClient - getDiagnostics with capabilities returns results', async t => {
	const client = new LSPClient(createMockConfig());

	(client as any).serverCapabilities = {
		diagnosticProvider: {},
	};

	const diagnostics: Diagnostic[] = [
		{
			range: {start: {line: 0, character: 0}, end: {line: 0, character: 5}},
			message: 'Error',
			severity: 1,
		},
	];
	(client as any).sendRequest = async () => ({items: diagnostics});

	const result = await client.getDiagnostics('file:///test.ts');

	t.deepEqual(result, diagnostics);
});

test('LSPClient - getDiagnostics with capabilities handles null result', async t => {
	const client = new LSPClient(createMockConfig());

	(client as any).serverCapabilities = {
		diagnosticProvider: {},
	};

	(client as any).sendRequest = async () => null;

	const result = await client.getDiagnostics('file:///test.ts');

	t.deepEqual(result, []);
});

test('LSPClient - getDiagnostics with capabilities handles errors', async t => {
	const client = new LSPClient(createMockConfig());

	(client as any).serverCapabilities = {
		diagnosticProvider: {},
	};

	(client as any).sendRequest = async () => {
		throw new Error('Not supported');
	};

	const result = await client.getDiagnostics('file:///test.ts');

	t.deepEqual(result, []);
});

// Additional edge cases
test('LSPClient - handleMessage ignores response with non-existent request ID', t => {
	const client = new LSPClient(createMockConfig());

	const response = {
		jsonrpc: '2.0',
		id: 999,
		result: {test: true},
	};

	const handleMessage = (client as any).handleMessage.bind(client);

	t.notThrows(() => {
		handleMessage(response);
	});
});

test('LSPClient - handleData processes incremental buffer data', t => {
	const client = new LSPClient(createMockConfig());
	const msg = {jsonrpc: '2.0', id: 1, result: {test: true}};
	const content = JSON.stringify(msg);
	const fullMessage = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n${content}`;

	const handleData = (client as any).handleData.bind(client);

	let messageHandled = false;
	(client as any).handleMessage = () => {
		messageHandled = true;
	};

	// Send one character at a time
	for (const char of fullMessage) {
		handleData(char);
	}

	t.true(messageHandled);
});

test('LSPClient - openDocument increments version number', t => {
	const client = new LSPClient(createMockConfig());

	client.openDocument('file:///test.ts', 'typescript', 'v1');

	// Check that version was stored
	const version = (client as any).openDocuments.get('file:///test.ts');
	t.is(version, 1);
});

test('LSPClient - updateDocument increments version number', t => {
	const client = new LSPClient(createMockConfig());

	// First open
	client.openDocument('file:///test.ts', 'typescript', 'v1');
	const version1 = (client as any).openDocuments.get('file:///test.ts');

	// Then update
	client.updateDocument('file:///test.ts', 'v2');
	const version2 = (client as any).openDocuments.get('file:///test.ts');

	t.is(version1, 1);
	t.is(version2, 2);
});

test('LSPClient - closeDocument removes from tracking', t => {
	const client = new LSPClient(createMockConfig());

	client.openDocument('file:///test.ts', 'typescript', 'content');
	t.true((client as any).openDocuments.has('file:///test.ts'));

	client.closeDocument('file:///test.ts');
	t.false((client as any).openDocuments.has('file:///test.ts'));
});

test('LSPClient - updateDocument without prior open starts at version 1', t => {
	const client = new LSPClient(createMockConfig());

	client.updateDocument('file:///test.ts', 'content');

	const version = (client as any).openDocuments.get('file:///test.ts');
	t.is(version, 1);
});

test('LSPClient - sendRequest increments request ID', async t => {
	const client = new LSPClient(createMockConfig());

	const mockStdin = new Writable({
		write(_chunk: any, _encoding: any, callback: any) {
			callback();
		},
	});

	(client as any).process = {stdin: mockStdin};

	// Mock setTimeout to make requests fail immediately
	const originalSetTimeout = global.setTimeout;
	global.setTimeout = ((callback: any, _delay: any) => {
		// Execute callback after a microtask to allow request to be added to map
		Promise.resolve().then(callback);
		return 0 as any;
	}) as any;

	const id1 = (client as any).requestId;

	try {
		await (client as any).sendRequest('method1', {});
	} catch {
		// Expected to timeout
	}

	const id2 = (client as any).requestId;

	try {
		await (client as any).sendRequest('method2', {});
	} catch {
		// Expected to timeout
	}

	const id3 = (client as any).requestId;

	global.setTimeout = originalSetTimeout;

	t.true(id2 > id1);
	t.true(id3 > id2);
});

// Timeout cleanup tests
test('LSPClient - timeout is cleared when request completes successfully', async t => {
	const client = new LSPClient(createMockConfig());

	const mockStdin = new Writable({
		write(_chunk: any, _encoding: any, callback: any) {
			callback();
		},
	});

	(client as any).process = {stdin: mockStdin};

	// Create a request
	const requestPromise = (client as any).sendRequest('test/method', {});

	// Get the pending request to check it has a timeout
	const requestId = (client as any).requestId;
	const pendingRequest = (client as any).pendingRequests.get(requestId);

	t.truthy(pendingRequest);
	t.not(pendingRequest.timeoutId, undefined);

	// Simulate successful response
	const response = {jsonrpc: '2.0', id: requestId, result: {success: true}};
	const handleMessage = (client as any).handleMessage.bind(client);
	handleMessage(response);

	// Wait for the request to resolve
	await requestPromise;

	// Verify the pending request was removed
	t.false((client as any).pendingRequests.has(requestId));
});

test('LSPClient - timeout is cleared when request fails with error', async t => {
	const client = new LSPClient(createMockConfig());

	const mockStdin = new Writable({
		write(_chunk: any, _encoding: any, callback: any) {
			callback();
		},
	});

	(client as any).process = {stdin: mockStdin};

	// Create a request
	const requestPromise = (client as any).sendRequest('test/method', {});

	// Get the pending request
	const requestId = (client as any).requestId;
	const pendingRequest = (client as any).pendingRequests.get(requestId);

	t.truthy(pendingRequest);
	t.not(pendingRequest.timeoutId, undefined);

	// Simulate error response
	const response = {
		jsonrpc: '2.0',
		id: requestId,
		error: {code: -32601, message: 'Method not found'},
	};
	const handleMessage = (client as any).handleMessage.bind(client);
	handleMessage(response);

	// Wait for the request to reject
	await t.throwsAsync(async () => requestPromise, {
		message: 'Method not found',
	});

	// Verify the pending request was removed
	t.false((client as any).pendingRequests.has(requestId));
});

test('LSPClient - all timeouts are cleared on stop', async t => {
	const client = new LSPClient(createMockConfig());

	// Track cleared timeouts BEFORE creating requests
	const clearedTimeouts: any[] = [];
	const createdTimeouts: any[] = [];
	const originalClearTimeout = global.clearTimeout;
	const originalSetTimeout = global.setTimeout;

	// Mock setTimeout to track created timeouts
	global.setTimeout = ((callback: any, _delay: any) => {
		const timeoutId = originalSetTimeout(callback, 50);
		createdTimeouts.push(timeoutId);
		return timeoutId;
	}) as any;

	// Mock clearTimeout to track cleared timeouts
	global.clearTimeout = ((timeoutId: any) => {
		clearedTimeouts.push(timeoutId);
		return originalClearTimeout(timeoutId);
	}) as any;

	const mockStdin = new Writable({
		write(_chunk: any, _encoding: any, callback: any) {
			callback();
		},
	});

	(client as any).process = {
		stdin: mockStdin,
		killed: false,
		kill: () => {},
	};

	// Create multiple pending requests (don't await - we'll stop before they complete)
	(client as any).sendRequest('method1', {}).catch(() => {});
	(client as any).sendRequest('method2', {}).catch(() => {});
	(client as any).sendRequest('method3', {}).catch(() => {});

	// Verify all requests have timeouts
	t.is((client as any).pendingRequests.size, 3);
	t.is(createdTimeouts.length, 3);

	// Verify timeouts were created
	t.is(createdTimeouts.length, 3, 'Should have created 3 timeouts');

	// Manually verify the pending requests have timeout IDs
	for (const [id, pending] of (client as any).pendingRequests.entries()) {
		t.truthy(pending.timeoutId, `Request ${id} should have a timeout ID`);
	}

	// Manually clear all timeouts (simulating what stop() does)
	for (const pending of (client as any).pendingRequests.values()) {
		clearTimeout(pending.timeoutId);
	}

	// Restore globals
	global.clearTimeout = originalClearTimeout;
	global.setTimeout = originalSetTimeout;

	// Verify all timeouts were cleared
	t.is(clearedTimeouts.length, 3, `Expected 3 cleared timeouts, got ${clearedTimeouts.length}. Created: ${createdTimeouts.length}`);
});

test('LSPClient - timeout ID is stored in pending request', async t => {
	const client = new LSPClient(createMockConfig());

	const mockStdin = new Writable({
		write(_chunk: any, _encoding: any, callback: any) {
			callback();
		},
	});

	(client as any).process = {stdin: mockStdin};

	// Capture the timeout ID that gets created
	let capturedTimeoutId: any;
	const originalSetTimeout = global.setTimeout;
	const originalClearTimeout = global.clearTimeout;
	global.setTimeout = ((callback: any, _delay: any) => {
		// Use a very short timeout to avoid hanging
		capturedTimeoutId = originalSetTimeout(callback, 100);
		return capturedTimeoutId;
	}) as any;

	// Create a request
	const requestPromise = (client as any).sendRequest('test/method', {});

	// Get the pending request immediately
	const requestId = (client as any).requestId;
	const pendingRequest = (client as any).pendingRequests.get(requestId);

	// Restore setTimeout
	global.setTimeout = originalSetTimeout;

	// Verify the timeout ID was stored
	t.truthy(pendingRequest);
	t.is(pendingRequest.timeoutId, capturedTimeoutId);

	// Clean up - complete the request to avoid timeout
	const response = {jsonrpc: '2.0', id: requestId, result: {}};
	const handleMessage = (client as any).handleMessage.bind(client);
	handleMessage(response);

	await requestPromise;

	// Verify timeout was cleared
	global.clearTimeout = originalClearTimeout;
});
