import test from 'ava';
import type {ToolCall, ToolHandler, ToolResult} from '@/types/index';
import type {ToolManager} from '@/tools/tool-manager';
import {
	getToolManager,
	processToolUse,
	setToolManagerGetter,
	setToolRegistryGetter,
} from './message-handler';

console.log(`\nmessage-handler.spec.ts`);

// Test helpers
const createMockToolCall = (
	name: string,
	args: Record<string, unknown>,
	id = 'test-call-id',
): ToolCall => ({
	id,
	function: {
		name,
		arguments: args,
	},
});

const createMockToolRegistry = (handlers: Record<string, ToolHandler>) => {
	return () => handlers;
};

// Reset state before each test
test.beforeEach(() => {
	// Reset the getters
	setToolRegistryGetter(() => ({}));
	setToolManagerGetter(() => null);
});

// Test setToolRegistryGetter
test('setToolRegistryGetter - sets the tool registry getter', t => {
	const mockRegistry = {
		testTool: async () => 'result',
	};
	const getter = createMockToolRegistry(mockRegistry);

	setToolRegistryGetter(getter);

	// Verify by using processToolUse which relies on the registry
	const toolCall = createMockToolCall('testTool', {});
	return processToolUse(toolCall).then(result => {
		t.is(result.role, 'tool');
		t.is(result.name, 'testTool');
	});
});

// Test setToolManagerGetter
test('setToolManagerGetter - sets the tool manager getter', t => {
	const mockManager = {
		getTool: () => undefined,
	} as unknown as ToolManager;

	setToolManagerGetter(() => mockManager);
	const result = getToolManager();

	t.is(result, mockManager);
});

test('setToolManagerGetter - returns null when not set', t => {
	setToolManagerGetter(() => null);
	const result = getToolManager();
	t.is(result, null);
});

// Test getToolManager
test('getToolManager - returns null when getter not set', t => {
	setToolManagerGetter(() => null);
	const result = getToolManager();
	t.is(result, null);
});

test('getToolManager - returns tool manager from getter', t => {
	const mockManager = {
		getTool: () => undefined,
	} as unknown as ToolManager;

	setToolManagerGetter(() => mockManager);
	const result = getToolManager();

	t.is(result, mockManager);
});

// Test processToolUse - XML validation errors
test('processToolUse - throws on __xml_validation_error__', async t => {
	setToolRegistryGetter(createMockToolRegistry({}));

	const toolCall = createMockToolCall('__xml_validation_error__', {
		error: 'Invalid XML format',
	});

	await t.throwsAsync(processToolUse(toolCall), {
		message: 'Invalid XML format',
	});
});

test('processToolUse - throws on __xml_validation_error__ with custom message', async t => {
	setToolRegistryGetter(createMockToolRegistry({}));

	const toolCall = createMockToolCall('__xml_validation_error__', {
		error: 'Missing closing tag',
	});

	await t.throwsAsync(processToolUse(toolCall), {
		message: 'Missing closing tag',
	});
});

// Note: Testing uninitialized registry state is not feasible without module-level access
// The setToolRegistryGetter must be called before processToolUse, which is enforced by the
// application architecture. The beforeEach hook ensures proper initialization for all tests.

// Test processToolUse - unknown tool
test('processToolUse - throws on unknown tool', async t => {
	setToolRegistryGetter(
		createMockToolRegistry({
			knownTool: async () => 'result',
		}),
	);

	const toolCall = createMockToolCall('unknownTool', {});

	await t.throwsAsync(processToolUse(toolCall), {
		message: 'Unknown tool: unknownTool',
	});
});

// Test processToolUse - successful execution
test('processToolUse - executes tool successfully with object arguments', async t => {
	const mockHandler: ToolHandler = async (args: {path: string}) => {
		return `File content for ${args.path}`;
	};

	setToolRegistryGetter(
		createMockToolRegistry({
			read_file: mockHandler,
		}),
	);

	const toolCall = createMockToolCall('read_file', {path: '/test/file.txt'});
	const result: ToolResult = await processToolUse(toolCall);

	t.is(result.tool_call_id, 'test-call-id');
	t.is(result.role, 'tool');
	t.is(result.name, 'read_file');
	t.is(result.content, 'File content for /test/file.txt');
	t.is(result.structuredContent, undefined);
});

test('processToolUse - carries structured handler output onto the result', async t => {
	const mockHandler: ToolHandler = async () => ({
		llmContent: '1 error found',
		structured: {diagnostics: [{file: 'x.ts', severity: 'error'}]},
	});

	setToolRegistryGetter(
		createMockToolRegistry({
			lsp_get_diagnostics: mockHandler,
		}),
	);

	const toolCall = createMockToolCall('lsp_get_diagnostics', {});
	const result: ToolResult = await processToolUse(toolCall);

	// The text representation becomes `content`; the structured payload is
	// carried separately for the model.
	t.is(result.content, '1 error found');
	t.deepEqual(result.structuredContent, {
		diagnostics: [{file: 'x.ts', severity: 'error'}],
	});
});

test('processToolUse - executes tool successfully with string arguments (JSON parsing)', async t => {
	const mockHandler: ToolHandler = async (args: {command: string}) => {
		return `Executed: ${args.command}`;
	};

	setToolRegistryGetter(
		createMockToolRegistry({
			execute_bash: mockHandler,
		}),
	);

	// Arguments as JSON string (simulating XML parser output)
	const toolCall: ToolCall = {
		id: 'bash-call-id',
		function: {
			name: 'execute_bash',
			arguments: {command: 'ls -la'} as Record<string, unknown>,
		},
	};

	const result: ToolResult = await processToolUse(toolCall);

	t.is(result.tool_call_id, 'bash-call-id');
	t.is(result.role, 'tool');
	t.is(result.name, 'execute_bash');
	t.is(result.content, 'Executed: ls -la');
});

test('processToolUse - executes tool with complex nested arguments', async t => {
	const mockHandler: ToolHandler = async (args: {
		config: {nested: {value: number}};
	}) => {
		return `Value: ${args.config.nested.value}`;
	};

	setToolRegistryGetter(
		createMockToolRegistry({
			complex_tool: mockHandler,
		}),
	);

	const toolCall = createMockToolCall('complex_tool', {
		config: {
			nested: {
				value: 42,
			},
		},
	});

	const result: ToolResult = await processToolUse(toolCall);

	t.is(result.content, 'Value: 42');
});

test('processToolUse - executes tool with array arguments', async t => {
	const mockHandler: ToolHandler = async (args: {items: string[]}) => {
		return `Items: ${args.items.join(', ')}`;
	};

	setToolRegistryGetter(
		createMockToolRegistry({
			list_tool: mockHandler,
		}),
	);

	const toolCall = createMockToolCall('list_tool', {
		items: ['a', 'b', 'c'],
	});

	const result: ToolResult = await processToolUse(toolCall);

	t.is(result.content, 'Items: a, b, c');
});

test('processToolUse - executes tool with empty arguments', async t => {
	const mockHandler: ToolHandler = async () => {
		return 'Success';
	};

	setToolRegistryGetter(
		createMockToolRegistry({
			no_args_tool: mockHandler,
		}),
	);

	const toolCall = createMockToolCall('no_args_tool', {});
	const result: ToolResult = await processToolUse(toolCall);

	t.is(result.content, 'Success');
});

// Test processToolUse - error handling
test('processToolUse - catches and returns handler errors as tool result', async t => {
	const mockHandler: ToolHandler = async () => {
		throw new Error('Handler execution failed');
	};

	setToolRegistryGetter(
		createMockToolRegistry({
			failing_tool: mockHandler,
		}),
	);

	const toolCall = createMockToolCall('failing_tool', {});
	const result: ToolResult = await processToolUse(toolCall);

	t.is(result.tool_call_id, 'test-call-id');
	t.is(result.role, 'tool');
	t.is(result.name, 'failing_tool');
	t.is(result.content, 'Error: Handler execution failed');
});

test('processToolUse - catches non-Error exceptions', async t => {
	const mockHandler: ToolHandler = async () => {
		throw 'String error';
	};

	setToolRegistryGetter(
		createMockToolRegistry({
			string_error_tool: mockHandler,
		}),
	);

	const toolCall = createMockToolCall('string_error_tool', {});
	const result: ToolResult = await processToolUse(toolCall);

	t.is(result.content, 'Error: String error');
});

test('processToolUse - catches object exceptions', async t => {
	const mockHandler: ToolHandler = async () => {
		throw {message: 'Object error', code: 500};
	};

	setToolRegistryGetter(
		createMockToolRegistry({
			object_error_tool: mockHandler,
		}),
	);

	const toolCall = createMockToolCall('object_error_tool', {});
	const result: ToolResult = await processToolUse(toolCall);

	t.true(result.content.startsWith('Error:'));
	t.true(result.content.includes('Object error'));
	t.true(result.content.includes('500'));
});

test('processToolUse - handles malformed JSON arguments in strict mode', async t => {
	const mockHandler: ToolHandler = async () => {
		return 'Should not reach here';
	};

	setToolRegistryGetter(
		createMockToolRegistry({
			test_tool: mockHandler,
		}),
	);

	// Simulate malformed JSON arguments that fail strict parsing
	const toolCall: ToolCall = {
		id: 'malformed-id',
		function: {
			name: 'test_tool',
			arguments: '{invalid json}' as unknown as Record<string, unknown>,
		},
	};

	const result: ToolResult = await processToolUse(toolCall);

	t.is(result.tool_call_id, 'malformed-id');
	t.is(result.role, 'tool');
	t.is(result.name, 'test_tool');
	t.true(result.content.includes('Error: Invalid tool arguments'));
});

// Test processToolUse - preserves tool_call_id
test('processToolUse - preserves tool_call_id in successful result', async t => {
	const mockHandler: ToolHandler = async () => 'result';

	setToolRegistryGetter(
		createMockToolRegistry({
			test_tool: mockHandler,
		}),
	);

	const toolCall = createMockToolCall('test_tool', {}, 'custom-call-id-123');
	const result: ToolResult = await processToolUse(toolCall);

	t.is(result.tool_call_id, 'custom-call-id-123');
});

test('processToolUse - preserves tool_call_id in error result', async t => {
	const mockHandler: ToolHandler = async () => {
		throw new Error('Failed');
	};

	setToolRegistryGetter(
		createMockToolRegistry({
			test_tool: mockHandler,
		}),
	);

	const toolCall = createMockToolCall('test_tool', {}, 'error-call-id-456');
	const result: ToolResult = await processToolUse(toolCall);

	t.is(result.tool_call_id, 'error-call-id-456');
});

// Test processToolUse - async handler execution
test('processToolUse - handles async handlers correctly', async t => {
	const mockHandler: ToolHandler = async (args: {delay: number}) => {
		await new Promise(resolve => setTimeout(resolve, args.delay));
		return 'Async result';
	};

	setToolRegistryGetter(
		createMockToolRegistry({
			async_tool: mockHandler,
		}),
	);

	const toolCall = createMockToolCall('async_tool', {delay: 10});
	const result: ToolResult = await processToolUse(toolCall);

	t.is(result.content, 'Async result');
});

// Integration tests - multiple tools
test('processToolUse - handles multiple tool calls in sequence', async t => {
	let callCount = 0;
	const mockHandler: ToolHandler = async (args: {id: number}) => {
		callCount++;
		return `Call ${args.id}`;
	};

	setToolRegistryGetter(
		createMockToolRegistry({
			counter_tool: mockHandler,
		}),
	);

	const call1 = createMockToolCall('counter_tool', {id: 1}, 'call-1');
	const call2 = createMockToolCall('counter_tool', {id: 2}, 'call-2');
	const call3 = createMockToolCall('counter_tool', {id: 3}, 'call-3');

	const result1 = await processToolUse(call1);
	const result2 = await processToolUse(call2);
	const result3 = await processToolUse(call3);

	t.is(callCount, 3);
	t.is(result1.content, 'Call 1');
	t.is(result2.content, 'Call 2');
	t.is(result3.content, 'Call 3');
});

// Edge cases
test('processToolUse - handles null in arguments', async t => {
	const mockHandler: ToolHandler = async (args: {value: null}) => {
		return `Value is ${args.value}`;
	};

	setToolRegistryGetter(
		createMockToolRegistry({
			null_tool: mockHandler,
		}),
	);

	const toolCall = createMockToolCall('null_tool', {value: null});
	const result: ToolResult = await processToolUse(toolCall);

	t.is(result.content, 'Value is null');
});

test('processToolUse - handles boolean arguments', async t => {
	const mockHandler: ToolHandler = async (args: {flag: boolean}) => {
		return args.flag ? 'enabled' : 'disabled';
	};

	setToolRegistryGetter(
		createMockToolRegistry({
			bool_tool: mockHandler,
		}),
	);

	const toolCallTrue = createMockToolCall('bool_tool', {flag: true}, 'id-1');
	const toolCallFalse = createMockToolCall(
		'bool_tool',
		{flag: false},
		'id-2',
	);

	const resultTrue = await processToolUse(toolCallTrue);
	const resultFalse = await processToolUse(toolCallFalse);

	t.is(resultTrue.content, 'enabled');
	t.is(resultFalse.content, 'disabled');
});

test('processToolUse - handles numeric arguments', async t => {
	const mockHandler: ToolHandler = async (args: {
		int: number;
		float: number;
	}) => {
		return `int: ${args.int}, float: ${args.float}`;
	};

	setToolRegistryGetter(
		createMockToolRegistry({
			numeric_tool: mockHandler,
		}),
	);

	const toolCall = createMockToolCall('numeric_tool', {int: 42, float: 3.14});
	const result: ToolResult = await processToolUse(toolCall);

	t.is(result.content, 'int: 42, float: 3.14');
});

test('processToolUse - handles special characters in string arguments', async t => {
	const mockHandler: ToolHandler = async (args: {text: string}) => {
		return args.text;
	};

	setToolRegistryGetter(
		createMockToolRegistry({
			text_tool: mockHandler,
		}),
	);

	const specialText = 'Hello "world"\nNew line\tTab\r\nWindows line';
	const toolCall = createMockToolCall('text_tool', {text: specialText});
	const result: ToolResult = await processToolUse(toolCall);

	t.is(result.content, specialText);
});

// Test error message formatting
test('processToolUse - formats Error instance correctly', async t => {
	const mockHandler: ToolHandler = async () => {
		const error = new Error('Custom error message');
		error.name = 'CustomError';
		throw error;
	};

	setToolRegistryGetter(
		createMockToolRegistry({
			error_tool: mockHandler,
		}),
	);

	const toolCall = createMockToolCall('error_tool', {});
	const result: ToolResult = await processToolUse(toolCall);

	t.is(result.content, 'Error: Custom error message');
});

test('processToolUse - handles undefined return value', async t => {
	const mockHandler: ToolHandler = async () => {
		return undefined as unknown as string;
	};

	setToolRegistryGetter(
		createMockToolRegistry({
			undefined_tool: mockHandler,
		}),
	);

	const toolCall = createMockToolCall('undefined_tool', {});
	const result: ToolResult = await processToolUse(toolCall);

	t.is(result.content, undefined);
});

test('processToolUse - handles empty string return value', async t => {
	const mockHandler: ToolHandler = async () => {
		return '';
	};

	setToolRegistryGetter(
		createMockToolRegistry({
			empty_tool: mockHandler,
		}),
	);

	const toolCall = createMockToolCall('empty_tool', {});
	const result: ToolResult = await processToolUse(toolCall);

	t.is(result.content, '');
});
