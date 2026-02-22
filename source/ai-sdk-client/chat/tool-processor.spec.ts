import test from 'ava';
import type {AISDKCoreTool, StreamCallbacks} from '@/types/index';
import {processXMLToolCalls} from './tool-processor.js';

test('processXMLToolCalls returns empty result when no tools available', async t => {
	const content = 'Some response text';
	const tools: Record<string, AISDKCoreTool> = {};
	const callbacks: StreamCallbacks = {};

	const result = await processXMLToolCalls(content, tools, callbacks);

	t.deepEqual(result.toolCalls, []);
	t.is(result.cleanedContent, content);
});

test('processXMLToolCalls returns empty result when content is empty', async t => {
	const content = '';
	const tools: Record<string, AISDKCoreTool> = {
		test_tool: {} as AISDKCoreTool, // Type-only check, actual structure doesn't matter for empty content test
	};
	const callbacks: StreamCallbacks = {};

	const result = await processXMLToolCalls(content, tools, callbacks);

	t.deepEqual(result.toolCalls, []);
	t.is(result.cleanedContent, content);
});

test('processXMLToolCalls handles malformed XML gracefully', async t => {
	const content = '<tool_call>\n<name>test_tool</name>\n<arguments>';
	const tools: Record<string, AISDKCoreTool> = {
		test_tool: {} as AISDKCoreTool,
	};
	const callbacks: StreamCallbacks = {
		onToolCall: () => {},
	};

	// Function should not throw, even with malformed XML
	const result = await processXMLToolCalls(content, tools, callbacks);

	t.truthy(result);
	t.true(Array.isArray(result.toolCalls));
	t.is(typeof result.cleanedContent, 'string');
});

test('processXMLToolCalls handles valid XML content', async t => {
	const content =
		'<tool_call>\n<name>test_tool</name>\n<arguments>{"arg": "value"}</arguments>\n</tool_call>';
	const tools: Record<string, AISDKCoreTool> = {
		test_tool: {} as AISDKCoreTool,
	};

	const callbacks: StreamCallbacks = {
		onToolCall: () => {},
	};

	// Function should not throw with valid XML structure
	const result = await processXMLToolCalls(content, tools, callbacks);

	t.truthy(result);
	t.true(Array.isArray(result.toolCalls));
	t.is(typeof result.cleanedContent, 'string');
});

test('processXMLToolCalls handles mixed content', async t => {
	const content =
		'Some text before\n<tool_call>\n<name>test_tool</name>\n<arguments>{}</arguments>\n</tool_call>\nSome text after';
	const tools: Record<string, AISDKCoreTool> = {
		test_tool: {} as AISDKCoreTool,
	};
	const callbacks: StreamCallbacks = {};

	// Function should not throw with mixed content
	const result = await processXMLToolCalls(content, tools, callbacks);

	t.truthy(result);
	t.true(Array.isArray(result.toolCalls));
	t.is(typeof result.cleanedContent, 'string');
});

test('processXMLToolCalls returns original content when no XML tool calls', async t => {
	const content = 'Just some plain text response';
	const tools: Record<string, AISDKCoreTool> = {
		test_tool: {} as AISDKCoreTool,
	};
	const callbacks: StreamCallbacks = {};

	const result = await processXMLToolCalls(content, tools, callbacks);

	t.deepEqual(result.toolCalls, []);
	t.is(result.cleanedContent, content);
});

// ============================================================================
// Callback Invocation Tests
// ============================================================================

test('processXMLToolCalls invokes onToolCall callback for well-formed XML', async t => {
	let callbackInvoked = false;
	let capturedCall: unknown = null;

	const content = '<test_tool><param1>value1</param1></test_tool>';
	const tools: Record<string, AISDKCoreTool> = {
		test_tool: {} as AISDKCoreTool,
	};
	const callbacks: StreamCallbacks = {
		onToolCall: (toolCall: unknown) => {
			callbackInvoked = true;
			capturedCall = toolCall;
		},
	};

	const result = await processXMLToolCalls(content, tools, callbacks);

	t.true(callbackInvoked);
	t.truthy(capturedCall);
	t.true(Array.isArray(result.toolCalls));
});

test('processXMLToolCalls invokes onToolCall callback for malformed XML', async t => {
	let callbackInvoked = false;
	let capturedCall: unknown = null;

	const content = '[tool_use: test_tool]';
	const tools: Record<string, AISDKCoreTool> = {
		test_tool: {} as AISDKCoreTool,
	};
	const callbacks: StreamCallbacks = {
		onToolCall: (toolCall: unknown) => {
			callbackInvoked = true;
			capturedCall = toolCall;
		},
	};

	const result = await processXMLToolCalls(content, tools, callbacks);

	t.true(callbackInvoked);
	t.truthy(capturedCall);
	// Malformed call should have specific structure
	t.true(Array.isArray(result.toolCalls));
});

test('processXMLToolCalls does not invoke callbacks when no tools available', async t => {
	let callbackInvoked = false;

	const content = '<test_tool><param>value</param></test_tool>';
	const tools: Record<string, AISDKCoreTool> = {};
	const callbacks: StreamCallbacks = {
		onToolCall: () => {
			callbackInvoked = true;
		},
	};

	const result = await processXMLToolCalls(content, tools, callbacks);

	t.false(callbackInvoked);
	t.deepEqual(result.toolCalls, []);
});

// ============================================================================
// Malformed XML Pattern Tests
// ============================================================================

test('processXMLToolCalls detects [tool_use: name] pattern', async t => {
	const content = '[tool_use: write_file]';
	const tools: Record<string, AISDKCoreTool> = {
		write_file: {} as AISDKCoreTool,
	};
	const callbacks: StreamCallbacks = {};

	const result = await processXMLToolCalls(content, tools, callbacks);

	// Should return a validation error tool call
	t.true(result.toolCalls.length > 0);
	t.is(result.toolCalls[0].function.name, '__xml_validation_error__');
	t.is(result.cleanedContent, ''); // Content should be cleared
});

test('processXMLToolCalls detects [Tool: name] pattern', async t => {
	const content = '[Tool: read_file]';
	const tools: Record<string, AISDKCoreTool> = {
		read_file: {} as AISDKCoreTool,
	};
	const callbacks: StreamCallbacks = {};

	const result = await processXMLToolCalls(content, tools, callbacks);

	t.true(result.toolCalls.length > 0);
	t.is(result.toolCalls[0].function.name, '__xml_validation_error__');
});

test('processXMLToolCalls detects <function=name> pattern', async t => {
	const content = '<function=write_file>';
	const tools: Record<string, AISDKCoreTool> = {
		write_file: {} as AISDKCoreTool,
	};
	const callbacks: StreamCallbacks = {};

	const result = await processXMLToolCalls(content, tools, callbacks);

	t.true(result.toolCalls.length > 0);
	t.is(result.toolCalls[0].function.name, '__xml_validation_error__');
});

test('processXMLToolCalls detects <parameter=name> pattern', async t => {
	const content = '<parameter=path>/some/path</parameter>';
	const tools: Record<string, AISDKCoreTool> = {
		write_file: {} as AISDKCoreTool,
	};
	const callbacks: StreamCallbacks = {};

	const result = await processXMLToolCalls(content, tools, callbacks);

	t.true(result.toolCalls.length > 0);
	t.is(result.toolCalls[0].function.name, '__xml_validation_error__');
});

// ============================================================================
// Well-formed XML Tool Call Tests
// ============================================================================

test('processXMLToolCalls parses well-formed tool calls with underscores', async t => {
	const content = '<write_file><path>/test/path</path><content>hello</content></write_file>';
	const tools: Record<string, AISDKCoreTool> = {
		write_file: {} as AISDKCoreTool,
	};
	const callbacks: StreamCallbacks = {};

	const result = await processXMLToolCalls(content, tools, callbacks);

	t.true(result.toolCalls.length > 0);
	t.is(result.toolCalls[0].function.name, 'write_file');
});

test('processXMLToolCalls handles multiple parameters', async t => {
	const content = '<edit_file><path>/test/path</path><old_text>old</old_text><new_text>new</new_text></edit_file>';
	const tools: Record<string, AISDKCoreTool> = {
		edit_file: {} as AISDKCoreTool,
	};
	const callbacks: StreamCallbacks = {};

	const result = await processXMLToolCalls(content, tools, callbacks);

	t.true(result.toolCalls.length > 0);
	t.truthy(result.toolCalls[0].function.arguments);
});

test('processXMLToolCalls handles tool calls in markdown code blocks', async t => {
	const content = '```\n<test_tool><param>value</param></test_tool>\n```';
	const tools: Record<string, AISDKCoreTool> = {
		test_tool: {} as AISDKCoreTool,
	};
	const callbacks: StreamCallbacks = {};

	const result = await processXMLToolCalls(content, tools, callbacks);

	t.true(result.toolCalls.length > 0);
	// Cleaned content should not contain the tool call
	t.false(result.cleanedContent.includes('<test_tool>'));
});

test('processXMLToolCalls handles tool calls with JSON parameters', async t => {
	const content = '<test_tool><options>{"key": "value"}</options></test_tool>';
	const tools: Record<string, AISDKCoreTool> = {
		test_tool: {} as AISDKCoreTool,
	};
	const callbacks: StreamCallbacks = {};

	const result = await processXMLToolCalls(content, tools, callbacks);

	t.true(result.toolCalls.length > 0);
	const args = result.toolCalls[0].function.arguments;
	t.truthy(args);
});

// ============================================================================
// Edge Cases
// ============================================================================

test('processXMLToolCalls handles whitespace-only content', async t => {
	const content = '   \n\n  \n  ';
	const tools: Record<string, AISDKCoreTool> = {
		test_tool: {} as AISDKCoreTool,
	};
	const callbacks: StreamCallbacks = {};

	const result = await processXMLToolCalls(content, tools, callbacks);

	t.deepEqual(result.toolCalls, []);
});

test('processXMLToolCalls handles undefined callbacks', async t => {
	const content = '<test_tool><param>value</param></test_tool>';
	const tools: Record<string, AISDKCoreTool> = {
		test_tool: {} as AISDKCoreTool,
	};
	const callbacks: StreamCallbacks = {};

	// Should not throw even with undefined callbacks
	const result = await processXMLToolCalls(content, tools, callbacks);

	t.true(Array.isArray(result.toolCalls));
});

test('processXMLToolCalls preserves content without tool calls', async t => {
	const content = 'Here is some text response from the AI';
	const tools: Record<string, AISDKCoreTool> = {
		test_tool: {} as AISDKCoreTool,
	};
	const callbacks: StreamCallbacks = {};

	const result = await processXMLToolCalls(content, tools, callbacks);

	t.is(result.cleanedContent, content);
});

test('processXMLToolCalls filters HTML tags from tool calls', async t => {
	// HTML tags should not be detected as tool calls
	const content = '<div>This is HTML</div><p>And a paragraph</p>';
	const tools: Record<string, AISDKCoreTool> = {
		test_tool: {} as AISDKCoreTool,
	};
	const callbacks: StreamCallbacks = {};

	const result = await processXMLToolCalls(content, tools, callbacks);

	// Should not detect HTML as tool calls
	t.deepEqual(result.toolCalls, []);
});
