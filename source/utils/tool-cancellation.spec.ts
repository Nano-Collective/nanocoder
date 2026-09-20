import type {ToolCall} from '@/types/index';
import test from 'ava';
import {createCancellationResults} from './tool-cancellation';

console.log(`\ntool-cancellation.spec.ts`);

// Helper to create mock tool calls
function createMockToolCall(
	id: string,
	name: string,
	args: Record<string, unknown> = {},
): ToolCall {
	return {
		id,
		function: {
			name,
			arguments: args,
		},
	};
}

// Basic functionality tests
test('createCancellationResults - creates result for single tool call', t => {
	const toolCalls = [createMockToolCall('call-1', 'ReadFile', {path: '/test'})];
	const results = createCancellationResults(toolCalls);

	t.is(results.length, 1);
	t.is(results[0].tool_call_id, 'call-1');
	t.is(results[0].role, 'tool');
	t.is(results[0].name, 'ReadFile');
	t.is(results[0].content, 'Tool execution was cancelled by the user.');
});

test('createCancellationResults - creates results for multiple tool calls', t => {
	const toolCalls = [
		createMockToolCall('call-1', 'ReadFile', {path: '/test1'}),
		createMockToolCall('call-2', 'WriteFile', {path: '/test2'}),
		createMockToolCall('call-3', 'ExecuteBash', {command: 'ls'}),
	];
	const results = createCancellationResults(toolCalls);

	t.is(results.length, 3);
	t.is(results[0].tool_call_id, 'call-1');
	t.is(results[1].tool_call_id, 'call-2');
	t.is(results[2].tool_call_id, 'call-3');
});

test('createCancellationResults - handles empty array', t => {
	const toolCalls: ToolCall[] = [];
	const results = createCancellationResults(toolCalls);

	t.is(results.length, 0);
	t.deepEqual(results, []);
});

// Field mapping tests
test('createCancellationResults - correctly maps tool_call_id from id', t => {
	const toolCalls = [createMockToolCall('unique-id-123', 'SomeTool')];
	const results = createCancellationResults(toolCalls);

	t.is(results[0].tool_call_id, 'unique-id-123');
});

test('createCancellationResults - correctly maps name from function.name', t => {
	const toolCalls = [createMockToolCall('call-1', 'CustomToolName')];
	const results = createCancellationResults(toolCalls);

	t.is(results[0].name, 'CustomToolName');
});

test('createCancellationResults - sets role to "tool"', t => {
	const toolCalls = [createMockToolCall('call-1', 'AnyTool')];
	const results = createCancellationResults(toolCalls);

	t.is(results[0].role, 'tool');
});

test('createCancellationResults - sets consistent cancellation message', t => {
	const toolCalls = [
		createMockToolCall('call-1', 'Tool1'),
		createMockToolCall('call-2', 'Tool2'),
	];
	const results = createCancellationResults(toolCalls);

	// All results should have the same cancellation message
	t.is(results[0].content, 'Tool execution was cancelled by the user.');
	t.is(results[1].content, 'Tool execution was cancelled by the user.');
});

// Edge cases with tool names
test('createCancellationResults - handles tools with special characters in name', t => {
	const toolCalls = [createMockToolCall('call-1', 'Tool_With_Underscores')];
	const results = createCancellationResults(toolCalls);

	t.is(results[0].name, 'Tool_With_Underscores');
});

test('createCancellationResults - handles tools with numbers in name', t => {
	const toolCalls = [createMockToolCall('call-1', 'Tool123')];
	const results = createCancellationResults(toolCalls);

	t.is(results[0].name, 'Tool123');
});

test('createCancellationResults - handles tools with camelCase name', t => {
	const toolCalls = [createMockToolCall('call-1', 'readFileContents')];
	const results = createCancellationResults(toolCalls);

	t.is(results[0].name, 'readFileContents');
});

// Edge cases with tool call IDs
test('createCancellationResults - handles very long tool call IDs', t => {
	const longId = 'a'.repeat(1000);
	const toolCalls = [createMockToolCall(longId, 'SomeTool')];
	const results = createCancellationResults(toolCalls);

	t.is(results[0].tool_call_id, longId);
});

test('createCancellationResults - handles UUID-style IDs', t => {
	const uuid = '550e8400-e29b-41d4-a716-446655440000';
	const toolCalls = [createMockToolCall(uuid, 'SomeTool')];
	const results = createCancellationResults(toolCalls);

	t.is(results[0].tool_call_id, uuid);
});

// Arguments handling (should be ignored in cancellation)
test('createCancellationResults - ignores tool arguments', t => {
	const complexArgs = {
		path: '/very/long/path',
		options: {recursive: true, force: true},
		metadata: {created: new Date(), author: 'test'},
	};
	const toolCalls = [createMockToolCall('call-1', 'ComplexTool', complexArgs)];
	const results = createCancellationResults(toolCalls);

	// Result should not include arguments
	t.false('arguments' in results[0]);
	// Only expected fields should be present
	t.is(Object.keys(results[0]).length, 4); // tool_call_id, role, name, content
});

// Multiple tool calls with same name
test('createCancellationResults - handles multiple calls to same tool', t => {
	const toolCalls = [
		createMockToolCall('call-1', 'ReadFile', {path: '/file1'}),
		createMockToolCall('call-2', 'ReadFile', {path: '/file2'}),
		createMockToolCall('call-3', 'ReadFile', {path: '/file3'}),
	];
	const results = createCancellationResults(toolCalls);

	t.is(results.length, 3);
	// All should have same name but different IDs
	t.is(results[0].name, 'ReadFile');
	t.is(results[1].name, 'ReadFile');
	t.is(results[2].name, 'ReadFile');
	t.is(results[0].tool_call_id, 'call-1');
	t.is(results[1].tool_call_id, 'call-2');
	t.is(results[2].tool_call_id, 'call-3');
});

// Result structure validation
test('createCancellationResults - result has correct structure', t => {
	const toolCalls = [createMockToolCall('call-1', 'TestTool')];
	const results = createCancellationResults(toolCalls);

	const result = results[0];
	t.true('tool_call_id' in result);
	t.true('role' in result);
	t.true('name' in result);
	t.true('content' in result);
	t.is(typeof result.tool_call_id, 'string');
	t.is(typeof result.role, 'string');
	t.is(typeof result.name, 'string');
	t.is(typeof result.content, 'string');
});

// Array immutability test
test('createCancellationResults - does not modify input array', t => {
	const toolCalls = [
		createMockToolCall('call-1', 'Tool1'),
		createMockToolCall('call-2', 'Tool2'),
	];
	const originalLength = toolCalls.length;
	const originalFirstId = toolCalls[0].id;

	createCancellationResults(toolCalls);

	t.is(toolCalls.length, originalLength);
	t.is(toolCalls[0].id, originalFirstId);
});

// Real-world scenario test
test('createCancellationResults - realistic multi-tool cancellation', t => {
	const toolCalls = [
		createMockToolCall('tc-001', 'ReadFile', {
			path: '/project/config.json',
		}),
		createMockToolCall('tc-002', 'FindFiles', {
			pattern: '**/*.ts',
			path: '/project',
		}),
		createMockToolCall('tc-003', 'ExecuteBash', {
			command: 'npm test',
		}),
		createMockToolCall('tc-004', 'WriteFile', {
			path: '/output.txt',
			content: 'test',
		}),
	];

	const results = createCancellationResults(toolCalls);

	t.is(results.length, 4);

	// Verify all have correct structure and cancellation message
	results.forEach((result, index) => {
		t.is(result.tool_call_id, `tc-00${index + 1}`);
		t.is(result.role, 'tool');
		t.is(result.content, 'Tool execution was cancelled by the user.');
	});

	// Verify specific tool names are preserved
	t.is(results[0].name, 'ReadFile');
	t.is(results[1].name, 'FindFiles');
	t.is(results[2].name, 'ExecuteBash');
	t.is(results[3].name, 'WriteFile');
});
