import test from 'ava';
import {setCurrentMode} from '../context/mode-context';
import {MCPClient} from './mcp-client';

console.log(`\nmcp-client.spec.ts`);

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
