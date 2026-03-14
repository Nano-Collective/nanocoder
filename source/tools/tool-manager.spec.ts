import type {
	MCPInitResult,
	MCPServer,
} from '@/types/index';
import test from 'ava';
import {ToolManager} from './tool-manager';

console.log('\ntool-manager.spec.ts');

// ============================================================================
// Constructor Tests
// ============================================================================

test('constructor - initializes with static tools', t => {
	const manager = new ToolManager();

	// Should have some static tools registered
	const toolCount = manager.getToolCount();
	t.true(toolCount > 0, 'Should have static tools registered');
});

test('constructor - initializes without MCP client', t => {
	const manager = new ToolManager();

	const mcpClient = manager.getMCPClient();
	t.is(mcpClient, null, 'MCP client should be null initially');
});

test('constructor - static tools are accessible', t => {
	const manager = new ToolManager();

	const allTools = manager.getAllTools();
	t.true(Object.keys(allTools).length > 0, 'Should have accessible tools');
});

// ============================================================================
// MCP Initialization Tests
// ============================================================================

test('initializeMCP - returns empty array when no servers provided', async t => {
	const manager = new ToolManager();

	const results = await manager.initializeMCP([]);
	t.deepEqual(results, []);
});

test('initializeMCP - returns empty array when servers is undefined', async t => {
	const manager = new ToolManager();

	// @ts-expect-error Testing undefined input
	const results = await manager.initializeMCP(undefined);
	t.deepEqual(results, []);
});

test('initializeMCP - handles server connection errors gracefully', async t => {
	const manager = new ToolManager();

	const invalidServer: MCPServer = {
		name: 'invalid-server',
		command: 'non-existent-command',
		transport: 'stdio',
	};

	const results = await manager.initializeMCP([invalidServer]);

	// Should return a result even if connection failed
	t.is(results.length, 1);
	t.is(results[0].serverName, 'invalid-server');
	t.is(results[0].success, false);
	t.true(typeof results[0].error === 'string');
});

test('initializeMCP - calls onProgress callback for each server', async t => {
	const manager = new ToolManager();
	const progressResults: MCPInitResult[] = [];

	const invalidServer: MCPServer = {
		name: 'test-server',
		command: 'non-existent',
		transport: 'stdio',
	};

	await manager.initializeMCP([invalidServer], result => {
		progressResults.push(result);
	});

	t.is(progressResults.length, 1);
	t.is(progressResults[0].serverName, 'test-server');
});

// ============================================================================
// Tool Access Tests
// ============================================================================

test('getAllTools - returns all static tools', t => {
	const manager = new ToolManager();

	const tools = manager.getAllTools();
	t.true(typeof tools === 'object');
	t.true(Object.keys(tools).length > 0);
});

test('getAllTools - returns object with tool names as keys', t => {
	const manager = new ToolManager();

	const tools = manager.getAllTools();
	for (const [name, tool] of Object.entries(tools)) {
		t.true(typeof name === 'string');
		t.true(typeof tool === 'object');
		// AI SDK tools don't have a type property, they're callable objects
		t.true(typeof tool === 'object' || typeof tool === 'function');
	}
});

test('getToolRegistry - returns handler registry', t => {
	const manager = new ToolManager();

	const registry = manager.getToolRegistry();
	t.true(typeof registry === 'object');
	t.true(Object.keys(registry).length > 0);
});

test('getToolRegistry - all handlers are functions', t => {
	const manager = new ToolManager();

	const registry = manager.getToolRegistry();
	for (const handler of Object.values(registry)) {
		t.is(typeof handler, 'function');
	}
});

test('getToolHandler - returns handler for existing tool', t => {
	const manager = new ToolManager();

	const toolNames = manager.getToolNames();
	if (toolNames.length > 0) {
		const handler = manager.getToolHandler(toolNames[0]);
		t.is(typeof handler, 'function');
	} else {
		t.pass('No tools available to test');
	}
});

test('getToolHandler - returns undefined for non-existent tool', t => {
	const manager = new ToolManager();

	const handler = manager.getToolHandler('non-existent-tool-xyz');
	t.is(handler, undefined);
});

test('getToolFormatter - returns undefined for non-existent tool', t => {
	const manager = new ToolManager();

	const formatter = manager.getToolFormatter('non-existent-tool-xyz');
	t.is(formatter, undefined);
});

test('getToolValidator - returns undefined for non-existent tool', t => {
	const manager = new ToolManager();

	const validator = manager.getToolValidator('non-existent-tool-xyz');
	t.is(validator, undefined);
});

// ============================================================================
// Tool Checking Tests
// ============================================================================

test('hasTool - returns true for existing static tools', t => {
	const manager = new ToolManager();

	const toolNames = manager.getToolNames();
	if (toolNames.length > 0) {
		t.true(manager.hasTool(toolNames[0]));
	} else {
		t.pass('No tools available to test');
	}
});

test('hasTool - returns false for non-existent tool', t => {
	const manager = new ToolManager();

	t.false(manager.hasTool('definitely-not-a-real-tool-xyz'));
});

test('hasTool - is case-sensitive', t => {
	const manager = new ToolManager();

	const toolNames = manager.getToolNames();
	if (toolNames.length > 0) {
		const toolName = toolNames[0];
		const upperCaseName = toolName.toUpperCase();

		if (toolName !== upperCaseName) {
			t.true(manager.hasTool(toolName));
			t.false(manager.hasTool(upperCaseName));
		} else {
			t.pass('Tool name is already uppercase');
		}
	} else {
		t.pass('No tools available to test');
	}
});

// ============================================================================
// MCP Tool Info Tests
// ============================================================================

test('getMCPToolInfo - returns false when no MCP client', t => {
	const manager = new ToolManager();

	const info = manager.getMCPToolInfo('any-tool');
	t.deepEqual(info, {isMCPTool: false});
});

test('getMCPToolInfo - returns false for static tools', t => {
	const manager = new ToolManager();

	const toolNames = manager.getToolNames();
	if (toolNames.length > 0) {
		const info = manager.getMCPToolInfo(toolNames[0]);
		t.deepEqual(info, {isMCPTool: false});
	} else {
		t.pass('No tools available to test');
	}
});

test('getMCPToolInfo - returns false for non-existent tool', t => {
	const manager = new ToolManager();

	const info = manager.getMCPToolInfo('non-existent-tool');
	t.deepEqual(info, {isMCPTool: false});
});

// ============================================================================
// Disconnect MCP Tests
// ============================================================================

test('disconnectMCP - handles case when no MCP client exists', async t => {
	const manager = new ToolManager();

	// Should not throw
	await t.notThrowsAsync(async () => {
		await manager.disconnectMCP();
	});
});

test('disconnectMCP - resets MCP client to null', async t => {
	const manager = new ToolManager();

	// Even if no MCP client, should work
	await manager.disconnectMCP();
	t.is(manager.getMCPClient(), null);
});

// ============================================================================
// Tool Entry Tests
// ============================================================================

test('getToolEntry - returns entry for existing tool', t => {
	const manager = new ToolManager();

	const toolNames = manager.getToolNames();
	if (toolNames.length > 0) {
		const entry = manager.getToolEntry(toolNames[0]);
		t.true(typeof entry === 'object');
		t.true(entry !== undefined);
		t.true('handler' in entry!);
		t.true('tool' in entry!);
	} else {
		t.pass('No tools available to test');
	}
});

test('getToolEntry - returns undefined for non-existent tool', t => {
	const manager = new ToolManager();

	const entry = manager.getToolEntry('non-existent-tool-xyz');
	t.is(entry, undefined);
});

// ============================================================================
// Tool Names and Count Tests
// ============================================================================

test('getToolNames - returns array of strings', t => {
	const manager = new ToolManager();

	const names = manager.getToolNames();
	t.true(Array.isArray(names));
	t.true(names.length > 0);
	names.forEach(name => {
		t.is(typeof name, 'string');
	});
});

test('getToolNames - has no duplicates', t => {
	const manager = new ToolManager();

	const names = manager.getToolNames();
	const uniqueNames = [...new Set(names)];
	t.is(names.length, uniqueNames.length);
});

test('getToolCount - returns positive number', t => {
	const manager = new ToolManager();

	const count = manager.getToolCount();
	t.true(count > 0);
	t.is(typeof count, 'number');
});

test('getToolCount - matches getToolNames length', t => {
	const manager = new ToolManager();

	const count = manager.getToolCount();
	const names = manager.getToolNames();
	t.is(count, names.length);
});

// ============================================================================
// MCP Server Info Tests
// ============================================================================

test('getConnectedServers - returns empty array when no MCP client', t => {
	const manager = new ToolManager();

	const servers = manager.getConnectedServers();
	t.deepEqual(servers, []);
});

test('getServerTools - returns empty array when no MCP client', t => {
	const manager = new ToolManager();

	const tools = manager.getServerTools('any-server');
	t.deepEqual(tools, []);
});

test('getServerTools - returns empty array for non-existent server', t => {
	const manager = new ToolManager();

	const tools = manager.getServerTools('non-existent-server');
	t.deepEqual(tools, []);
});

test('getServerInfo - returns undefined when no MCP client', t => {
	const manager = new ToolManager();

	const info = manager.getServerInfo('any-server');
	t.is(info, undefined);
});

test('getServerInfo - returns undefined for non-existent server', t => {
	const manager = new ToolManager();

	const info = manager.getServerInfo('non-existent-server');
	t.is(info, undefined);
});

// ============================================================================
// MCP Client Accessor Tests
// ============================================================================

test('getMCPClient - returns null initially', t => {
	const manager = new ToolManager();

	const client = manager.getMCPClient();
	t.is(client, null);
});

// ============================================================================
// Integration Tests
// ============================================================================

test('integration - tool manager lifecycle', t => {
	const manager = new ToolManager();

	// Initial state
	t.true(manager.getToolCount() > 0);
	t.is(manager.getMCPClient(), null);
	t.deepEqual(manager.getConnectedServers(), []);

	// Tool access
	const tools = manager.getAllTools();
	t.true(Object.keys(tools).length > 0);

	const toolNames = manager.getToolNames();
	t.true(toolNames.length > 0);

	// Verify consistency
	t.is(toolNames.length, manager.getToolCount());
	t.is(toolNames.length, Object.keys(tools).length);
});

test('integration - tool entries have all required components', t => {
	const manager = new ToolManager();

	const toolNames = manager.getToolNames();
	for (const name of toolNames) {
		const entry = manager.getToolEntry(name);
		t.true(entry !== undefined, `Entry for ${name} should exist`);

		// All entries must have handler and tool
		t.true('handler' in entry!, `Entry for ${name} should have handler`);
		t.true('tool' in entry!, `Entry for ${name} should have tool`);
		t.is(typeof entry!.handler, 'function', `Handler for ${name} should be function`);
		t.true(typeof entry!.tool === 'object', `Tool for ${name} should be object`);
	}
});

test('integration - all tools are accessible through multiple methods', t => {
	const manager = new ToolManager();

	const toolNames = manager.getToolNames();
	const allTools = manager.getAllTools();
	const handlers = manager.getToolRegistry();

	// All tool names should be accessible through all methods
	for (const name of toolNames) {
		t.true(name in allTools, `Tool ${name} should be in getAllTools()`);
		t.true(name in handlers, `Tool ${name} should be in getToolRegistry()`);
		t.true(manager.hasTool(name), `hasTool() should return true for ${name}`);

		const handler = manager.getToolHandler(name);
		t.is(typeof handler, 'function', `getToolHandler() should return function for ${name}`);

		const entry = manager.getToolEntry(name);
		t.true(entry !== undefined, `getToolEntry() should return entry for ${name}`);
	}
});

// ============================================================================
// Edge Cases
// ============================================================================

test('edge case - handles multiple disconnectMCP calls', async t => {
	const manager = new ToolManager();

	// Multiple disconnects should not throw
	await manager.disconnectMCP();
	await manager.disconnectMCP();
	await manager.disconnectMCP();

	t.is(manager.getMCPClient(), null);
	t.pass('Multiple disconnects handled gracefully');
});

test('edge case - tool names with special characters', t => {
	const manager = new ToolManager();

	// Try to get tools with special characters in names
	const specialNames = [
		'tool-with-dash',
		'tool_with_underscore',
		'tool.with.dot',
		'tool$with$dollar',
		'tool:with:colon',
	];

	for (const name of specialNames) {
		// Should not throw, just return false/undefined
		t.notThrows(() => {
			manager.hasTool(name);
			manager.getToolHandler(name);
			manager.getToolEntry(name);
		});
	}
});

test('edge case - empty string tool name', t => {
	const manager = new ToolManager();

	t.false(manager.hasTool(''));
	t.is(manager.getToolHandler(''), undefined);
	t.is(manager.getToolEntry(''), undefined);
});

test('edge case - very long tool name', t => {
	const manager = new ToolManager();

	const longName = 'a'.repeat(1000);
	t.false(manager.hasTool(longName));
	t.is(manager.getToolHandler(longName), undefined);
});

// ============================================================================
// Static Tool Verification Tests
// ============================================================================

test('static tools - read_file tool exists', t => {
	const manager = new ToolManager();

	t.true(manager.hasTool('read_file'));
	const handler = manager.getToolHandler('read_file');
	t.is(typeof handler, 'function');
});

test('static tools - write_file tool exists', t => {
	const manager = new ToolManager();

	t.true(manager.hasTool('write_file'));
	const handler = manager.getToolHandler('write_file');
	t.is(typeof handler, 'function');
});

test('static tools - execute_bash tool exists', t => {
	const manager = new ToolManager();

	t.true(manager.hasTool('execute_bash'));
	const handler = manager.getToolHandler('execute_bash');
	t.is(typeof handler, 'function');
});

test('static tools - find_files tool exists', t => {
	const manager = new ToolManager();

	t.true(manager.hasTool('find_files'));
	const handler = manager.getToolHandler('find_files');
	t.is(typeof handler, 'function');
});

test('static tools - search_file_contents tool exists', t => {
	const manager = new ToolManager();

	t.true(manager.hasTool('search_file_contents'));
	const handler = manager.getToolHandler('search_file_contents');
	t.is(typeof handler, 'function');
});

// ============================================================================
// Concurrent Access Tests
// ============================================================================

// ============================================================================
// isReadOnly Tests
// ============================================================================

test('isReadOnly - returns true for read_file', t => {
	const manager = new ToolManager();
	t.true(manager.isReadOnly('read_file'));
});

test('isReadOnly - returns true for all read-only tools', t => {
	const manager = new ToolManager();
	const readOnlyTools = [
		'read_file',
		'find_files',
		'search_file_contents',
		'list_directory',
		'web_search',
		'fetch_url',
		'lsp_get_diagnostics',
		'git_status',
		'git_diff',
		'git_log',
		'list_tasks',
	];

	for (const toolName of readOnlyTools) {
		if (manager.hasTool(toolName)) {
			t.true(manager.isReadOnly(toolName), `${toolName} should be read-only`);
		}
	}
});

test('isReadOnly - returns false for mutating tools', t => {
	const manager = new ToolManager();
	const mutatingTools = [
		'write_file',
		'string_replace',
		'execute_bash',
		'create_task',
		'update_task',
		'delete_task',
	];

	for (const toolName of mutatingTools) {
		if (manager.hasTool(toolName)) {
			t.false(manager.isReadOnly(toolName), `${toolName} should not be read-only`);
		}
	}
});

test('isReadOnly - returns false for non-existent tool', t => {
	const manager = new ToolManager();
	t.false(manager.isReadOnly('non-existent-tool-xyz'));
});

test('isReadOnly - returns false for empty string', t => {
	const manager = new ToolManager();
	t.false(manager.isReadOnly(''));
});

// ============================================================================
// Concurrent Access Tests
// ============================================================================

test('concurrent - multiple simultaneous tool accesses', t => {
	const manager = new ToolManager();

	// Simulate concurrent access
	const results = [];
	for (let i = 0; i < 10; i++) {
		results.push(manager.getToolCount());
		results.push(manager.getToolNames().length);
		results.push(Object.keys(manager.getAllTools()).length);
	}

	// All results should be consistent
	const counts = results.filter((_, i) => i % 3 === 0);
	const names = results.filter((_, i) => i % 3 === 1);
	const tools = results.filter((_, i) => i % 3 === 2);

	t.true(new Set(counts).size === 1, 'Tool count should be consistent');
	t.true(new Set(names).size === 1, 'Tool names count should be consistent');
	t.true(new Set(tools).size === 1, 'All tools count should be consistent');
});
