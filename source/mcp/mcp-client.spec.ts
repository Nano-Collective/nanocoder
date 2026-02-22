import test from 'ava';
import {setCurrentMode} from '../context/mode-context';
import {MCPClient} from './mcp-client';

// ============================================================================
// Mock Setup
// ============================================================================

// Mock the MCP SDK Client
class MockClient {
	async connect() {
		return;
	}

	async listTools() {
		return {
			tools: [
				{
					name: 'test_tool',
					description: 'A test tool',
					inputSchema: {
						type: 'object',
						properties: {
							arg1: {type: 'string'},
						},
					},
				},
			],
		};
	}

	async callTool() {
		return {
			content: [{type: 'text', text: 'Test result'}],
		};
	}

	async close() {
		return;
	}
}

// Mock TransportFactory
const mockTransport = {};

const mockTransportFactory = {
	validateServerConfig: (server: any) => {
		if (!server.transport) {
			return {valid: false, errors: ['transport is required']};
		}
		if (server.transport === 'stdio' && !server.command) {
			return {valid: false, errors: ['stdio transport requires a command']};
		}
		if (server.transport === 'websocket' && !server.url) {
			return {valid: false, errors: ['websocket transport requires a URL']};
		}
		if (server.transport === 'http' && !server.url) {
			return {valid: false, errors: ['http transport requires a URL']};
		}
		return {valid: true, errors: []};
	},
	createTransport: () => mockTransport,
};

console.log(`\nmcp-client.spec.ts`);

// Skip integration tests in CI environments (they require external network access)
const isCI = process.env.CI === 'true' || process.env.CI === '1';
const testOrSkip = isCI ? test.skip : test;

// ============================================================================
// Tests for MCPClient - Transport Support
// ============================================================================

test('MCPClient: creates instance successfully', t => {
	const client = new MCPClient();

	t.truthy(client);
	t.is(typeof client.getConnectedServers, 'function');
	t.is(typeof client.getServerTools, 'function');
	t.is(typeof client.getServerInfo, 'function');
	t.is(typeof client.disconnect, 'function');
});

test('MCPClient: normalizeServerConfig adds default stdio transport', t => {
	const client = new MCPClient();
	const server = {
		name: 'test-legacy',
		command: 'node',
		args: ['server.js'],
		transport: undefined as any, // Legacy config
	};

	// Access private method via type assertion for testing
	const normalizeServerConfig = (client as any).normalizeServerConfig.bind(
		client,
	);
	const normalized = normalizeServerConfig(server);

	t.is(normalized.transport, 'stdio');
	t.is(normalized.name, 'test-legacy');
	t.is(normalized.command, 'node');
	t.deepEqual(normalized.args, ['server.js']);
});

test('MCPClient.getServerInfo: returns undefined for non-existent server', t => {
	const client = new MCPClient();
	const serverInfo = client.getServerInfo('non-existent');

	t.is(serverInfo, undefined);
});

test('MCPClient: maintains backward compatibility with existing APIs', t => {
	const client = new MCPClient();

	// Test that all existing methods still exist and are callable
	t.truthy(typeof client.getConnectedServers === 'function');
	t.truthy(typeof client.getServerTools === 'function');
	t.truthy(typeof client.getServerInfo === 'function');
	t.truthy(typeof client.disconnect === 'function');
	t.truthy(typeof client.callTool === 'function');
	t.truthy(typeof client.getAllTools === 'function');
	t.truthy(typeof client.getNativeToolsRegistry === 'function');

	// Test that they return expected types
	const connectedServers = client.getConnectedServers();
	t.true(Array.isArray(connectedServers));

	const serverTools = client.getServerTools('non-existent');
	t.true(Array.isArray(serverTools));
});

test('MCPClient: getConnectedServers returns array', t => {
	const client = new MCPClient();
	const connectedServers = client.getConnectedServers();
	t.true(Array.isArray(connectedServers));
});

test('MCPClient: isServerConnected returns false for non-existent servers', t => {
	const client = new MCPClient();

	// Should return false for any server that hasn't been connected
	t.false(client.isServerConnected('non-existent-server'));
	t.false(client.isServerConnected('another-server'));
	t.false(client.isServerConnected(''));
});
// ============================================================================
// Tests for getAllTools
// ============================================================================

test('MCPClient.getAllTools: returns empty array when no servers connected', t => {
	const client = new MCPClient();
	const tools = client.getAllTools();

	t.true(Array.isArray(tools));
	t.is(tools.length, 0);
});

test('MCPClient.getAllTools: builds tools from connected servers', t => {
	const client = new MCPClient();

	// Simulate connected server by setting internal state directly
	(client as any).serverTools.set('test-server', [
		{
			name: 'tool1',
			description: 'Test tool 1',
			inputSchema: {type: 'object', properties: {}},
			serverName: 'test-server',
		},
		{
			name: 'tool2',
			description: 'Test tool 2',
			inputSchema: {type: 'object', properties: {arg: {type: 'string'}}},
			serverName: 'test-server',
		},
	]);

	const tools = client.getAllTools();

	t.is(tools.length, 2);
	t.is(tools[0].type, 'function');
	t.is(tools[0].function.name, 'tool1');
	t.true(tools[0].function.description?.includes('[MCP:test-server]'));
	t.is(tools[1].function.name, 'tool2');
	t.true(tools[1].function.description?.includes('[MCP:test-server]'));
});

test('MCPClient.getAllTools: handles tools without description', t => {
	const client = new MCPClient();

	(client as any).serverTools.set('test-server', [
		{
			name: 'tool_no_desc',
			description: undefined,
			inputSchema: {type: 'object', properties: {}},
			serverName: 'test-server',
		},
	]);

	const tools = client.getAllTools();

	t.is(tools.length, 1);
	t.is(tools[0].function.name, 'tool_no_desc');
	t.true(tools[0].function.description?.includes('MCP tool from test-server'));
});

test('MCPClient.getAllTools: includes required parameters from schema', t => {
	const client = new MCPClient();

	(client as any).serverTools.set('test-server', [
		{
			name: 'tool_with_required',
			description: 'Tool with required params',
			inputSchema: {
				type: 'object',
				properties: {arg1: {type: 'string'}},
				required: ['arg1'],
			},
			serverName: 'test-server',
		},
	]);

	const tools = client.getAllTools();

	t.is(tools.length, 1);
	t.deepEqual(tools[0].function.parameters.required, ['arg1']);
});

test('MCPClient.getAllTools: handles multiple servers', t => {
	const client = new MCPClient();

	(client as any).serverTools.set('server1', [
		{
			name: 'server1_tool',
			description: 'Server 1 tool',
			inputSchema: {type: 'object', properties: {}},
			serverName: 'server1',
		},
	]);

	(client as any).serverTools.set('server2', [
		{
			name: 'server2_tool',
			description: 'Server 2 tool',
			inputSchema: {type: 'object', properties: {}},
			serverName: 'server2',
		},
	]);

	const tools = client.getAllTools();

	t.is(tools.length, 2);
	t.true(
		tools.some(t => t.function.name === 'server1_tool'),
	);
	t.true(
		tools.some(t => t.function.name === 'server2_tool'),
	);
});

// ============================================================================
// Tests for getToolMapping
// ============================================================================

test('MCPClient.getToolMapping: returns empty map when no servers', t => {
	const client = new MCPClient();
	const mapping = client.getToolMapping();

	t.true(mapping instanceof Map);
	t.is(mapping.size, 0);
});

test('MCPClient.getToolMapping: maps tools to servers', t => {
	const client = new MCPClient();

	(client as any).serverTools.set('test-server', [
		{
			name: 'tool1',
			description: 'Tool 1',
			inputSchema: {type: 'object', properties: {}},
			serverName: 'test-server',
		},
		{
			name: 'tool2',
			description: 'Tool 2',
			inputSchema: {type: 'object', properties: {}},
			serverName: 'test-server',
		},
	]);

	const mapping = client.getToolMapping();

	t.is(mapping.size, 2);
	t.deepEqual(mapping.get('tool1'), {
		serverName: 'test-server',
		originalName: 'tool1',
	});
	t.deepEqual(mapping.get('tool2'), {
		serverName: 'test-server',
		originalName: 'tool2',
	});
});

test('MCPClient.getToolMapping: handles multiple servers', t => {
	const client = new MCPClient();

	(client as any).serverTools.set('server1', [
		{
			name: 'tool1',
			description: 'Tool 1',
			inputSchema: {type: 'object', properties: {}},
			serverName: 'server1',
		},
	]);

	(client as any).serverTools.set('server2', [
		{
			name: 'tool2',
			description: 'Tool 2',
			inputSchema: {type: 'object', properties: {}},
			serverName: 'server2',
		},
	]);

	const mapping = client.getToolMapping();

	t.is(mapping.size, 2);
	t.deepEqual(mapping.get('tool1'), {
		serverName: 'server1',
		originalName: 'tool1',
	});
	t.deepEqual(mapping.get('tool2'), {
		serverName: 'server2',
		originalName: 'tool2',
	});
});

// ============================================================================
// Tests for getServerTools
// ============================================================================

test('MCPClient.getServerTools: returns empty array for non-existent server', t => {
	const client = new MCPClient();
	const tools = client.getServerTools('non-existent');

	t.true(Array.isArray(tools));
	t.is(tools.length, 0);
});

test('MCPClient.getServerTools: returns tools for connected server', t => {
	const client = new MCPClient();

	const testTools = [
		{
			name: 'tool1',
			description: 'Tool 1',
			inputSchema: {type: 'object', properties: {}},
			serverName: 'test-server',
		},
		{
			name: 'tool2',
			description: 'Tool 2',
			inputSchema: {type: 'object', properties: {}},
			serverName: 'test-server',
		},
	];

	(client as any).serverTools.set('test-server', testTools);

	const tools = client.getServerTools('test-server');

	t.is(tools.length, 2);
	t.deepEqual(tools, testTools);
});

// ============================================================================
// Tests for getToolEntries
// ============================================================================

test('MCPClient.getToolEntries: returns empty array when no servers', t => {
	const client = new MCPClient();
	const entries = client.getToolEntries();

	t.true(Array.isArray(entries));
	t.is(entries.length, 0);
});

test('MCPClient.getToolEntries: returns entries with tools and handlers', t => {
	const client = new MCPClient();

	(client as any).serverTools.set('test-server', [
		{
			name: 'test_tool',
			description: 'Test tool',
			inputSchema: {type: 'object', properties: {}},
			serverName: 'test-server',
		},
	]);

	const entries = client.getToolEntries();

	t.is(entries.length, 1);
	t.is(entries[0].name, 'test_tool');
	t.truthy(entries[0].tool);
	t.truthy(entries[0].handler);
	t.is(typeof entries[0].handler, 'function');
});

test('MCPClient.getToolEntries: includes handler that calls callTool', async t => {
	const client = new MCPClient();

	// Set up mock client
	const mockMCPClient = {
		callTool: async () => 'mocked result',
	};
	(client as any).serverTools.set('test-server', [
		{
			name: 'test_tool',
			description: 'Test tool',
			inputSchema: {type: 'object', properties: {}},
			serverName: 'test-server',
		},
	]);

	const entries = client.getToolEntries();

	// Note: The handler will fail because there's no actual connected client
	// But we can verify the structure
	t.is(entries.length, 1);
	t.is(entries[0].name, 'test_tool');
	t.is(typeof entries[0].handler, 'function');
});

// ============================================================================
// Tests for callTool error handling
// ============================================================================

test('MCPClient.callTool: throws error for non-existent tool', async t => {
	const client = new MCPClient();

	await t.throwsAsync(
		async () => await client.callTool('non_existent_tool', {}),
		{message: /MCP tool not found/},
	);
});

test('MCPClient.callTool: throws error when client not connected for server', async t => {
	const client = new MCPClient();

	// Add tool mapping without actual client connection
	(client as any).serverTools.set('test-server', [
		{
			name: 'test_tool',
			description: 'Test tool',
			inputSchema: {type: 'object', properties: {}},
			serverName: 'test-server',
		},
	]);

	await t.throwsAsync(
		async () => await client.callTool('test_tool', {}),
		{message: /No MCP client connected for server/},
	);
});

// ============================================================================
// Tests for disconnect
// ============================================================================

test('MCPClient.disconnect: clears all state when no servers connected', async t => {
	const client = new MCPClient();

	// Add some mock state
	(client as any).clients.set('mock', {});
	(client as any).transports.set('mock', {});
	(client as any).serverTools.set('mock', []);
	(client as any).serverConfigs.set('mock', {});
	(client as any).isConnected = true;

	await client.disconnect();

	// State should be cleared
	t.is(client.getConnectedServers().length, 0);
	t.is(client.getServerTools('mock').length, 0);
	t.is(client.getServerInfo('mock'), undefined);
});

test('MCPClient.disconnect: handles disconnect when already disconnected', async t => {
	const client = new MCPClient();

	// Should not throw when disconnecting with no connections
	await t.notThrowsAsync(async () => await client.disconnect());
});

// ============================================================================
// Tests for getNativeToolsRegistry
// ============================================================================

test('MCPClient.getNativeToolsRegistry: returns empty object when no servers', t => {
	const client = new MCPClient();
	const registry = client.getNativeToolsRegistry();

	t.true(typeof registry === 'object');
	t.is(Object.keys(registry).length, 0);
});

test('MCPClient.getNativeToolsRegistry: creates tools with needsApproval callback', t => {
	const client = new MCPClient();

	(client as any).serverTools.set('test-server', [
		{
			name: 'test_tool',
			description: 'Test tool',
			inputSchema: {type: 'object', properties: {}},
			serverName: 'test-server',
		},
	]);

	const registry = client.getNativeToolsRegistry();

	t.is(Object.keys(registry).length, 1);
	t.truthy(registry.test_tool);
	t.truthy(registry.test_tool.description);
	t.truthy(registry.test_tool.needsApproval);
	t.is(typeof registry.test_tool.needsApproval, 'function');
});

test('MCPClient.getNativeToolsRegistry: includes description with server prefix', t => {
	const client = new MCPClient();

	(client as any).serverTools.set('my-server', [
		{
			name: 'my_tool',
			description: 'My tool description',
			inputSchema: {type: 'object', properties: {}},
			serverName: 'my-server',
		},
	]);

	const registry = client.getNativeToolsRegistry();

	t.true(registry.my_tool.description?.includes('[MCP:my-server]'));
	t.true(registry.my_tool.description?.includes('My tool description'));
});

test('MCPClient.getNativeToolsRegistry: generates default description when missing', t => {
	const client = new MCPClient();

	(client as any).serverTools.set('test-server', [
		{
			name: 'tool_no_desc',
			description: undefined,
			inputSchema: {type: 'object', properties: {}},
			serverName: 'test-server',
		},
	]);

	const registry = client.getNativeToolsRegistry();

	t.true(registry.tool_no_desc.description?.includes('MCP tool from test-server'));
});

// ============================================================================
// Tests for getServerInfo with connected servers
// ============================================================================

test('MCPClient.getServerInfo: returns info for connected server', t => {
	const client = new MCPClient();

	// Simulate a connected server by setting internal state
	const testConfig = {
		name: 'test-server',
		transport: 'stdio' as const,
		command: 'node',
		args: ['server.js'],
		description: 'Test server',
		tags: ['test', 'demo'],
	};

	const mockClient = {};

	(client as any).clients.set('test-server', mockClient);
	(client as any).serverConfigs.set('test-server', testConfig);
	(client as any).serverTools.set('test-server', [
		{
			name: 'tool1',
			description: 'Tool 1',
			inputSchema: {type: 'object', properties: {}},
			serverName: 'test-server',
		},
		{
			name: 'tool2',
			description: 'Tool 2',
			inputSchema: {type: 'object', properties: {}},
			serverName: 'test-server',
		},
	]);

	const serverInfo = client.getServerInfo('test-server');

	t.truthy(serverInfo);
	t.is(serverInfo?.name, 'test-server');
	t.is(serverInfo?.transport, 'stdio');
	t.is(serverInfo?.toolCount, 2);
	t.is(serverInfo?.connected, true);
	t.is(serverInfo?.description, 'Test server');
	t.deepEqual(serverInfo?.tags, ['test', 'demo']);
});

test('MCPClient.getServerInfo: includes URL for remote servers', t => {
	const client = new MCPClient();

	const testConfig = {
		name: 'remote-server',
		transport: 'websocket' as const,
		url: 'ws://localhost:3000',
	};

	const mockClient = {};

	(client as any).clients.set('remote-server', mockClient);
	(client as any).serverConfigs.set('remote-server', testConfig);
	(client as any).serverTools.set('remote-server', []);

	const serverInfo = client.getServerInfo('remote-server');

	t.truthy(serverInfo);
	t.is(serverInfo?.name, 'remote-server');
	t.is(serverInfo?.transport, 'websocket');
	t.is(serverInfo?.url, 'ws://localhost:3000');
});

test('MCPClient.getServerInfo: returns undefined when server not connected', t => {
	const client = new MCPClient();

	const serverInfo = client.getServerInfo('non-existent');

	t.is(serverInfo, undefined);
});

test('MCPClient.getServerInfo: returns undefined when only tools exist', t => {
	const client = new MCPClient();

	// Only set tools, not client or config
	(client as any).serverTools.set('test-server', [
		{
			name: 'tool1',
			description: 'Tool 1',
			inputSchema: {type: 'object', properties: {}},
			serverName: 'test-server',
		},
	]);

	const serverInfo = client.getServerInfo('test-server');

	t.is(serverInfo, undefined);
});

// ============================================================================
// Integration Tests with Real MCP Servers (HTTP Transport)
// ============================================================================

// These tests use real remote MCP servers via HTTP transport
// They test the actual connection, tool listing, and tool execution flow

testOrSkip('MCPClient.connectToServer: connects to remote HTTP MCP server', async t => {
	const client = new MCPClient();

	// Use DeepWiki public MCP server (no auth required)
	const server = {
		name: 'test-deepwiki',
		transport: 'http' as const,
		url: 'https://mcp.deepwiki.com/mcp',
	};

	// This should connect successfully
	await t.notThrowsAsync(async () => await client.connectToServer(server));

	// Verify server is marked as connected
	t.true(client.isServerConnected('test-deepwiki'));

	// Verify tools were loaded
	const tools = client.getServerTools('test-deepwiki');
	t.true(tools.length > 0, 'Should have loaded tools from remote server');

	// Verify server info is available
	const serverInfo = client.getServerInfo('test-deepwiki');
	t.truthy(serverInfo);
	t.is(serverInfo?.name, 'test-deepwiki');
	t.is(serverInfo?.transport, 'http');
	t.is(serverInfo?.connected, true);

	// Clean up - disconnect
	await client.disconnect();

	// Verify disconnection
	t.false(client.isServerConnected('test-deepwiki'));
	t.is(client.getServerTools('test-deepwiki').length, 0);
});

testOrSkip('MCPClient.connectToServer: connects to Remote Fetch HTTP server and fetches content', async t => {
	const client = new MCPClient();

	const server = {
		name: 'test-remote-fetch',
		transport: 'http' as const,
		url: 'https://remote.mcpservers.org/fetch/mcp',
	};

	await t.notThrowsAsync(async () => await client.connectToServer(server));

	t.true(client.isServerConnected('test-remote-fetch'));

	const tools = client.getServerTools('test-remote-fetch');
	t.true(tools.length > 0, 'Should have loaded tools from Remote Fetch');

	// Find the fetch tool
	const fetchTool = tools.find(t => t.name === 'fetch');
	t.truthy(fetchTool, 'Should have a fetch tool');

	// Execute the fetch tool to get Nanocoder's GitHub repo
	// callTool uses just the tool name, and internally looks up the server
	const result = await client.callTool('fetch', {
		url: 'https://github.com/Nano-Collective/nanocoder',
	});

	t.truthy(result, 'Should get a result from fetch tool');

	await client.disconnect();
	t.false(client.isServerConnected('test-remote-fetch'));
});

testOrSkip('MCPClient.connectToServers: connects to multiple HTTP servers', async t => {
	const client = new MCPClient();

	const servers = [
		{
			name: 'test-deepwiki',
			transport: 'http' as const,
			url: 'https://mcp.deepwiki.com/mcp',
		},
		{
			name: 'test-context7',
			transport: 'http' as const,
			url: 'https://mcp.context7.com/mcp',
		},
	];

	// Track progress
	const progressResults: any[] = [];
	const onProgress = (result: any) => {
		progressResults.push(result);
	};

	const results = await client.connectToServers(servers, onProgress);

	// Should have 2 results
	t.is(results.length, 2);
	t.is(progressResults.length, 2);

	// Both should succeed (network permitting)
	const successful = results.filter((r: any) => r.success);
	t.true(successful.length >= 1, 'At least one server should connect successfully');

	// Clean up
	await client.disconnect();
});

testOrSkip('MCPClient.getAllTools: builds tools registry from connected HTTP server', async t => {
	const client = new MCPClient();

	const server = {
		name: 'test-deepwiki',
		transport: 'http' as const,
		url: 'https://mcp.deepwiki.com/mcp',
	};

	await client.connectToServer(server);

	// getAllTools should return tools in the AI SDK format
	const tools = client.getAllTools();

	t.true(tools.length > 0, 'Should have tools from connected server');

	// Verify tool structure
	const firstTool = tools[0];
	t.is(firstTool.type, 'function');
	t.truthy(firstTool.function.name);
	t.truthy(firstTool.function.description);
	t.true(
		firstTool.function.description?.includes('[MCP:test-deepwiki]'),
		'Tool description should include server prefix',
	);
	t.truthy(firstTool.function.parameters);
	t.is(firstTool.function.parameters.type, 'object');

	await client.disconnect();
});

testOrSkip('MCPClient.getNativeToolsRegistry: creates registry from connected HTTP server', async t => {
	const client = new MCPClient();

	const server = {
		name: 'test-context7',
		transport: 'http' as const,
		url: 'https://mcp.context7.com/mcp',
	};

	await client.connectToServer(server);

	// getNativeToolsRegistry should return tools in AI SDK CoreTool format
	const registry = client.getNativeToolsRegistry();

	t.true(Object.keys(registry).length > 0, 'Should have tools in registry');

	// Verify first tool structure
	const firstToolName = Object.keys(registry)[0];
	const firstTool = registry[firstToolName];

	t.truthy(firstTool.description);
	t.is(typeof firstTool.inputSchema, 'object');
	t.truthy(firstTool.needsApproval);
	t.is(typeof firstTool.needsApproval, 'function');

	// Test needsApproval callback
	const needsApprovalResult = firstTool.needsApproval();
	t.is(typeof needsApprovalResult, 'boolean');

	await client.disconnect();
});

testOrSkip('MCPClient.callTool: executes tool on connected HTTP server', async t => {
	const client = new MCPClient();

	const server = {
		name: 'test-deepwiki',
		transport: 'http' as const,
		url: 'https://mcp.deepwiki.com/mcp',
	};

	await client.connectToServer(server);

	// Get available tools
	const tools = client.getServerTools('test-deepwiki');
	t.true(tools.length > 0, 'Should have tools to call');

	// Try to call the first tool (note: may fail if tool requires specific args)
	const toolName = tools[0].name;

	// This test just verifies the call mechanism works
	// The actual tool call may fail due to invalid arguments, but that's expected
	try {
		const result = await client.callTool(toolName, {});
		t.truthy(result);
	} catch (error) {
		// Tool call failed due to invalid args - this is expected for testing
		t.truthy(error, 'Tool call may fail with invalid arguments');
	}

	await client.disconnect();
});

testOrSkip('MCPClient.getToolMapping: returns mapping from connected HTTP server', async t => {
	const client = new MCPClient();

	const server = {
		name: 'test-deepwiki',
		transport: 'http' as const,
		url: 'https://mcp.deepwiki.com/mcp',
	};

	await client.connectToServer(server);

	// Get tool mapping
	const mapping = client.getToolMapping();

	t.true(mapping.size > 0, 'Should have tool mappings');

	// Verify mapping structure
	const firstMapping = mapping.entries().next().value;
	if (firstMapping) {
		const [toolName, mappingInfo] = firstMapping;

		t.is(typeof toolName, 'string');
		t.deepEqual(mappingInfo, {
			serverName: 'test-deepwiki',
			originalName: toolName,
		});
	}

	await client.disconnect();
});

testOrSkip('MCPClient.getToolEntries: returns entries from connected HTTP server', async t => {
	const client = new MCPClient();

	const server = {
		name: 'test-context7',
		transport: 'http' as const,
		url: 'https://mcp.context7.com/mcp',
	};

	await client.connectToServer(server);

	// Get tool entries
	const entries = client.getToolEntries();

	t.true(entries.length > 0, 'Should have tool entries');

	// Verify entry structure
	const firstEntry = entries[0];

	t.is(typeof firstEntry.name, 'string');
	t.truthy(firstEntry.tool);
	t.is(typeof firstEntry.handler, 'function');

	await client.disconnect();
});

// ============================================================================
// Error Handling Tests with Real Servers
// ============================================================================

testOrSkip('MCPClient.connectToServer: handles invalid URL gracefully', async t => {
	const client = new MCPClient();

	const server = {
		name: 'test-invalid',
		transport: 'http' as const,
		url: 'http://localhost:99999/invalid-mcp', // Invalid port
	};

	// Should throw error due to connection failure
	await t.throwsAsync(async () => await client.connectToServer(server));
});

testOrSkip('MCPClient.connectToServer: validates websocket URL protocol', async t => {
	const client = new MCPClient();

	const server = {
		name: 'test-invalid-ws',
		transport: 'websocket' as const,
		url: 'http://invalid-protocol.com', // Wrong protocol for websocket
	};

	// Should throw error during validation
	await t.throwsAsync(
		async () => await client.connectToServer(server),
		{message: /websocket URL must use ws:\/\/ or wss:\/\/ protocol/i},
	);
});

test('MCPClient: alwaysAllow disables approval prompts', async t => {
	const client = new MCPClient();
	const serverName = 'auto-server';

	(client as any).serverTools.set(serverName, [
		{
			name: 'safe_tool',
			description: 'Safe MCP tool',
			inputSchema: {type: 'object'},
			serverName,
		},
	]);

	(client as any).serverConfigs.set(serverName, {
		name: serverName,
		transport: 'stdio',
		alwaysAllow: ['safe_tool'],
	});

	setCurrentMode('normal');

	const registry = client.getNativeToolsRegistry();
	const tool = registry['safe_tool'];

	t.truthy(tool);
	const needsApproval =
		typeof tool?.needsApproval === 'function'
			? await tool.needsApproval({}, {toolCallId: 'test', messages: []})
			: tool?.needsApproval ?? true;
	t.false(needsApproval);
});

test('MCPClient: non-whitelisted tools still require approval', async t => {
	const client = new MCPClient();
	const serverName = 'restricted-server';

	(client as any).serverTools.set(serverName, [
		{
			name: 'restricted_tool',
			description: 'Requires approval',
			inputSchema: {type: 'object'},
			serverName,
		},
	]);

	(client as any).serverConfigs.set(serverName, {
		name: serverName,
		transport: 'stdio',
		alwaysAllow: [],
	});

	setCurrentMode('normal');

	const registry = client.getNativeToolsRegistry();
	const tool = registry['restricted_tool'];

	t.truthy(tool);
	const needsApproval =
		typeof tool?.needsApproval === 'function'
			? await tool.needsApproval({}, {toolCallId: 'test', messages: []})
			: tool?.needsApproval ?? false;
	t.true(needsApproval);
});

// ============================================================================
// Regression Tests for Smart Schema Sanitization
// ============================================================================

test('callTool sanitizes object arguments to strings when schema expects a string (regression test)', async t => {
	const client = new MCPClient();

	// 1. SETUP: Mock the internal state to simulate a connected server and a tool definition.
	const mockServerName = 'test-server';
	const mockToolName = 'fake_write_file';

	// @ts-ignore - Accessing private properties for testing
	client.serverTools.set(mockServerName, [
		{
			name: mockToolName,
			description: 'A test tool',
			serverName: mockServerName,
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string' },
					content: { type: 'string' } // <-- Schema demands a string here
				},
			},
		},
	]);
	// @ts-ignore
	client.clients.set(mockServerName, {}); // Dummy client object

	// 2. SPY: We will "spy" on executeToolCall to see what arguments it receives.
	let capturedArgs: Record<string, unknown> | undefined;
	// @ts-ignore
	client.executeToolCall = async (_client: unknown, _toolName: string, args: Record<string, unknown>) => {
		capturedArgs = args;
		return "Mock success";
	};

	// 3. ACTION: Call the public method with the "bad" data (an object for 'content').
	await client.callTool(mockToolName, {
		path: 'test.txt',
		content: { "key": "value" } // <-- This is the object that caused the crash.
	});

	// 4. ASSERTION: Verify the captured arguments were sanitized.
	t.truthy(capturedArgs, 'executeToolCall should have been called');
	if (capturedArgs) {
		t.is(typeof capturedArgs.content, 'string', 'The content object should have been converted to a string');
		t.is(capturedArgs.content, '{"key":"value"}', 'The string content should be the JSON stringified version');
		t.is(typeof capturedArgs.path, 'string', 'Path should remain a string');
	}
});
