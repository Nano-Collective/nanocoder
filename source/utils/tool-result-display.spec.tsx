import test from 'ava';
import React from 'react';
import {ErrorMessage} from '../components/message-box.js';
import ToolMessage from '../components/tool-message.js';
import type {ToolManager} from '../tools/tool-manager.js';
import type {ToolCall, ToolResult} from '../types/core.js';
import {displayToolResult} from './tool-result-display.js';

// ============================================================================
// Type Definitions
// ============================================================================

interface ErrorMessageProps {
	message: string;
	hideTitle?: boolean;
	hideBox?: boolean;
}

interface ToolMessageProps {
	title?: string;
	message: string | React.ReactNode;
	hideTitle?: boolean;
	hideBox?: boolean;
	isBashMode?: boolean;
}

// ============================================================================
// Test Helpers
// ============================================================================

// Helper to create a mock getNextComponentKey function
// Returns a function that always returns the same value (for simple tests)
// or can be called with createMockGetNextComponentKey() to get an incrementing counter
function createMockGetNextComponentKey(startValue = 1): () => number {
	let counter = startValue;
	return () => counter++;
}

// Simple mock that always returns 1 (for tests that don't care about uniqueness)
const mockGetNextComponentKey = () => 1;

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

// Helper to create mock tool results
function createMockToolResult(
	toolCallId: string,
	name: string,
	content: string,
): ToolResult {
	return {
		tool_call_id: toolCallId,
		role: 'tool',
		name,
		content,
	};
}

// Mock addToChatQueue function
function createMockAddToChatQueue() {
	const queue: React.ReactNode[] = [];
	const addToChatQueue = (component: React.ReactNode) => {
		queue.push(component);
	};
	return {addToChatQueue, queue};
}

// Mock ToolManager
class MockToolManager implements Partial<ToolManager> {
	private formatters: Map<string, (args: unknown, content: string) => unknown>;

	constructor() {
		this.formatters = new Map();
	}

	registerFormatter(
		toolName: string,
		formatter: (args: unknown, content: string) => unknown,
	) {
		this.formatters.set(toolName, formatter);
	}

	getToolFormatter(toolName: string) {
		return this.formatters.get(toolName);
	}
}

// Helper to safely cast MockToolManager to ToolManager for tests
function asMockToolManager(mock: MockToolManager): ToolManager {
	return mock as unknown as ToolManager;
}

// ============================================================================
// Tests for Error Display
// ============================================================================

test('displayToolResult - displays error message for error result', async t => {
	const toolCall = createMockToolCall('call-1', 'TestTool');
	const result = createMockToolResult(
		'call-1',
		'TestTool',
		'Error: Something went wrong',
	);
	const {addToChatQueue, queue} = createMockAddToChatQueue();

	await displayToolResult(toolCall, result, null, addToChatQueue, mockGetNextComponentKey);

	t.is(queue.length, 1);
	t.true(React.isValidElement(queue[0]));
	// Check that error component was created (ErrorMessage component)
	const element = queue[0] as React.ReactElement;
	t.is(element.type, ErrorMessage);
});

test('displayToolResult - strips "Error: " prefix from error message', async t => {
	const toolCall = createMockToolCall('call-1', 'TestTool');
	const result = createMockToolResult(
		'call-1',
		'TestTool',
		'Error: File not found',
	);
	const {addToChatQueue, queue} = createMockAddToChatQueue();

	await displayToolResult(toolCall, result, null, addToChatQueue, mockGetNextComponentKey);

	const element = queue[0] as React.ReactElement<ErrorMessageProps>;
	t.is(element.props.message, 'File not found');
});

test('displayToolResult - sets hideBox to true for error message', async t => {
	const toolCall = createMockToolCall('call-1', 'TestTool');
	const result = createMockToolResult(
		'call-1',
		'TestTool',
		'Error: Test error',
	);
	const {addToChatQueue, queue} = createMockAddToChatQueue();

	await displayToolResult(toolCall, result, null, addToChatQueue, mockGetNextComponentKey);

	const element = queue[0] as React.ReactElement<ErrorMessageProps>;
	t.is(element.props.hideBox, true);
});

// ============================================================================
// Tests for No ToolManager (Silent Return)
// ============================================================================

test('displayToolResult - returns silently when toolManager is null and no error', async t => {
	const toolCall = createMockToolCall('call-1', 'TestTool');
	const result = createMockToolResult('call-1', 'TestTool', 'Success result');
	const {addToChatQueue, queue} = createMockAddToChatQueue();

	await displayToolResult(toolCall, result, null, addToChatQueue, mockGetNextComponentKey);

	// With null toolManager and no error, function returns without adding to queue
	t.is(queue.length, 0);
});

// ============================================================================
// Tests for Formatter Execution
// ============================================================================

test('displayToolResult - uses formatter when available', async t => {
	const toolCall = createMockToolCall('call-1', 'ReadFile', {path: '/test'});
	const result = createMockToolResult('call-1', 'ReadFile', 'file contents');
	const {addToChatQueue, queue} = createMockAddToChatQueue();

	const toolManager = new MockToolManager();
	let formatterCalled = false;
	toolManager.registerFormatter('ReadFile', (_args, content) => {
		formatterCalled = true;
		return `Formatted: ${content}`;
	});

	await displayToolResult(
		toolCall,
		result,
		asMockToolManager(toolManager),
		addToChatQueue,
		mockGetNextComponentKey,
	);

	t.true(formatterCalled);
	t.is(queue.length, 1);
});

test('displayToolResult - displays formatted result as ToolMessage when formatter returns string', async t => {
	const toolCall = createMockToolCall('call-1', 'ReadFile', {path: '/test'});
	const result = createMockToolResult('call-1', 'ReadFile', 'raw content');
	const {addToChatQueue, queue} = createMockAddToChatQueue();

	const toolManager = new MockToolManager();
	toolManager.registerFormatter('ReadFile', () => 'Formatted content');

	await displayToolResult(
		toolCall,
		result,
		asMockToolManager(toolManager),
		addToChatQueue,
		mockGetNextComponentKey,
	);

	const element = queue[0] as React.ReactElement<ToolMessageProps>;
	t.is(element.type, ToolMessage);
	t.is(element.props.message, 'Formatted content');
	t.is(element.props.title, '⚒ ReadFile');
});

test('displayToolResult - clones React element when formatter returns element', async t => {
	const toolCall = createMockToolCall('call-1', 'CustomTool');
	const result = createMockToolResult('call-1', 'CustomTool', 'data');
	const {addToChatQueue, queue} = createMockAddToChatQueue();

	const customElement = <div>Custom formatted result</div>;
	const toolManager = new MockToolManager();
	toolManager.registerFormatter('CustomTool', () => customElement);

	await displayToolResult(
		toolCall,
		result,
		asMockToolManager(toolManager),
		addToChatQueue,
		mockGetNextComponentKey,
	);

	t.is(queue.length, 1);
	t.true(React.isValidElement(queue[0]));
	const element = queue[0] as React.ReactElement;
	t.truthy(element.key); // Should have a key added
});

test('displayToolResult - falls back to raw result when formatter throws', async t => {
	const toolCall = createMockToolCall('call-1', 'BrokenTool');
	const result = createMockToolResult('call-1', 'BrokenTool', 'raw result');
	const {addToChatQueue, queue} = createMockAddToChatQueue();

	const toolManager = new MockToolManager();
	toolManager.registerFormatter('BrokenTool', () => {
		throw new Error('Formatter error');
	});

	await displayToolResult(
		toolCall,
		result,
		asMockToolManager(toolManager),
		addToChatQueue,
		mockGetNextComponentKey,
	);

	t.is(queue.length, 1);
	const element = queue[0] as React.ReactElement<ToolMessageProps>;
	t.is(element.props.message, 'raw result');
	t.is(element.props.title, '⚒ BrokenTool');
});

test('displayToolResult - displays raw result when no formatter exists', async t => {
	const toolCall = createMockToolCall('call-1', 'NoFormatterTool');
	const result = createMockToolResult(
		'call-1',
		'NoFormatterTool',
		'raw content',
	);
	const {addToChatQueue, queue} = createMockAddToChatQueue();

	const toolManager = new MockToolManager();
	// Don't register any formatter

	await displayToolResult(
		toolCall,
		result,
		asMockToolManager(toolManager),
		addToChatQueue,
		mockGetNextComponentKey,
	);

	t.is(queue.length, 1);
	const element = queue[0] as React.ReactElement<ToolMessageProps>;
	t.is(element.props.message, 'raw content');
	t.is(element.props.title, '⚒ NoFormatterTool');
});

// ============================================================================
// Tests for Argument Parsing
// ============================================================================

test('displayToolResult - parses string arguments before passing to formatter', async t => {
	const toolCall = createMockToolCall('call-1', 'TestTool', {
		path: '/test',
	});
	const result = createMockToolResult('call-1', 'TestTool', 'result');
	const {addToChatQueue} = createMockAddToChatQueue();

	let receivedArgs: unknown;
	const toolManager = new MockToolManager();
	toolManager.registerFormatter('TestTool', (args, content) => {
		receivedArgs = args;
		return content;
	});

	await displayToolResult(
		toolCall,
		result,
		asMockToolManager(toolManager),
		addToChatQueue,
		mockGetNextComponentKey,
	);

	t.deepEqual(receivedArgs, {path: '/test'});
});

test('displayToolResult - passes object arguments directly to formatter', async t => {
	const args = {path: '/test', recursive: true};
	const toolCall = createMockToolCall('call-1', 'TestTool', args);
	const result = createMockToolResult('call-1', 'TestTool', 'result');
	const {addToChatQueue} = createMockAddToChatQueue();

	let receivedArgs: unknown;
	const toolManager = new MockToolManager();
	toolManager.registerFormatter('TestTool', (args, content) => {
		receivedArgs = args;
		return content;
	});

	await displayToolResult(
		toolCall,
		result,
		asMockToolManager(toolManager),
		addToChatQueue,
		mockGetNextComponentKey,
	);

	t.deepEqual(receivedArgs, args);
});

// ============================================================================
// Tests for Key Generation
// ============================================================================

test('displayToolResult - generates unique keys using getNextComponentKey', async t => {
	const toolCall = createMockToolCall('call-1', 'TestTool');
	const result = createMockToolResult('call-1', 'TestTool', 'result');
	const {addToChatQueue, queue} = createMockAddToChatQueue();

	const toolManager = new MockToolManager();

	// Create a counter function that returns incrementing values
	let counter = 0;
	const getNextComponentKey = () => ++counter;

	// Call twice - the function will return different values each time
	await displayToolResult(
		toolCall,
		result,
		asMockToolManager(toolManager),
		addToChatQueue,
		getNextComponentKey,
	);
	await displayToolResult(
		toolCall,
		result,
		asMockToolManager(toolManager),
		addToChatQueue,
		getNextComponentKey,
	);

	t.is(queue.length, 2);
	const element1 = queue[0] as React.ReactElement;
	const element2 = queue[1] as React.ReactElement;
	t.not(element1.key, element2.key);
});

test('displayToolResult - includes tool_call_id in key', async t => {
	const toolCall1 = createMockToolCall('call-1', 'TestTool');
	const result1 = createMockToolResult('call-1', 'TestTool', 'result');
	const toolCall2 = createMockToolCall('call-2', 'TestTool');
	const result2 = createMockToolResult('call-2', 'TestTool', 'result');
	const {addToChatQueue, queue} = createMockAddToChatQueue();

	const toolManager = new MockToolManager();
	const getNextComponentKey = () => 1; // Same counter, different tool_call_ids

	await displayToolResult(
		toolCall1,
		result1,
		asMockToolManager(toolManager),
		addToChatQueue,
		getNextComponentKey,
	);
	await displayToolResult(
		toolCall2,
		result2,
		asMockToolManager(toolManager),
		addToChatQueue,
		getNextComponentKey,
	);

	t.is(queue.length, 2);
	const element1 = queue[0] as React.ReactElement;
	const element2 = queue[1] as React.ReactElement;
	t.not(element1.key, element2.key);
});

// ============================================================================
// Tests for hideBox Property
// ============================================================================

test('displayToolResult - sets hideBox to true for all ToolMessage displays', async t => {
	const toolCall = createMockToolCall('call-1', 'TestTool');
	const result = createMockToolResult('call-1', 'TestTool', 'result');
	const {addToChatQueue, queue} = createMockAddToChatQueue();

	const toolManager = new MockToolManager();

	await displayToolResult(
		toolCall,
		result,
		asMockToolManager(toolManager),
		addToChatQueue,
		mockGetNextComponentKey,
	);

	const element = queue[0] as React.ReactElement<ToolMessageProps>;
	t.is(element.props.hideBox, true);
});

// ============================================================================
// Real-World Scenario Tests
// ============================================================================

test('displayToolResult - handles complex multi-tool scenario', async t => {
	const {addToChatQueue, queue} = createMockAddToChatQueue();
	const toolManager = new MockToolManager();

	// Register formatters for different tools
	toolManager.registerFormatter('ReadFile', (args: any) => (
		<div>Read {args.path}</div>
	));
	toolManager.registerFormatter('ExecuteBash', (_, content) => (
		<div>Bash: {content}</div>
	));

	// Execute multiple tool results
	await displayToolResult(
		createMockToolCall('call-1', 'ReadFile', {path: '/test.txt'}),
		createMockToolResult('call-1', 'ReadFile', 'file contents'),
		asMockToolManager(toolManager),
		addToChatQueue,
		mockGetNextComponentKey,
	);

	await displayToolResult(
		createMockToolCall('call-2', 'ExecuteBash', {command: 'ls'}),
		createMockToolResult('call-2', 'ExecuteBash', 'file1\nfile2'),
		asMockToolManager(toolManager),
		addToChatQueue,
		mockGetNextComponentKey,
	);

	await displayToolResult(
		createMockToolCall('call-3', 'ToolWithoutFormatter'),
		createMockToolResult('call-3', 'ToolWithoutFormatter', 'raw output'),
		asMockToolManager(toolManager),
		addToChatQueue,
		mockGetNextComponentKey,
	);

	t.is(queue.length, 3);
	// All should be valid React elements
	queue.forEach(item => {
		t.true(React.isValidElement(item));
	});
});
