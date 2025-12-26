import test from 'ava';
import type {ProviderConfig} from '../types/config';
import type {McpServerConfig} from './templates/mcp-templates';
import {buildConfigObject, validateConfig} from './validation';

// ============================================================================
// Tests for Issue #95 Fix: Record to Array Conversion
// ============================================================================

test('buildConfigObject: converts MCP servers from Record to Array', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434',
			models: ['llama2'],
		},
	];

	const mcpServers: Record<string, McpServerConfig> = {
		filesystem: {
			name: 'filesystem',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
		},
		github: {
			name: 'github',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-github'],
			env: {GITHUB_TOKEN: 'token'},
		},
	};

	const config = buildConfigObject(providers, mcpServers);

	// Should be an array, not an object
	t.truthy(config.nanocoder.mcpServers);
	t.true(Array.isArray(config.nanocoder.mcpServers));

	// Should have correct length
	t.is(config.nanocoder.mcpServers!.length, 2);

	// Should contain all servers
	const serverNames = config.nanocoder.mcpServers!.map(s => s.name);
	t.true(serverNames.includes('filesystem'));
	t.true(serverNames.includes('github'));
});

test('buildConfigObject: preserves all server fields in array format', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434',
			models: ['llama2'],
		},
	];

	const mcpServers: Record<string, McpServerConfig> = {
		filesystem: {
			name: 'filesystem',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
			description: 'File system access',
			tags: ['files', 'local'],
			alwaysAllow: ['list_directory'],
		},
		'remote-server': {
			name: 'remote-server',
			transport: 'http',
			url: 'https://example.com/mcp',
			timeout: 30000,
			description: 'Remote MCP server',
			tags: ['remote', 'http'],
			alwaysAllow: ['health_check'],
		},
	};

	const config = buildConfigObject(providers, mcpServers);

	const filesystemServer = config.nanocoder.mcpServers!.find(
		s => s.name === 'filesystem',
	);
	const remoteServer = config.nanocoder.mcpServers!.find(
		s => s.name === 'remote-server',
	);

	// Test stdio server fields
	t.truthy(filesystemServer);
	t.is(filesystemServer!.name, 'filesystem');
	t.is(filesystemServer!.transport, 'stdio');
	t.is(filesystemServer!.command, 'npx');
	t.deepEqual(filesystemServer!.args, [
		'-y',
		'@modelcontextprotocol/server-filesystem',
		'/tmp',
	]);
	t.is(filesystemServer!.description, 'File system access');
	t.deepEqual(filesystemServer!.tags, ['files', 'local']);
	t.deepEqual(filesystemServer!.alwaysAllow, ['list_directory']);

	// Test remote server fields
	t.truthy(remoteServer);
	t.is(remoteServer!.name, 'remote-server');
	t.is(remoteServer!.transport, 'http');
	t.is(remoteServer!.url, 'https://example.com/mcp');
	t.is(remoteServer!.timeout, 30000);
	t.is(remoteServer!.description, 'Remote MCP server');
	t.deepEqual(remoteServer!.tags, ['remote', 'http']);
	t.deepEqual(remoteServer!.alwaysAllow, ['health_check']);
});

test('buildConfigObject: sets enabled flag for wizard-generated configs', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434',
			models: ['llama2'],
		},
	];

	const mcpServers: Record<string, McpServerConfig> = {
		testServer: {
			name: 'test-server',
			transport: 'stdio',
			command: 'node',
			args: ['server.js'],
		},
	};

	const config = buildConfigObject(providers, mcpServers);

	const testServer = config.nanocoder.mcpServers!.find(
		s => s.name === 'test-server',
	);
	t.truthy(testServer);
	t.true(testServer!.enabled); // Should default to true for wizard configurations
});

test('buildConfigObject: handles empty MCP servers', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434',
			models: ['llama2'],
		},
	];

	const config = buildConfigObject(providers, {});

	// When no MCP servers are provided, mcpServers should be undefined
	t.is(config.nanocoder.mcpServers, undefined);
});

test('buildConfigObject: maintains providers configuration', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'openai',
			apiKey: 'sk-test-key',
			models: ['gpt-4'],
			timeout: 60000,
		},
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434',
			models: ['llama2'],
		},
	];

	const config = buildConfigObject(providers, {});

	t.is(config.nanocoder.providers.length, 2);
	t.is(config.nanocoder.providers[0].name, 'openai');
	t.is(config.nanocoder.providers[0].apiKey, 'sk-test-key');
	t.is(config.nanocoder.providers[1].name, 'ollama');
	t.is(config.nanocoder.providers[1].baseUrl, 'http://localhost:11434');
});

// ============================================================================
// Backward Compatibility Tests
// ============================================================================

test('validateConfig: works with both old and new MCP server formats', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434',
			models: ['llama2'],
		},
	];

	// New format with transport field
	const mcpServersNew: Record<string, McpServerConfig> = {
		filesystem: {
			name: 'filesystem',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
		},
	};

	const result = validateConfig(providers, mcpServersNew);
	t.true(result.valid);
	t.is(result.errors.length, 0);
});

test('buildConfigObject: maintains backward compatibility with provider fields', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'anthropic',
			apiKey: 'sk-ant-test',
			models: ['claude-3-sonnet'],
			organizationId: 'org-123',
			timeout: 45000,
		},
	];

	const config = buildConfigObject(providers, {});

	const provider = config.nanocoder.providers[0];
	t.is(provider.name, 'anthropic');
	t.is(provider.apiKey, 'sk-ant-test');
	t.deepEqual(provider.models, ['claude-3-sonnet']);
	t.is(provider.organizationId, 'org-123');
	t.is(provider.timeout, 45000);
});

test('buildConfigObject: correctly maps all transport types', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434',
			models: ['llama2'],
		},
	];

	const mcpServers: Record<string, McpServerConfig> = {
		stdioServer: {
			name: 'stdioServer',
			transport: 'stdio',
			command: 'node',
			args: ['server.js'],
		},
		wsServer: {
			name: 'wsServer',
			transport: 'websocket',
			url: 'ws://localhost:3000/mcp',
		},
		httpServer: {
			name: 'httpServer',
			transport: 'http',
			url: 'https://example.com/mcp',
		},
	};

	const config = buildConfigObject(providers, mcpServers);

	const servers = config.nanocoder.mcpServers!;

	const stdio = servers.find(s => s.name === 'stdioServer');
	const ws = servers.find(s => s.name === 'wsServer');
	const http = servers.find(s => s.name === 'httpServer');

	t.is(stdio?.transport, 'stdio');
	t.is(ws?.transport, 'websocket');
	t.is(http?.transport, 'http');
});
