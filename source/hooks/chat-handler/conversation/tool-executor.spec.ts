import test from 'ava';
import {executeToolsDirectly} from './tool-executor.js';
import type {ToolCall, ToolResult} from '@/types/core';

// ============================================================================
// Test Helpers
// ============================================================================

import {setToolRegistryGetter} from '@/message-handler';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Mock tool registry for tests
const mockToolHandler: ToolCall['function']['name'] extends infer T
  ? Record<string, (args: Record<string, unknown>) => Promise<string>>
  : Record<string, any> = {
  test_tool: async () => 'Tool executed',
  tool1: async () => 'Tool 1 executed',
  tool2: async () => 'Tool 2 executed',
  tool3: async () => 'Tool 3 executed',
  create_task: async () => 'Task created',
  list_tasks: async () => 'Tasks listed',
  update_task: async () => 'Task updated',
  delete_task: async () => 'Task deleted',
  slow_tool1: async () => { await delay(50); return 'Slow tool 1 done'; },
  slow_tool2: async () => { await delay(50); return 'Slow tool 2 done'; },
  slow_tool3: async () => { await delay(50); return 'Slow tool 3 done'; },
  failing_tool: async () => {
    throw new Error('Tool execution failed');
  },
  passing_tool: async () => 'Tool passed',
  unvalidated_tool: async () => 'Tool executed',
  validated_tool: async () => 'Tool executed',
};

const createMockToolRegistry = () => mockToolHandler;

// Set up tool registry before all tests
test.before(async () => {
  setToolRegistryGetter(createMockToolRegistry);
});

// Create a mock tool manager
const createMockToolManager = (config: {
	validatorResult?: {valid: boolean; error?: string};
	shouldFail?: boolean;
	readOnlyTools?: string[];
} = {}) => ({
	getToolValidator: (name: string) => {
		if (config.validatorResult) {
			return async () => config.validatorResult!;
		}
		return undefined;
	},
	getTool: (name: string) => ({
		execute: async () => {
			if (config.shouldFail) {
				throw new Error('Tool execution failed');
			}
			return 'Tool executed';
		},
	}),
	hasTool: (name: string) => true,
	getToolFormatter: (name: string) => undefined,
	isReadOnly: (name: string) => config.readOnlyTools?.includes(name) ?? false,
});

// Create a mock conversation state manager
const createMockConversationStateManager = () => ({
	current: {
		updateAfterToolExecution: () => {},
		updateAssistantMessage: () => {},
	},
});

// ============================================================================
// Validation Failure Tests
// ============================================================================

test('executeToolsDirectly - handles validation failure', async t => {
	const toolCalls: ToolCall[] = [
		{
			id: 'call_1',
			function: {
				name: 'test_tool',
				arguments: '{"path": "invalid"}',
			},
		},
	];

	const conversationStateManager = createMockConversationStateManager();
	const addToChatQueueCalls: unknown[] = [];
	const addToChatQueue = (component: unknown) => {
		addToChatQueueCalls.push(component);
	};

	const toolManager = createMockToolManager({
		validatorResult: {
			valid: false,
			error: 'Validation failed: path does not exist',
		},
	});

	const results = await executeToolsDirectly(
		toolCalls,
		toolManager,
		conversationStateManager as any,
		addToChatQueue,
		() => 1,
	);

	t.is(results.length, 1);
	t.is(results[0].role, 'tool');
	t.is(results[0].name, 'test_tool');
	t.true(results[0].content.includes('Validation failed'));
});

test('executeToolsDirectly - continues after validation failure', async t => {
	const toolCalls: ToolCall[] = [
		{
			id: 'call_1',
			function: {
				name: 'failing_tool',
				arguments: '{}',
			},
		},
		{
			id: 'call_2',
			function: {
				name: 'passing_tool',
				arguments: '{}',
			},
		},
	];

	const conversationStateManager = createMockConversationStateManager();
	const addToChatQueue = () => {};

	const toolManager = createMockToolManager({
		validatorResult: {
			valid: false,
			error: 'Validation failed',
		},
	});

	// Should skip validation failure and continue to next tool
	const results = await executeToolsDirectly(
		toolCalls,
		toolManager,
		conversationStateManager as any,
		addToChatQueue,
		() => 1,
	);

	// Both tools should be attempted (validation happens for all first)
	t.is(results.length, 2);
});

// ============================================================================
// Successful Execution Tests
// ============================================================================

test('executeToolsDirectly - executes tool successfully', async t => {
	const toolCalls: ToolCall[] = [
		{
			id: 'call_1',
			function: {
				name: 'test_tool',
				arguments: '{"path": "valid"}',
			},
		},
	];

	const conversationStateManager = createMockConversationStateManager();
	const addToChatQueue = () => {};

	const toolManager = createMockToolManager({
		// No validator means no validation check
		validatorResult: undefined,
		shouldFail: false,
	});

	const results = await executeToolsDirectly(
		toolCalls,
		toolManager,
		conversationStateManager as any,
		addToChatQueue,
		() => 1,
	);

	t.is(results.length, 1);
	t.is(results[0].role, 'tool');
	t.is(results[0].name, 'test_tool');
	t.true(results[0].content.includes('Tool executed'));
});

test('executeToolsDirectly - executes multiple read-only tools in parallel', async t => {
	const toolCalls: ToolCall[] = [
		{
			id: 'call_1',
			function: {name: 'tool1', arguments: '{"arg1": "value1"}'},
		},
		{
			id: 'call_2',
			function: {name: 'tool2', arguments: '{"arg2": "value2"}'},
		},
		{
			id: 'call_3',
			function: {name: 'tool3', arguments: '{"arg3": "value3"}'},
		},
	];

	const conversationStateManager = createMockConversationStateManager();
	const addToChatQueue = () => {};

	const toolManager = createMockToolManager({
		validatorResult: undefined,
		shouldFail: false,
		readOnlyTools: ['tool1', 'tool2', 'tool3'],
	});

	const results = await executeToolsDirectly(
		toolCalls,
		toolManager,
		conversationStateManager as any,
		addToChatQueue,
		() => 1,
	);

	// All three tools should execute
	t.is(results.length, 3);
	// All results should have unique tool_call_ids
	const toolIds = results.map(r => r.tool_call_id);
	t.is(new Set(toolIds).size, 3);
});

test('executeToolsDirectly - runs read-only tools concurrently (timing)', async t => {
	const toolCalls: ToolCall[] = [
		{id: 'slow_1', function: {name: 'slow_tool1', arguments: '{}'}},
		{id: 'slow_2', function: {name: 'slow_tool2', arguments: '{}'}},
		{id: 'slow_3', function: {name: 'slow_tool3', arguments: '{}'}},
	];

	const conversationStateManager = createMockConversationStateManager();
	const addToChatQueue = () => {};
	const toolManager = createMockToolManager({
		validatorResult: undefined,
		shouldFail: false,
		readOnlyTools: ['slow_tool1', 'slow_tool2', 'slow_tool3'],
	});

	const start = Date.now();
	const results = await executeToolsDirectly(
		toolCalls,
		toolManager,
		conversationStateManager as any,
		addToChatQueue,
		() => 1,
	);
	const elapsed = Date.now() - start;

	t.is(results.length, 3);
	// 3 tools x 50ms each: sequential would take ~150ms, parallel should take ~50ms
	// Use 120ms threshold to account for overhead while catching sequential execution
	t.true(elapsed < 120, `Expected parallel execution (<120ms) but took ${elapsed}ms`);
});

test('executeToolsDirectly - preserves result order matching input order', async t => {
	const toolCalls: ToolCall[] = [
		{id: 'slow_1', function: {name: 'slow_tool1', arguments: '{}'}},
		{id: 'slow_2', function: {name: 'slow_tool2', arguments: '{}'}},
		{id: 'slow_3', function: {name: 'slow_tool3', arguments: '{}'}},
	];

	const conversationStateManager = createMockConversationStateManager();
	const addToChatQueue = () => {};
	const toolManager = createMockToolManager({
		validatorResult: undefined,
		shouldFail: false,
		readOnlyTools: ['slow_tool1', 'slow_tool2', 'slow_tool3'],
	});

	const results = await executeToolsDirectly(
		toolCalls,
		toolManager,
		conversationStateManager as any,
		addToChatQueue,
		() => 1,
	);

	// Results must be in same order as input tool calls
	t.is(results[0].tool_call_id, 'slow_1');
	t.is(results[1].tool_call_id, 'slow_2');
	t.is(results[2].tool_call_id, 'slow_3');
});

test('executeToolsDirectly - runs non-read-only tools sequentially (timing)', async t => {
	const toolCalls: ToolCall[] = [
		{id: 'slow_1', function: {name: 'slow_tool1', arguments: '{}'}},
		{id: 'slow_2', function: {name: 'slow_tool2', arguments: '{}'}},
		{id: 'slow_3', function: {name: 'slow_tool3', arguments: '{}'}},
	];

	const conversationStateManager = createMockConversationStateManager();
	const addToChatQueue = () => {};
	const toolManager = createMockToolManager({
		validatorResult: undefined,
		shouldFail: false,
		// NOT marking as readOnly — should run sequentially
		readOnlyTools: [],
	});

	const start = Date.now();
	const results = await executeToolsDirectly(
		toolCalls,
		toolManager,
		conversationStateManager as any,
		addToChatQueue,
		() => 1,
	);
	const elapsed = Date.now() - start;

	t.is(results.length, 3);
	// 3 tools x 50ms each: sequential should take ~150ms
	t.true(elapsed >= 120, `Expected sequential execution (>=120ms) but took ${elapsed}ms`);
});

// ============================================================================
// Error Handling Tests
// ============================================================================

test('executeToolsDirectly - handles execution error gracefully', async t => {
	const toolCalls: ToolCall[] = [
		{
			id: 'call_1',
			function: {
				name: 'failing_tool',
				arguments: '{}',
			},
		},
	];

	const conversationStateManager = createMockConversationStateManager();
	const addToChatQueue = () => {};

	const toolManager = createMockToolManager({
		shouldFail: true,
	});

	const results = await executeToolsDirectly(
		toolCalls,
		toolManager,
		conversationStateManager as any,
		addToChatQueue,
		() => 1,
	);

	t.is(results.length, 1);
	t.is(results[0].role, 'tool');
	t.is(results[0].name, 'failing_tool');
	t.true(results[0].content.includes('Error:'));
});

test('executeToolsDirectly - continues after error with remaining tools', async t => {
	const toolCalls: ToolCall[] = [
		{
			id: 'call_1',
			function: {name: 'failing_tool', arguments: '{}'},
		},
		{
			id: 'call_2',
			function: {name: 'passing_tool', arguments: '{}'},
		},
	];

	const conversationStateManager = createMockConversationStateManager();
	const addToChatQueue = () => {};

	const toolManager = createMockToolManager({
		shouldFail: true,
	});

	const results = await executeToolsDirectly(
		toolCalls,
		toolManager,
		conversationStateManager as any,
		addToChatQueue,
		() => 1,
	);

	// Both tools should be attempted (execution happens for all in parallel)
	t.is(results.length, 2);
});

// ============================================================================
// Edge Cases
// ============================================================================

test('executeToolsDirectly - returns empty array for no tools', async t => {
	const toolCalls: ToolCall[] = [];

	const conversationStateManager = createMockConversationStateManager();
	const addToChatQueue = () => {};

	const results = await executeToolsDirectly(
		toolCalls,
		null,
		conversationStateManager as any,
		addToChatQueue,
		() => 1,
	);

	t.deepEqual(results, []);
});

test('executeToolsDirectly - handles null tool manager', async t => {
	const toolCalls: ToolCall[] = [
		{
			id: 'call_1',
			function: {name: 'test_tool', arguments: '{}'},
		},
	];

	const conversationStateManager = createMockConversationStateManager();
	const addToChatQueue = () => {};

	const toolManager = null;

	const results = await executeToolsDirectly(
		toolCalls,
		toolManager,
		conversationStateManager as any,
		addToChatQueue,
		() => 1,
	);

	t.is(results.length, 1);
});

test('executeToolsDirectly - handles tool with no validator', async t => {
	const toolCalls: ToolCall[] = [
		{
			id: 'call_1',
			function: {name: 'unvalidated_tool', arguments: '{}'},
		},
	];

	const conversationStateManager = createMockConversationStateManager();
	const addToChatQueue = () => {};

	const toolManager = createMockToolManager({
		// No validator defined for this tool
		validatorResult: undefined,
		shouldFail: false,
	});

	const results = await executeToolsDirectly(
		toolCalls,
		toolManager,
		conversationStateManager as any,
		addToChatQueue,
		() => 1,
	);

	t.is(results.length, 1);
});

// ============================================================================
// Compact Display Tests
// ============================================================================

test('executeToolsDirectly - compact display calls onCompactToolCount instead of adding to chat queue', async t => {
	const toolCalls: ToolCall[] = [
		{id: 'call_1', function: {name: 'tool1', arguments: '{}'}},
		{id: 'call_2', function: {name: 'tool1', arguments: '{}'}},
		{id: 'call_3', function: {name: 'tool2', arguments: '{}'}},
	];

	const conversationStateManager = createMockConversationStateManager();
	const addToChatQueueCalls: unknown[] = [];
	const addToChatQueue = (component: unknown) => {
		addToChatQueueCalls.push(component);
	};
	const toolManager = createMockToolManager({
		validatorResult: undefined,
		shouldFail: false,
	});

	const compactCounts: Array<string> = [];

	const results = await executeToolsDirectly(
		toolCalls,
		toolManager,
		conversationStateManager as any,
		addToChatQueue,
		() => 1,
		{
			compactDisplay: true,
			onCompactToolCount: (toolName) => {
				compactCounts.push(toolName);
			},
		},
	);

	t.is(results.length, 3);
	// Compact mode should NOT add to chat queue (counts are displayed live instead)
	t.is(addToChatQueueCalls.length, 0);
	// Should have called onCompactToolCount for each tool
	t.deepEqual(compactCounts, ['tool1', 'tool1', 'tool2']);
});

test('executeToolsDirectly - handles tool with valid validation', async t => {
	const toolCalls: ToolCall[] = [
		{
			id: 'call_1',
			function: {
				name: 'validated_tool',
				arguments: '{"path": "valid"}',
			},
		},
	];

	const conversationStateManager = createMockConversationStateManager();
	const addToChatQueue = () => {};

	const toolManager = createMockToolManager({
		validatorResult: {valid: true},
		shouldFail: false,
	});

	const results = await executeToolsDirectly(
		toolCalls,
		toolManager,
		conversationStateManager as any,
		addToChatQueue,
		() => 1,
	);

	t.is(results.length, 1);
});

test('executeToolsDirectly - groupByReadOnly groups consecutive read-only tools', async t => {
	// [read, read, write, read, read] should produce groups:
	// [[read, read], [write], [read, read]]
	const toolCalls: ToolCall[] = [
		{id: 'call_1', function: {name: 'slow_tool1', arguments: '{}'}},
		{id: 'call_2', function: {name: 'slow_tool2', arguments: '{}'}},
		{id: 'call_3', function: {name: 'tool1', arguments: '{}'}},
		{id: 'call_4', function: {name: 'slow_tool3', arguments: '{}'}},
		{id: 'call_5', function: {name: 'slow_tool1', arguments: '{}'}},
	];

	const conversationStateManager = createMockConversationStateManager();
	const addToChatQueue = () => {};
	const toolManager = createMockToolManager({
		validatorResult: undefined,
		shouldFail: false,
		readOnlyTools: ['slow_tool1', 'slow_tool2', 'slow_tool3'],
	});

	const start = Date.now();
	const results = await executeToolsDirectly(
		toolCalls,
		toolManager,
		conversationStateManager as any,
		addToChatQueue,
		() => 1,
	);
	const elapsed = Date.now() - start;

	t.is(results.length, 5);
	// If grouped correctly: group1 (2 parallel ~50ms) + group2 (1 sequential) + group3 (2 parallel ~50ms)
	// Total ~100ms + overhead, NOT 250ms (5 * 50ms sequential)
	t.true(elapsed < 200, `Should be faster than sequential (took ${elapsed}ms)`);
});

test('executeToolsDirectly - onCompactToolCount receives correct tool names', async t => {
	const toolCalls: ToolCall[] = [
		{id: 'call_1', function: {name: 'tool1', arguments: '{}'}},
		{id: 'call_2', function: {name: 'tool2', arguments: '{}'}},
		{id: 'call_3', function: {name: 'tool1', arguments: '{}'}},
	];

	const conversationStateManager = createMockConversationStateManager();
	const addToChatQueue = () => {};
	const toolManager = createMockToolManager({
		validatorResult: undefined,
		shouldFail: false,
	});

	const countedTools: string[] = [];

	await executeToolsDirectly(
		toolCalls,
		toolManager,
		conversationStateManager as any,
		addToChatQueue,
		() => 1,
		{
			compactDisplay: true,
			onCompactToolCount: (toolName) => {
				countedTools.push(toolName);
			},
		},
	);

	t.is(countedTools.length, 3);
	t.is(countedTools[0], 'tool1');
	t.is(countedTools[1], 'tool2');
	t.is(countedTools[2], 'tool1');
});

test('executeToolsDirectly - compact mode without onCompactToolCount does not error', async t => {
	const toolCalls: ToolCall[] = [
		{id: 'call_1', function: {name: 'tool1', arguments: '{}'}},
	];

	const conversationStateManager = createMockConversationStateManager();
	const addToChatQueue = () => {};
	const toolManager = createMockToolManager({
		validatorResult: undefined,
		shouldFail: false,
	});

	await t.notThrowsAsync(async () => {
		await executeToolsDirectly(
			toolCalls,
			toolManager,
			conversationStateManager as any,
			addToChatQueue,
			() => 1,
			{
				compactDisplay: true,
				// onCompactToolCount intentionally omitted
			},
		);
	});
});

test('executeToolsDirectly - compact mode always expands task tools', async t => {
	const toolCalls: ToolCall[] = [
		{id: 'call_1', function: {name: 'tool1', arguments: '{}'}},
		{id: 'call_2', function: {name: 'create_task', arguments: '{}'}},
		{id: 'call_3', function: {name: 'list_tasks', arguments: '{}'}},
		{id: 'call_4', function: {name: 'update_task', arguments: '{}'}},
		{id: 'call_5', function: {name: 'delete_task', arguments: '{}'}},
	];

	const conversationStateManager = createMockConversationStateManager();
	const addToChatQueueCalls: unknown[] = [];
	const addToChatQueue = (component: unknown) => {
		addToChatQueueCalls.push(component);
	};
	const toolManager = createMockToolManager({
		validatorResult: undefined,
		shouldFail: false,
	});

	const compactCounts: string[] = [];
	let liveTaskUpdateCount = 0;

	const results = await executeToolsDirectly(
		toolCalls,
		toolManager,
		conversationStateManager as any,
		addToChatQueue,
		() => 1,
		{
			compactDisplay: true,
			onCompactToolCount: (toolName) => {
				compactCounts.push(toolName);
			},
			onLiveTaskUpdate: () => {
				liveTaskUpdateCount++;
			},
		},
	);

	t.is(results.length, 5);
	// Only tool1 should be compacted (counted), task tools go to live display
	t.deepEqual(compactCounts, ['tool1']);
	// Task tools should trigger live task updates instead of adding to chat queue
	t.is(liveTaskUpdateCount, 4, 'Task tools should trigger live task updates');
});

test('executeToolsDirectly - compact mode still displays errors in full', async t => {
	const toolCalls: ToolCall[] = [
		{id: 'call_1', function: {name: 'failing_tool', arguments: '{}'}},
	];

	const conversationStateManager = createMockConversationStateManager();
	const addToChatQueueCalls: unknown[] = [];
	const addToChatQueue = (component: unknown) => {
		addToChatQueueCalls.push(component);
	};
	const toolManager = createMockToolManager({
		validatorResult: undefined,
		shouldFail: true,
	});

	const compactCounts: string[] = [];

	const results = await executeToolsDirectly(
		toolCalls,
		toolManager,
		conversationStateManager as any,
		addToChatQueue,
		() => 1,
		{
			compactDisplay: true,
			onCompactToolCount: (toolName) => {
				compactCounts.push(toolName);
			},
		},
	);

	t.is(results.length, 1);
	t.true(results[0].content.includes('Error:'));
	// Error results should be displayed in full (added to chat queue), not counted
	t.true(addToChatQueueCalls.length > 0);
	t.is(compactCounts.length, 0);
});
