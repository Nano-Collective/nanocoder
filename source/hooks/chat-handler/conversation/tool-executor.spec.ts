import test from 'ava';
import {executeToolsDirectly} from './tool-executor.js';
import type {ToolCall, ToolResult} from '@/types/core';

// ============================================================================
// Test Helpers
// ============================================================================

import {setToolRegistryGetter} from '@/message-handler';

// Mock tool registry for tests
const mockToolHandler: ToolCall['function']['name'] extends infer T
  ? Record<string, (args: Record<string, unknown>) => Promise<string>>
  : Record<string, any> = {
  test_tool: async () => 'Tool executed',
  tool1: async () => 'Tool 1 executed',
  tool2: async () => 'Tool 2 executed',
  tool3: async () => 'Tool 3 executed',
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

test('executeToolsDirectly - executes multiple tools in parallel', async t => {
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
