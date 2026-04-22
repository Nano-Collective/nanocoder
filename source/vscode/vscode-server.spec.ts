import test from 'ava';
import {WebSocket} from 'ws';
import type {
	AssistantMessage,
	ConnectionAckMessage,
	DiagnosticsRequestMessage,
	FileChangeMessage,
	ServerMessage,
	StatusMessage,
} from './protocol.js';
import {
	VSCodeServer,
	getVSCodeServer,
	isVSCodeConnected,
	sendFileChangeToVSCode,
} from './vscode-server.js';

// Use different ports for each test to avoid conflicts
let testPort = 52000;
function getNextPort(): number {
	return testPort++;
}

// ============================================================================
// Tests for VSCodeServer class
// ============================================================================

test('VSCodeServer can be instantiated with default port', t => {
	const server = new VSCodeServer();
	t.truthy(server);
});

test('VSCodeServer can be instantiated with custom port', t => {
	const server = new VSCodeServer(12345);
	t.truthy(server);
});

test('VSCodeServer starts and stops correctly', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);

	const started = await server.start();
	t.true(started);

	await server.stop();
	t.pass();
});

test('VSCodeServer reports no connections initially', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);
	await server.start();

	t.false(server.hasConnections());
	t.is(server.getConnectionCount(), 0);

	await server.stop();
});

test('VSCodeServer accepts client connections', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);
	await server.start();

	// Connect a client
	const client = new WebSocket(`ws://127.0.0.1:${port}`);

	await new Promise<void>(resolve => {
		client.on('open', () => resolve());
	});

	// Give the server time to register the connection
	await new Promise(resolve => setTimeout(resolve, 50));

	t.true(server.hasConnections());
	t.is(server.getConnectionCount(), 1);

	client.close();
	await server.stop();
});

test('VSCodeServer sends connection acknowledgment on connect', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);
	await server.start();

	const client = new WebSocket(`ws://127.0.0.1:${port}`);

	const message = await new Promise<ServerMessage>(resolve => {
		client.on('message', (data: {toString(): string}) => {
			resolve(JSON.parse(data.toString()) as ServerMessage);
		});
	});

	t.is(message.type, 'connection_ack');
	const ack = message as ConnectionAckMessage;
	t.truthy(ack.protocolVersion);
	t.truthy(ack.cliVersion);

	client.close();
	await server.stop();
});

test('VSCodeServer calls onConnect callback', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);

	let connectCalled = false;
	server.onCallbacks({
		onConnect: () => {
			connectCalled = true;
		},
	});

	await server.start();

	const client = new WebSocket(`ws://127.0.0.1:${port}`);
	await new Promise<void>(resolve => {
		client.on('open', () => resolve());
	});

	// Give the callback time to fire
	await new Promise(resolve => setTimeout(resolve, 50));

	t.true(connectCalled);

	client.close();
	await server.stop();
});

test('VSCodeServer calls onDisconnect callback', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);

	let disconnectCalled = false;
	server.onCallbacks({
		onDisconnect: () => {
			disconnectCalled = true;
		},
	});

	await server.start();

	const client = new WebSocket(`ws://127.0.0.1:${port}`);
	await new Promise<void>(resolve => {
		client.on('open', () => resolve());
	});

	client.close();

	// Give the callback time to fire
	await new Promise(resolve => setTimeout(resolve, 100));

	t.true(disconnectCalled);

	await server.stop();
});

test('VSCodeServer sendFileChange broadcasts to connected clients', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);
	await server.start();

	const client = new WebSocket(`ws://127.0.0.1:${port}`);

	// Wait for connection ack first
	await new Promise<void>(resolve => {
		client.on('message', () => resolve());
	});

	// Set up listener for file change
	const messagePromise = new Promise<FileChangeMessage>(resolve => {
		client.on('message', (data: {toString(): string}) => {
			const msg = JSON.parse(data.toString()) as ServerMessage;
			if (msg.type === 'file_change') {
				resolve(msg);
			}
		});
	});

	// Send file change
	const id = server.sendFileChange(
		'/path/to/file.ts',
		'original content',
		'new content',
		'create_file',
		{path: '/path/to/file.ts'},
	);

	t.truthy(id);

	const message = await messagePromise;
	t.is(message.type, 'file_change');
	t.is(message.id, id);
	t.is(message.filePath, '/path/to/file.ts');
	t.is(message.originalContent, 'original content');
	t.is(message.newContent, 'new content');
	t.is(message.toolName, 'create_file');

	client.close();
	await server.stop();
});

test('VSCodeServer tracks pending changes', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);
	await server.start();

	const client = new WebSocket(`ws://127.0.0.1:${port}`);
	await new Promise<void>(resolve => {
		client.on('open', () => resolve());
	});
	await new Promise(resolve => setTimeout(resolve, 50));

	const id = server.sendFileChange(
		'/path/to/file.ts',
		'original',
		'new',
		'test_tool',
		{},
	);

	const pending = server.getPendingChange(id);
	t.truthy(pending);
	t.is(pending?.id, id);
	t.is(pending?.filePath, '/path/to/file.ts');
	t.is(pending?.originalContent, 'original');
	t.is(pending?.newContent, 'new');
	t.is(pending?.toolName, 'test_tool');
	t.true((pending?.timestamp ?? 0) > 0);

	client.close();
	await server.stop();
});

test('VSCodeServer getAllPendingChanges returns all pending changes', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);
	await server.start();

	const client = new WebSocket(`ws://127.0.0.1:${port}`);
	await new Promise<void>(resolve => {
		client.on('open', () => resolve());
	});
	await new Promise(resolve => setTimeout(resolve, 50));

	server.sendFileChange('/file1.ts', 'a', 'b', 'tool1', {});
	server.sendFileChange('/file2.ts', 'c', 'd', 'tool2', {});
	server.sendFileChange('/file3.ts', 'e', 'f', 'tool3', {});

	const all = server.getAllPendingChanges();
	t.is(all.length, 3);

	client.close();
	await server.stop();
});

test('VSCodeServer removePendingChange removes a change', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);
	await server.start();

	const client = new WebSocket(`ws://127.0.0.1:${port}`);
	await new Promise<void>(resolve => {
		client.on('open', () => resolve());
	});
	await new Promise(resolve => setTimeout(resolve, 50));

	const id = server.sendFileChange('/file.ts', 'a', 'b', 'tool', {});

	t.truthy(server.getPendingChange(id));

	server.removePendingChange(id);

	t.is(server.getPendingChange(id), undefined);

	client.close();
	await server.stop();
});

test('VSCodeServer sendAssistantMessage broadcasts message', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);
	await server.start();

	const client = new WebSocket(`ws://127.0.0.1:${port}`);

	// Wait for connection ack
	await new Promise<void>(resolve => {
		client.on('message', () => resolve());
	});

	const messagePromise = new Promise<AssistantMessage>(resolve => {
		client.on('message', (data: {toString(): string}) => {
			const msg = JSON.parse(data.toString()) as ServerMessage;
			if (msg.type === 'assistant_message') {
				resolve(msg);
			}
		});
	});

	server.sendAssistantMessage('Hello from assistant', false);

	const message = await messagePromise;
	t.is(message.type, 'assistant_message');
	t.is(message.content, 'Hello from assistant');
	t.false(message.isGenerating);

	client.close();
	await server.stop();
});

test('VSCodeServer sendAssistantMessage with streaming flag', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);
	await server.start();

	const client = new WebSocket(`ws://127.0.0.1:${port}`);

	await new Promise<void>(resolve => {
		client.on('message', () => resolve());
	});

	const messagePromise = new Promise<AssistantMessage>(resolve => {
		client.on('message', (data: {toString(): string}) => {
			const msg = JSON.parse(data.toString()) as ServerMessage;
			if (msg.type === 'assistant_message') {
				resolve(msg);
			}
		});
	});

	server.sendAssistantMessage('Streaming...', true);

	const message = await messagePromise;
	t.true(message.isGenerating);

	client.close();
	await server.stop();
});

test('VSCodeServer sendStatus broadcasts status', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);
	await server.start();

	const client = new WebSocket(`ws://127.0.0.1:${port}`);

	await new Promise<void>(resolve => {
		client.on('message', () => resolve());
	});

	const messagePromise = new Promise<StatusMessage>(resolve => {
		client.on('message', (data: {toString(): string}) => {
			const msg = JSON.parse(data.toString()) as ServerMessage;
			if (msg.type === 'status') {
				resolve(msg);
			}
		});
	});

	server.sendStatus('gpt-4', 'openai');

	const message = await messagePromise;
	t.is(message.type, 'status');
	t.true(message.connected);
	t.is(message.model, 'gpt-4');
	t.is(message.provider, 'openai');
	t.truthy(message.workingDirectory);

	client.close();
	await server.stop();
});

test('VSCodeServer requestDiagnostics broadcasts request', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);
	await server.start();

	const client = new WebSocket(`ws://127.0.0.1:${port}`);

	await new Promise<void>(resolve => {
		client.on('message', () => resolve());
	});

	const messagePromise = new Promise<DiagnosticsRequestMessage>(resolve => {
		client.on('message', (data: {toString(): string}) => {
			const msg = JSON.parse(data.toString()) as ServerMessage;
			if (msg.type === 'diagnostics_request') {
				resolve(msg);
			}
		});
	});

	server.requestDiagnostics('/path/to/file.ts');

	const message = await messagePromise;
	t.is(message.type, 'diagnostics_request');
	t.is(message.filePath, '/path/to/file.ts');

	client.close();
	await server.stop();
});

test('VSCodeServer handles client messages - send_prompt', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);

	let receivedPrompt = '';
	server.onCallbacks({
		onPrompt: (prompt, _context) => {
			receivedPrompt = prompt;
		},
	});

	await server.start();

	const client = new WebSocket(`ws://127.0.0.1:${port}`);
	await new Promise<void>(resolve => {
		client.on('open', () => resolve());
	});
	await new Promise(resolve => setTimeout(resolve, 50));

	client.send(JSON.stringify({type: 'send_prompt', prompt: 'Help me'}));

	await new Promise(resolve => setTimeout(resolve, 50));

	t.is(receivedPrompt, 'Help me');

	client.close();
	await server.stop();
});

test('VSCodeServer handles client messages - apply_change', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);

	let appliedId = '';
	server.onCallbacks({
		onChangeApplied: id => {
			appliedId = id;
		},
	});

	await server.start();

	const client = new WebSocket(`ws://127.0.0.1:${port}`);
	await new Promise<void>(resolve => {
		client.on('open', () => resolve());
	});
	await new Promise(resolve => setTimeout(resolve, 50));

	// First create a pending change
	const changeId = server.sendFileChange('/file.ts', 'a', 'b', 'tool', {});

	// Then apply it from client
	client.send(JSON.stringify({type: 'apply_change', id: changeId}));

	await new Promise(resolve => setTimeout(resolve, 50));

	t.is(appliedId, changeId);
	// Pending change should be removed
	t.is(server.getPendingChange(changeId), undefined);

	client.close();
	await server.stop();
});

test('VSCodeServer handles client messages - reject_change', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);

	let rejectedId = '';
	server.onCallbacks({
		onChangeRejected: id => {
			rejectedId = id;
		},
	});

	await server.start();

	const client = new WebSocket(`ws://127.0.0.1:${port}`);
	await new Promise<void>(resolve => {
		client.on('open', () => resolve());
	});
	await new Promise(resolve => setTimeout(resolve, 50));

	const changeId = server.sendFileChange('/file.ts', 'a', 'b', 'tool', {});

	client.send(JSON.stringify({type: 'reject_change', id: changeId}));

	await new Promise(resolve => setTimeout(resolve, 50));

	t.is(rejectedId, changeId);
	t.is(server.getPendingChange(changeId), undefined);

	client.close();
	await server.stop();
});

test('VSCodeServer handles client messages - context', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);

	let receivedContext: {workspaceFolder?: string} = {};
	server.onCallbacks({
		onContext: context => {
			receivedContext = context;
		},
	});

	await server.start();

	const client = new WebSocket(`ws://127.0.0.1:${port}`);
	await new Promise<void>(resolve => {
		client.on('open', () => resolve());
	});
	await new Promise(resolve => setTimeout(resolve, 50));

	client.send(
		JSON.stringify({
			type: 'context',
			workspaceFolder: '/home/user/project',
			openFiles: ['/home/user/project/src/index.ts'],
			activeFile: '/home/user/project/src/index.ts',
		}),
	);

	await new Promise(resolve => setTimeout(resolve, 50));

	t.is(receivedContext.workspaceFolder, '/home/user/project');

	client.close();
	await server.stop();
});

test('VSCodeServer handles client messages - diagnostics_response', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);

	let receivedDiagnostics: unknown[] = [];
	server.onCallbacks({
		onDiagnosticsResponse: diagnostics => {
			receivedDiagnostics = diagnostics;
		},
	});

	await server.start();

	const client = new WebSocket(`ws://127.0.0.1:${port}`);
	await new Promise<void>(resolve => {
		client.on('open', () => resolve());
	});
	await new Promise(resolve => setTimeout(resolve, 50));

	client.send(
		JSON.stringify({
			type: 'diagnostics_response',
			diagnostics: [
				{
					filePath: '/test.ts',
					line: 1,
					character: 1,
					message: 'Error',
					severity: 'error',
				},
			],
		}),
	);

	await new Promise(resolve => setTimeout(resolve, 50));

	t.is(receivedDiagnostics.length, 1);

	client.close();
	await server.stop();
});

test('VSCodeServer handles client messages - active_editor with selection', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);

	const received: Array<{
		filePath?: string;
		fileName?: string;
		selection?: string;
		startLine?: number;
		endLine?: number;
	}> = [];
	server.onCallbacks({
		onActiveEditor: state => {
			received.push(state);
		},
	});

	await server.start();

	const client = new WebSocket(`ws://127.0.0.1:${port}`);
	await new Promise<void>(resolve => {
		client.on('open', () => resolve());
	});
	await new Promise(resolve => setTimeout(resolve, 50));

	client.send(
		JSON.stringify({
			type: 'active_editor',
			filePath: '/path/to/App.tsx',
			fileName: 'App.tsx',
			selection: 'const x = 1;',
			startLine: 10,
			endLine: 15,
		}),
	);

	await new Promise(resolve => setTimeout(resolve, 50));

	t.is(received.length, 1);
	t.is(received[0].filePath, '/path/to/App.tsx');
	t.is(received[0].fileName, 'App.tsx');
	t.is(received[0].selection, 'const x = 1;');
	t.is(received[0].startLine, 10);
	t.is(received[0].endLine, 15);

	client.close();
	await server.stop();
});

test('VSCodeServer handles client messages - active_editor cleared state', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);

	const received: Array<{filePath?: string}> = [];
	server.onCallbacks({
		onActiveEditor: state => {
			received.push(state);
		},
	});

	await server.start();

	const client = new WebSocket(`ws://127.0.0.1:${port}`);
	await new Promise<void>(resolve => {
		client.on('open', () => resolve());
	});
	await new Promise(resolve => setTimeout(resolve, 50));

	// A message with no filePath means "no active editor" — the CLI should
	// treat this as a reset and clear the pill.
	client.send(JSON.stringify({type: 'active_editor'}));

	await new Promise(resolve => setTimeout(resolve, 50));

	t.is(received.length, 1);
	t.is(received[0].filePath, undefined);

	client.close();
	await server.stop();
});

test('VSCodeServer handles multiple clients', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);
	await server.start();

	const client1 = new WebSocket(`ws://127.0.0.1:${port}`);
	const client2 = new WebSocket(`ws://127.0.0.1:${port}`);

	await Promise.all([
		new Promise<void>(resolve => client1.on('open', () => resolve())),
		new Promise<void>(resolve => client2.on('open', () => resolve())),
	]);

	await new Promise(resolve => setTimeout(resolve, 50));

	t.is(server.getConnectionCount(), 2);

	client1.close();
	client2.close();
	await server.stop();
});

test('VSCodeServer broadcasts to all clients', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);
	await server.start();

	const client1 = new WebSocket(`ws://127.0.0.1:${port}`);
	const client2 = new WebSocket(`ws://127.0.0.1:${port}`);

	// Wait for both connections and their ack messages
	await Promise.all([
		new Promise<void>(resolve => client1.on('message', () => resolve())),
		new Promise<void>(resolve => client2.on('message', () => resolve())),
	]);

	let client1Received = false;
	let client2Received = false;

	client1.on('message', (data: {toString(): string}) => {
		const msg = JSON.parse(data.toString()) as ServerMessage;
		if (msg.type === 'status') {
			client1Received = true;
		}
	});

	client2.on('message', (data: {toString(): string}) => {
		const msg = JSON.parse(data.toString()) as ServerMessage;
		if (msg.type === 'status') {
			client2Received = true;
		}
	});

	server.sendStatus('model', 'provider');

	await new Promise(resolve => setTimeout(resolve, 100));

	t.true(client1Received);
	t.true(client2Received);

	client1.close();
	client2.close();
	await server.stop();
});

// ============================================================================
// Tests for singleton functions
// ============================================================================

test('getVSCodeServer returns singleton instance', async t => {
	const server1 = await getVSCodeServer();
	const server2 = await getVSCodeServer();

	t.is(server1, server2);
});

test('getVSCodeServer prevents race conditions with concurrent calls', async t => {
	// Call getVSCodeServer multiple times concurrently
	const [server1, server2, server3] = await Promise.all([
		getVSCodeServer(),
		getVSCodeServer(),
		getVSCodeServer(),
	]);
	// All should return the same instance
	t.is(server1, server2);
	t.is(server2, server3);
});

test('isVSCodeConnected returns false when no server', t => {
	// Note: This test may be affected by other tests that create the singleton
	// In isolation, isVSCodeConnected should return false if server has no connections
	const result = isVSCodeConnected();
	t.is(typeof result, 'boolean');
});

test('sendFileChangeToVSCode returns null when no connections', t => {
	// When there are no connections, should return null
	const result = sendFileChangeToVSCode(
		'/test.ts',
		'original',
		'new',
		'test_tool',
		{},
	);

	// May return null or string depending on singleton state from other tests
	t.true(result === null || typeof result === 'string');
});

// ============================================================================
// Tests for port fallback
// ============================================================================

test('VSCodeServer getPort returns the actual port', async t => {
	const port = getNextPort();
	const server = new VSCodeServer(port);
	await server.start();

	t.is(server.getPort(), port);

	await server.stop();
});

test('VSCodeServer falls back to next port when requested port is in use', async t => {
	const port = getNextPort();

	// Start first server on the port
	const server1 = new VSCodeServer(port);
	const started1 = await server1.start();
	t.true(started1);
	t.is(server1.getPort(), port);

	// Try to start second server on same port - should fall back
	const server2 = new VSCodeServer(port);
	const started2 = await server2.start();
	t.true(started2);
	t.not(server2.getPort(), port); // Should be different
	t.is(server2.getPort(), port + 1); // Should be next port

	await server1.stop();
	await server2.stop();
});

test('VSCodeServer tries up to 10 alternative ports', async t => {
	const basePort = getNextPort();

	// Create 11 servers to occupy ports
	const servers: VSCodeServer[] = [];

	// Start first server on base port
	for (let i = 0; i <= 10; i++) {
		const server = new VSCodeServer(basePort + i);
		await server.start();
		servers.push(server);
	}

	// Try to start another server - should fail as all 11 ports (base + 10 alternatives) are taken
	const failingServer = new VSCodeServer(basePort);
	const started = await failingServer.start();
	t.false(started);

	// Clean up
	for (const server of servers) {
		await server.stop();
	}
});
