import test from 'ava';
import type {MCPServer, MCPTransportType} from '../types/mcp';
import {TransportFactory} from './transport-factory';

console.log(`\ntransport-factory.spec.ts`);

// ============================================================================
// Tests for TransportFactory
// ============================================================================

test('TransportFactory.createTransport: creates stdio transport', t => {
	const server: MCPServer = {
		name: 'test-stdio',
		transport: 'stdio',
		command: 'node',
		args: ['server.js'],
		env: {NODE_ENV: 'test'},
	};

	const transport = TransportFactory.createTransport(server);

	t.truthy(transport);
});

test('TransportFactory.createTransport: creates websocket transport', t => {
	const server: MCPServer = {
		name: 'test-websocket',
		transport: 'websocket',
		url: 'ws://localhost:3000/mcp',
	};

	const transport = TransportFactory.createTransport(server);

	t.truthy(transport);
});

test('TransportFactory.createTransport: creates http transport', t => {
	const server: MCPServer = {
		name: 'test-http',
		transport: 'http',
		url: 'https://example.com/mcp',
	};

	const transport = TransportFactory.createTransport(server);

	t.truthy(transport);
});

test('TransportFactory.createTransport: throws error for unsupported transport', t => {
	const server = {
		name: 'test-unsupported',
		transport: 'unsupported' as MCPTransportType,
	};

	t.throws(
		() => {
			TransportFactory.createTransport(server);
		},
		{
			message: /Unsupported transport type: unsupported/,
		},
	);
});

test('TransportFactory.createTransport: throws error for stdio missing command', t => {
	const server: MCPServer = {
		name: 'test-stdio-no-command',
		transport: 'stdio',
	};

	t.throws(
		() => {
			TransportFactory.createTransport(server);
		},
		{
			message: /missing command for stdio transport/,
		},
	);
});

test('TransportFactory.createTransport: throws error for websocket missing URL', t => {
	const server: MCPServer = {
		name: 'test-websocket-no-url',
		transport: 'websocket',
	};

	t.throws(
		() => {
			TransportFactory.createTransport(server);
		},
		{
			message: /missing URL for websocket transport/,
		},
	);
});

test('TransportFactory.createTransport: throws error for http missing URL', t => {
	const server: MCPServer = {
		name: 'test-http-no-url',
		transport: 'http',
	};

	t.throws(
		() => {
			TransportFactory.createTransport(server);
		},
		{
			message: /missing URL for http transport/,
		},
	);
});

test('TransportFactory.createTransport: throws error for invalid websocket URL', t => {
	const server: MCPServer = {
		name: 'test-websocket-invalid-url',
		transport: 'websocket',
		url: 'http://example.com/mcp', // Should be ws:// or wss://
	};

	t.throws(
		() => {
			TransportFactory.createTransport(server);
		},
		{
			message: /Invalid WebSocket URL protocol/,
		},
	);
});

test('TransportFactory.createTransport: throws error for invalid http URL', t => {
	const server: MCPServer = {
		name: 'test-http-invalid-url',
		transport: 'http',
		url: 'ws://example.com/mcp', // Should be http:// or https://
	};

	t.throws(
		() => {
			TransportFactory.createTransport(server);
		},
		{
			message: /Invalid HTTP URL protocol/,
		},
	);
});

// ============================================================================
// Tests for TransportFactory.validateServerConfig
// ============================================================================

test('TransportFactory.validateServerConfig: validates stdio config', t => {
	const server: MCPServer = {
		name: 'test-stdio',
		transport: 'stdio',
		command: 'node',
		args: ['server.js'],
	};

	const result = TransportFactory.validateServerConfig(server);

	t.true(result.valid);
	t.is(result.errors.length, 0);
});

test('TransportFactory.validateServerConfig: validates websocket config', t => {
	const server: MCPServer = {
		name: 'test-websocket',
		transport: 'websocket',
		url: 'wss://example.com/mcp',
	};

	const result = TransportFactory.validateServerConfig(server);

	t.true(result.valid);
	t.is(result.errors.length, 0);
});

test('TransportFactory.validateServerConfig: validates http config', t => {
	const server: MCPServer = {
		name: 'test-http',
		transport: 'http',
		url: 'https://example.com/mcp',
	};

	const result = TransportFactory.validateServerConfig(server);

	t.true(result.valid);
	t.is(result.errors.length, 0);
});

test('TransportFactory.validateServerConfig: detects invalid stdio config', t => {
	const server: MCPServer = {
		name: 'test-stdio-invalid',
		transport: 'stdio',
		// Missing command
	};

	const result = TransportFactory.validateServerConfig(server);

	t.false(result.valid);
	t.true(
		result.errors.some((error: string) =>
			error.includes('stdio transport requires a command'),
		),
	);
});

test('TransportFactory.validateServerConfig: detects invalid websocket config', t => {
	const server: MCPServer = {
		name: 'test-websocket-invalid',
		transport: 'websocket',
		url: 'http://example.com/mcp', // Invalid protocol
	};

	const result = TransportFactory.validateServerConfig(server);

	t.false(result.valid);
	t.true(
		result.errors.some((error: string) =>
			error.includes('websocket URL must use ws:// or wss:// protocol'),
		),
	);
});

test('TransportFactory.validateServerConfig: detects invalid http config', t => {
	const server: MCPServer = {
		name: 'test-http-invalid',
		transport: 'http',
		url: 'ws://example.com/mcp', // Invalid protocol
	};

	const result = TransportFactory.validateServerConfig(server);

	t.false(result.valid);
	t.true(
		result.errors.some((error: string) =>
			error.includes('http URL must use http:// or https:// protocol'),
		),
	);
});

// ============================================================================
// Tests for TransportFactory.getTransportTips
// ============================================================================

test('TransportFactory.getTransportTips: returns stdio tips', t => {
	const tips = TransportFactory.getTransportTips('stdio');

	t.true(tips.length > 0);
	t.true(tips.some((tip: string) => tip.includes('Stdio transport')));
});

test('TransportFactory.getTransportTips: returns websocket tips', t => {
	const tips = TransportFactory.getTransportTips('websocket');

	t.true(tips.length > 0);
	t.true(tips.some((tip: string) => tip.includes('WebSocket')));
});

test('TransportFactory.getTransportTips: returns http tips', t => {
	const tips = TransportFactory.getTransportTips('http');

	t.true(tips.length > 0);
	t.true(tips.some((tip: string) => tip.includes('HTTP')));
});

test('TransportFactory.getTransportTips: handles unknown transport', t => {
	const tips = TransportFactory.getTransportTips('unknown' as MCPTransportType);

	t.is(tips.length, 1);
	t.is(tips[0], 'Unknown transport type');
});

// ============================================================================
// Tests for Header Warning Functionality (New Feature)
// ============================================================================

test('TransportFactory.createTransport: warns about auth config for websocket transport', t => {
	// Test that transport is created despite auth config warning
	// Note: Warnings are now logged via the logging system (logWarning),
	// not console.warn directly
	const server: MCPServer = {
		name: 'test-websocket-with-auth',
		transport: 'websocket',
		url: 'ws://localhost:3000/mcp',
		auth: {
			type: 'bearer',
			token: 'token123',
		},
	};

	const transport = TransportFactory.createTransport(server);

	// Transport should still be created even with unsupported auth config
	t.truthy(transport);
	// Warning is logged via logWarning() to the logging system
});

test('TransportFactory.createTransport: creates http transport with headers', t => {
	const server: MCPServer = {
		name: 'test-http-with-headers',
		transport: 'http',
		url: 'https://example.com/mcp',
		headers: {
			Authorization: 'Bearer token123',
		},
	};

	const transport = TransportFactory.createTransport(server);

	t.truthy(transport);
});

test('TransportFactory.createTransport: warns about auth config for http transport', t => {
	// Test that transport is created despite auth config warning
	// Note: Warnings are now logged via the logging system (logWarning),
	// not console.warn directly
	const server: MCPServer = {
		name: 'test-http-with-auth',
		transport: 'http',
		url: 'https://example.com/mcp',
		auth: {
			type: 'bearer',
			token: 'token123',
		},
	};

	const transport = TransportFactory.createTransport(server);

	// Transport should still be created even with unsupported auth config
	t.truthy(transport);
	// Warning is logged via logWarning() to the logging system
});

test('TransportFactory.validateServerConfig: validates http config with headers', t => {
	const server: MCPServer = {
		name: 'test-http-with-headers-validation',
		transport: 'http',
		url: 'https://example.com/mcp',
		headers: {
			'Custom-Header': 'value',
		},
	};

	const result = TransportFactory.validateServerConfig(server);

	t.true(result.valid);
	t.is(result.errors.length, 0);
});

// ============================================================================
// Tests for Command Existence Validation (Issue #148 Fix)
// ============================================================================

test('TransportFactory.validateServerConfig: detects missing command', t => {
	const server: MCPServer = {
		name: 'test-stdio-missing-command',
		transport: 'stdio',
		command: 'this-command-definitely-does-not-exist-xyz123',
	};

	const result = TransportFactory.validateServerConfig(server);

	t.false(result.valid);
	t.true(
		result.errors.some((error: string) =>
			error.includes("Command 'this-command-definitely-does-not-exist-xyz123' not found"),
		),
	);
});

test('TransportFactory.validateServerConfig: returns error for missing command', t => {
	const server: MCPServer = {
		name: 'test-stdio-missing-command',
		transport: 'stdio',
		command: 'nonexistent-command-for-testing',
	};

	const result = TransportFactory.validateServerConfig(server);

	// Should fail since command doesn't exist
	t.false(result.valid);
	// Should have an error message with generic hint
	t.true(result.errors.length > 0);
	t.true(result.errors[0]!.includes("not found"));
});

test('TransportFactory.validateServerConfig: validates existing command (node)', t => {
	// node should exist since we're running tests with it
	const server: MCPServer = {
		name: 'test-stdio-node-exists',
		transport: 'stdio',
		command: 'node',
		args: ['--version'],
	};

	const result = TransportFactory.validateServerConfig(server);

	t.true(result.valid);
	t.is(result.errors.length, 0);
});
