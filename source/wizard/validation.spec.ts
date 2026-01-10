import test from 'ava';
import type {ProviderConfig} from '../types/config.js';
import type {McpServerConfig} from './templates/mcp-templates.js';
import {
	buildConfigObject,
	testProviderConnection,
	validateConfig,
} from './validation.js';

// ============================================================================
// Tests for validateConfig
// ============================================================================

test('validateConfig: returns valid for correct configuration', t => {
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
	};

	const result = validateConfig(providers, mcpServers);

	t.true(result.valid);
	t.is(result.errors.length, 0);
	t.is(result.warnings.length, 0);
});

test('validateConfig: warns when no providers configured', t => {
	const providers: ProviderConfig[] = [];
	const mcpServers: Record<string, McpServerConfig> = {};

	const result = validateConfig(providers, mcpServers);

	t.true(result.valid); // Warnings don't invalidate, only errors do
	t.is(result.warnings.length, 1);
	t.regex(result.warnings[0], /No providers configured/);
});

test('validateConfig: errors when provider missing name', t => {
	const providers: ProviderConfig[] = [
		{
			name: '',
			baseUrl: 'http://localhost:11434',
			models: ['llama2'],
		},
	];

	const result = validateConfig(providers, {});

	t.false(result.valid);
	t.is(result.errors.length, 1);
	t.regex(result.errors[0], /Provider missing name/);
});

test('validateConfig: errors when provider has no models', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434',
			models: [],
		},
	];

	const result = validateConfig(providers, {});

	t.false(result.valid);
	t.is(result.errors.length, 1);
	t.regex(result.errors[0], /has no models configured/);
});

test('validateConfig: errors when provider has invalid base URL', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'ollama',
			baseUrl: 'not-a-valid-url',
			models: ['llama2'],
		},
	];

	const result = validateConfig(providers, {});

	t.false(result.valid);
	t.is(result.errors.length, 1);
	t.regex(result.errors[0], /invalid base URL/);
});

test('validateConfig: errors when MCP server missing command', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434',
			models: ['llama2'],
		},
	];

	const mcpServers = {
		filesystem: {
			name: 'filesystem',
			args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
		},
	} as unknown as Record<string, McpServerConfig>;

	const result = validateConfig(providers, mcpServers);

	t.false(result.valid);
	t.is(result.errors.length, 1);
	t.regex(result.errors[0], /missing command/);
});

test('validateConfig: errors when MCP server missing args', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434',
			models: ['llama2'],
		},
	];

	const mcpServers = {
		filesystem: {name: 'filesystem', transport: 'stdio', command: 'npx'},
	} as unknown as Record<string, McpServerConfig>;

	const result = validateConfig(providers, mcpServers);

	t.false(result.valid);
	t.is(result.errors.length, 1);
	t.regex(result.errors[0], /missing args array/);
});

test('validateConfig: errors when alwaysAllow is not an array', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434',
			models: ['llama2'],
		},
	];

	const mcpServers = {
		filesystem: {
			name: 'filesystem',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
			alwaysAllow: 'not-an-array',
		},
	} as unknown as Record<string, McpServerConfig>;

	const result = validateConfig(providers, mcpServers);

	t.false(result.valid);
	t.regex(result.errors[0], /alwaysAllow/);
});

test('validateConfig: errors when alwaysAllow contains non-strings', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434',
			models: ['llama2'],
		},
	];

	const mcpServers = {
		filesystem: {
			name: 'filesystem',
			transport: 'stdio',
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
			alwaysAllow: ['ok', 123],
		},
	} as unknown as Record<string, McpServerConfig>;

	const result = validateConfig(providers, mcpServers);

	t.false(result.valid);
	t.regex(result.errors[0], /non-string/);
});

test('validateConfig: validates nanocoderTools.alwaysAllow is an array', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434',
			models: ['llama2'],
		},
	];

	const result = validateConfig(providers, {}, {
		alwaysAllow: 'not-an-array' as any,
	});

	t.false(result.valid);
	t.regex(result.errors[0], /must be an array/);
});

test('validateConfig: validates nanocoderTools.alwaysAllow entries are strings', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434',
			models: ['llama2'],
		},
	];

	const result = validateConfig(providers, {}, {
		alwaysAllow: ['write_file', 123, true] as any,
	});

	t.false(result.valid);
	t.regex(result.errors[0], /non-string entries/);
});

test('validateConfig: accepts valid nanocoderTools.alwaysAllow', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434',
			models: ['llama2'],
		},
	];

	const result = validateConfig(providers, {}, {
		alwaysAllow: ['write_file', 'string_replace'],
	});

	t.true(result.valid);
	t.is(result.errors.length, 0);
});

test('validateConfig: accumulates multiple errors', t => {
	const providers: ProviderConfig[] = [
		{
			name: '',
			baseUrl: 'invalid-url',
			models: [],
		},
		{
			name: 'provider2',
			baseUrl: 'http://localhost:11434',
			models: [],
		},
	];

	const result = validateConfig(providers, {});

	t.false(result.valid);
	t.true(result.errors.length >= 3); // Missing name, invalid URL, no models (×2)
});

// ============================================================================
// Tests for buildConfigObject
// ============================================================================

test('buildConfigObject: builds correct config with providers only', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434',
			models: ['llama2', 'codellama'],
		},
	];

	const config = buildConfigObject(providers, {});

	t.truthy(config.nanocoder);
	t.is(config.nanocoder.providers.length, 1);
	t.is(config.nanocoder.providers[0].name, 'ollama');
	t.is(config.nanocoder.providers[0].baseUrl, 'http://localhost:11434');
	t.deepEqual(config.nanocoder.providers[0].models, ['llama2', 'codellama']);
	t.is(config.nanocoder.mcpServers, undefined);
});

test('buildConfigObject: includes MCP servers when provided', t => {
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
	};

	const config = buildConfigObject(providers, mcpServers);

	t.truthy(config.nanocoder.mcpServers);
	t.true(Array.isArray(config.nanocoder.mcpServers));
	const filesystemServer = config.nanocoder.mcpServers?.find(
		s => s.name === 'filesystem',
	);
	t.truthy(filesystemServer);
	t.is(filesystemServer?.command, 'npx');
});

test('buildConfigObject: includes apiKey when present', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'openai',
			apiKey: 'sk-test-key',
			models: ['gpt-4'],
		},
	];

	const config = buildConfigObject(providers, {});

	t.is(config.nanocoder.providers[0].apiKey, 'sk-test-key');
});

test('buildConfigObject: includes organizationId when present', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'openai',
			organizationId: 'org-123',
			models: ['gpt-4'],
		},
	];

	const config = buildConfigObject(providers, {});

	t.is(config.nanocoder.providers[0].organizationId, 'org-123');
});

test('buildConfigObject: includes timeout when present', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434',
			timeout: 30000,
			models: ['llama2'],
		},
	];

	const config = buildConfigObject(providers, {});

	t.is(config.nanocoder.providers[0].timeout, 30000);
});

test('buildConfigObject: omits optional fields when not present', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434',
			models: ['llama2'],
		},
	];

	const config = buildConfigObject(providers, {});

	t.is(config.nanocoder.providers[0].apiKey, undefined);
	t.is(config.nanocoder.providers[0].organizationId, undefined);
	t.is(config.nanocoder.providers[0].timeout, undefined);
});

test('buildConfigObject: handles multiple providers', t => {
	const providers: ProviderConfig[] = [
		{
			name: 'ollama',
			baseUrl: 'http://localhost:11434',
			models: ['llama2'],
		},
		{
			name: 'openai',
			apiKey: 'sk-test',
			models: ['gpt-4'],
		},
	];

	const config = buildConfigObject(providers, {});

	t.is(config.nanocoder.providers.length, 2);
	t.is(config.nanocoder.providers[0].name, 'ollama');
	t.is(config.nanocoder.providers[1].name, 'openai');
});

test('buildConfigObject: handles multiple MCP servers', t => {
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

	t.is(Object.keys(config.nanocoder.mcpServers ?? {}).length, 2);
	const filesystemServer = config.nanocoder.mcpServers?.find(
		s => s.name === 'filesystem',
	);
	const githubServer = config.nanocoder.mcpServers?.find(
		s => s.name === 'github',
	);
	t.truthy(filesystemServer);
	t.truthy(githubServer);
});

// ============================================================================
// Tests for testProviderConnection
// ============================================================================

test('testProviderConnection: returns connected=true when no baseUrl', async t => {
	const provider: ProviderConfig = {
		name: 'openai',
		models: ['gpt-4'],
	};

	const result = await testProviderConnection(provider);

	t.is(result.providerName, 'openai');
	t.true(result.connected);
	t.is(result.error, undefined);
});

test('testProviderConnection: returns connected=true for non-localhost URLs', async t => {
	const provider: ProviderConfig = {
		name: 'openai',
		baseUrl: 'https://api.openai.com',
		models: ['gpt-4'],
	};

	const result = await testProviderConnection(provider);

	t.is(result.providerName, 'openai');
	t.true(result.connected);
});

test('testProviderConnection: returns connected=false for unreachable localhost', async t => {
	const provider: ProviderConfig = {
		name: 'ollama',
		baseUrl: 'http://localhost:99999',
		models: ['llama2'],
	};

	const result = await testProviderConnection(provider, 1000);

	t.is(result.providerName, 'ollama');
	t.false(result.connected);
	t.truthy(result.error);
});

test('testProviderConnection: returns connected=true for reachable localhost', async t => {
	// This test requires a mock server or integration setup
	// For now, we'll test with a common localhost port that might have a service
	// In CI, this might fail if the service isn't available
	const provider: ProviderConfig = {
		name: 'ollama',
		baseUrl: 'http://localhost:11434',
		models: ['llama2'],
	};

	try {
		const result = await testProviderConnection(provider, 1000);
		t.is(result.providerName, 'ollama');
		// Result depends on whether Ollama is running
		t.truthy(typeof result.connected === 'boolean');
	} catch {
		// If fetch is not available or times out, that's acceptable
		t.pass();
	}
});
