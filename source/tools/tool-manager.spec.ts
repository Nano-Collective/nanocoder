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

// ============================================================================
// Tool Filtering Tests (for /tune tool profiles)
// ============================================================================

test('getFilteredTools - returns only tools matching allowed names', t => {
	const manager = new ToolManager();
	const allTools = manager.getAllTools();
	const allNames = Object.keys(allTools);

	// Filter to just read_file if it exists
	if (allNames.includes('read_file')) {
		const filtered = manager.getFilteredTools(['read_file']);
		t.is(Object.keys(filtered).length, 1);
		t.truthy(filtered.read_file);
	} else {
		t.pass('read_file not in static tools');
	}
});

test('getFilteredTools - returns empty for non-existent tool names', t => {
	const manager = new ToolManager();
	const filtered = manager.getFilteredTools(['nonexistent_tool']);
	t.is(Object.keys(filtered).length, 0);
});

test('getFilteredToolsWithoutExecute - returns tools without execute functions', t => {
	const manager = new ToolManager();
	const allNames = manager.getToolNames();

	if (allNames.length > 0) {
		const filtered = manager.getFilteredToolsWithoutExecute([allNames[0]!]);
		t.is(Object.keys(filtered).length, 1);
	} else {
		t.pass('No tools available');
	}
});

test('getFilteredTools - filters to minimal profile tools', t => {
	const manager = new ToolManager();
	const minimalTools = ['read_file', 'string_replace', 'execute_bash'];
	const filtered = manager.getFilteredTools(minimalTools);

	// Should only contain tools that exist in both the registry and the filter list
	for (const name of Object.keys(filtered)) {
		t.true(minimalTools.includes(name), `${name} should be in minimal profile`);
	}
});

test('getFilteredTools - full tool list returns all tools', t => {
	const manager = new ToolManager();
	const allNames = manager.getToolNames();
	const filtered = manager.getFilteredTools(allNames);
	t.is(Object.keys(filtered).length, allNames.length);
});

// ============================================================================
// getAvailableToolNames Tests (moved from prompt-builder)
// ============================================================================

test('getAvailableToolNames - returns all tools when no tune or mode', t => {
	const manager = new ToolManager();
	const result = manager.getAvailableToolNames();
	t.deepEqual(result, manager.getToolNames());
});

test('getAvailableToolNames - returns all tools when tune disabled', t => {
	const manager = new ToolManager();
	const result = manager.getAvailableToolNames({enabled: false, toolProfile: 'full', aggressiveCompact: false});
	t.deepEqual(result, manager.getToolNames());
});

test('getAvailableToolNames - filters to minimal profile', t => {
	const manager = new ToolManager();
	const result = manager.getAvailableToolNames({enabled: true, toolProfile: 'minimal', aggressiveCompact: false});
	t.deepEqual(result, ['read_file', 'write_file', 'string_replace', 'execute_bash', 'find_files', 'search_file_contents', 'list_directory', 'agent']);
});

test('getAvailableToolNames - full profile returns all minus mode exclusions', t => {
	const manager = new ToolManager();
	const result = manager.getAvailableToolNames({enabled: true, toolProfile: 'full', aggressiveCompact: false}, 'scheduler');
	t.false(result.includes('ask_user'));
	t.true(result.includes('read_file'));
});

test('getAvailableToolNames - plan mode excludes mutation tools', t => {
	const manager = new ToolManager();
	const result = manager.getAvailableToolNames({enabled: true, toolProfile: 'full', aggressiveCompact: false}, 'plan');
	t.false(result.includes('string_replace'));
	t.false(result.includes('write_file'));
	t.false(result.includes('execute_bash'));
	t.false(result.includes('git_commit'));
	t.false(result.includes('create_task'));
	// Read-only tools remain
	t.true(result.includes('read_file'));
	t.true(result.includes('find_files'));
});

test('getAvailableToolNames - plan + minimal excludes mutation tools from minimal set', t => {
	const manager = new ToolManager();
	const result = manager.getAvailableToolNames({enabled: true, toolProfile: 'minimal', aggressiveCompact: false}, 'plan');
	// Plan mode excludes write_file, string_replace, execute_bash from minimal
	t.deepEqual(result, ['read_file', 'find_files', 'search_file_contents', 'list_directory', 'agent']);
});

// ============================================================================
// getEffectiveTools Tests
// ============================================================================

test('getEffectiveTools - returns filtered tools without execute', t => {
	const manager = new ToolManager();
	const names = ['read_file'];
	const tools = manager.getEffectiveTools(names);
	t.is(Object.keys(tools).length, 1);
	t.truthy(tools.read_file);
});

test('getEffectiveTools - applies nonInteractiveAlwaysAllow override', t => {
	const manager = new ToolManager();
	const names = manager.getToolNames();
	const tools = manager.getEffectiveTools(names, {
		nonInteractiveAlwaysAllow: ['execute_bash'],
	});
	// The execute_bash tool should have needsApproval set to false
	const bashTool = tools.execute_bash as any;
	t.is(bashTool.needsApproval, false);
});

test('getEffectiveTools - does not override approval for tools not in allow list', t => {
	const manager = new ToolManager();
	const names = manager.getToolNames();
	const toolsBefore = manager.getEffectiveTools(names);
	const toolsAfter = manager.getEffectiveTools(names, {
		nonInteractiveAlwaysAllow: ['execute_bash'],
	});
	// write_file should not be changed by the allow list override
	const writeBefore = toolsBefore.write_file as any;
	const writeAfter = toolsAfter.write_file as any;
	t.is(writeAfter.needsApproval, writeBefore.needsApproval);
});

// ============================================================================
// Prompt/Runtime Parity Tests
// ============================================================================
// These tests verify that the tool names used for prompt building and the tool
// names used for runtime execution are always identical for a given mode/tune
// combo. This is the key invariant that prevents prompt/runtime drift.

import {buildSystemPrompt} from '../utils/prompt-builder.js';
import type {TuneConfig} from '@/types/config';
import type {DevelopmentMode} from '@/types/core';

/**
 * Helper: given a mode and tune, verify that getAvailableToolNames() and
 * getEffectiveTools() produce the exact same set of tool names.
 */
function assertPromptRuntimeParity(
	t: any,
	manager: ToolManager,
	tune: TuneConfig | undefined,
	mode: DevelopmentMode,
	label: string,
) {
	const availableNames = manager.getAvailableToolNames(tune, mode);
	const effectiveTools = manager.getEffectiveTools(availableNames);
	const runtimeNames = Object.keys(effectiveTools).sort();
	const promptNames = [...availableNames].sort();

	t.deepEqual(
		runtimeNames,
		promptNames,
		`Prompt/runtime parity broken for ${label}`,
	);

	// Also verify the prompt builds without error using these names
	t.notThrows(
		() => buildSystemPrompt(mode, tune, availableNames),
		`buildSystemPrompt should not throw for ${label}`,
	);
}

test('parity - normal mode, no tune', t => {
	const manager = new ToolManager();
	assertPromptRuntimeParity(t, manager, undefined, 'normal', 'normal/no-tune');
});

test('parity - auto-accept mode, no tune', t => {
	const manager = new ToolManager();
	assertPromptRuntimeParity(
		t,
		manager,
		undefined,
		'auto-accept',
		'auto-accept/no-tune',
	);
});

test('parity - plan mode, no tune', t => {
	const manager = new ToolManager();
	assertPromptRuntimeParity(t, manager, undefined, 'plan', 'plan/no-tune');
});

test('parity - scheduler mode, no tune', t => {
	const manager = new ToolManager();
	assertPromptRuntimeParity(
		t,
		manager,
		undefined,
		'scheduler',
		'scheduler/no-tune',
	);
});

test('parity - normal mode, full profile', t => {
	const manager = new ToolManager();
	const tune: TuneConfig = {
		enabled: true,
		toolProfile: 'full',
		aggressiveCompact: false,
	};
	assertPromptRuntimeParity(t, manager, tune, 'normal', 'normal/full');
});

test('parity - normal mode, minimal profile', t => {
	const manager = new ToolManager();
	const tune: TuneConfig = {
		enabled: true,
		toolProfile: 'minimal',
		aggressiveCompact: false,
	};
	assertPromptRuntimeParity(t, manager, tune, 'normal', 'normal/minimal');
});

test('parity - plan mode, minimal profile', t => {
	const manager = new ToolManager();
	const tune: TuneConfig = {
		enabled: true,
		toolProfile: 'minimal',
		aggressiveCompact: false,
	};
	assertPromptRuntimeParity(t, manager, tune, 'plan', 'plan/minimal');
});

test('parity - plan mode, full profile', t => {
	const manager = new ToolManager();
	const tune: TuneConfig = {
		enabled: true,
		toolProfile: 'full',
		aggressiveCompact: false,
	};
	assertPromptRuntimeParity(t, manager, tune, 'plan', 'plan/full');
});

test('parity - scheduler mode, full profile', t => {
	const manager = new ToolManager();
	const tune: TuneConfig = {
		enabled: true,
		toolProfile: 'full',
		aggressiveCompact: false,
	};
	assertPromptRuntimeParity(t, manager, tune, 'scheduler', 'scheduler/full');
});

test('parity - nonInteractiveAlwaysAllow does not change available tool set', t => {
	const manager = new ToolManager();
	const availableNames = manager.getAvailableToolNames(undefined, 'normal');

	// With allow list, the set of tools should be identical — only approval changes
	const toolsWithout = manager.getEffectiveTools(availableNames);
	const toolsWith = manager.getEffectiveTools(availableNames, {
		nonInteractiveAlwaysAllow: ['execute_bash', 'write_file'],
	});

	t.deepEqual(
		Object.keys(toolsWithout).sort(),
		Object.keys(toolsWith).sort(),
		'nonInteractiveAlwaysAllow should not add or remove tools',
	);
});

// ============================================================================
// XML Fallback — prompt grows when tool definitions are injected
// ============================================================================

import {formatToolsForPrompt} from '../ai-sdk-client/tools/tool-prompt-formatter.js';

test('XML fallback - tool definitions add significant length to system prompt', t => {
	const manager = new ToolManager();
	const availableNames = manager.getAvailableToolNames(undefined, 'normal');
	const nativePrompt = buildSystemPrompt('normal', undefined, availableNames, false);

	// Simulate what useChatHandler does when toolsDisabled=true
	const xmlPrompt = buildSystemPrompt('normal', undefined, availableNames, true);
	const tools = manager.getFilteredToolsWithoutExecute(availableNames);
	const toolDefs = formatToolsForPrompt(tools);
	const fullXmlPrompt = xmlPrompt + toolDefs;

	// The XML prompt with tool definitions should be substantially larger
	t.true(
		fullXmlPrompt.length > nativePrompt.length,
		'XML fallback prompt (with tool defs) should be larger than native prompt',
	);
	// Tool definitions alone should be significant
	t.true(
		toolDefs.length > 1000,
		'Tool definitions should be at least 1000 characters',
	);
});

test('XML fallback - tool definitions include examples per tool', t => {
	const manager = new ToolManager();
	const availableNames = manager.getAvailableToolNames(undefined, 'normal');
	const tools = manager.getFilteredToolsWithoutExecute(availableNames);
	const defs = formatToolsForPrompt(tools);

	// Should include XML examples
	t.true(defs.includes('**Example:**'));
	t.true(defs.includes('```xml'));
});
