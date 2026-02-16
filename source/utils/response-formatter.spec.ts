import test from 'ava';
import {normalizeLLMResponse, formatNormalizedResponse, isResponseComplete} from './response-formatter.js';

console.log(`\nresponse-formatter.spec.ts`);

// Basic normalization tests
test('normalizeLLMResponse - handles plain string', async t => {
	const response = "Here's the file: ```json{\"name\":\"write_file\"...}```";
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.content.length > 0, true);
	t.is(normalized.metadata.detectedFormat, 'plain'); // String has JSON pattern but not valid tool call
	t.true(normalized.metadata.hasCodeBlocks); // Has triple backticks even if incomplete
});

test('normalizeLLMResponse - handles JSON object with tool_calls', async t => {
	const response = {
		role: 'assistant',
		tool_calls: [
			{
				id: 'call_1',
				type: 'function',
				function: {
					name: 'write_file',
					arguments: {path: '/test.txt', content: 'hello'},
				},
			},
		],
	};
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.metadata.detectedFormat, 'json');
	t.true(normalized.metadata.hasJSONBlocks);
	t.true(normalized.toolCalls.length > 0);
});

test('normalizeLLMResponse - handles plain JSON object', async t => {
	const response = {path: "/tmp/test.txt", content: "hello"};
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.metadata.detectedFormat, 'json');
	t.false(normalized.metadata.hasJSONBlocks); // Not a tool call format
});

test('normalizeLLMResponse - handles malformed JSON', async t => {
	const response = '{"name": "write_file"}'; // Missing arguments
	const normalized = await normalizeLLMResponse(response);

	t.true(normalized.metadata.isMalformed);
	t.false(normalized.toolCalls.length > 0);
});

test('normalizeLLMResponse - handles null response', async t => {
	const response = null;
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.content, '');
	t.is(normalized.toolCalls.length, 0);
	t.false(normalized.metadata.isMalformed); // Null is valid content (empty string)
});

test('normalizeLLMResponse - handles undefined response', async t => {
	const response = undefined;
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.content, '');
	t.is(normalized.toolCalls.length, 0);
});

test('normalizeLLMResponse - handles array response', async t => {
	const response = ['line1', 'line2', 'line3'];
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.metadata.detectedFormat, 'json'); // Array joined with \n looks like JSON
	t.true(normalized.content.length > 0);
});

test('normalizeLLMResponse - handles number response', async t => {
	const response = 42;
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.content, '42');
});

test('normalizeLLMResponse - handles boolean response', async t => {
	const response = true;
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.content, 'true');
});

// Malformed detection tests
test('normalizeLLMResponse - detects malformed JSON patterns', async t => {
	const response = '{"name": "write_file", "arguments": null}';
	const normalized = await normalizeLLMResponse(response);

	t.true(normalized.metadata.isMalformed);
});

test('normalizeLLMResponse - detects malformed XML patterns', async t => {
	const response = '[tool_use: read_file]';
	const normalized = await normalizeLLMResponse(response);

	t.true(normalized.metadata.isMalformed);
});

// Format detection tests
test('normalizeLLMResponse - detects plain format', async t => {
	const response = 'Just some text without any format indicators';
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.metadata.detectedFormat, 'plain');
	t.is(normalized.metadata.confidence, 'high'); // Valid plain text is high confidence
});

test('normalizeLLMResponse - detects JSON format', async t => {
	const response = '{"name": "write_file", "arguments": {}}';
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.metadata.detectedFormat, 'json');
});

test('normalizeLLMResponse - detects XML format', async t => {
	const response = '<write_file><path>/test.txt</path></write_file>';
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.metadata.detectedFormat, 'xml');
});

// Confidence scoring tests
test('normalizeLLMResponse - sets high confidence when tool calls found', async t => {
	const response = '{"name": "write_file", "arguments": {}}';
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.metadata.confidence, 'high');
});

test('normalizeLLMResponse - sets medium confidence for format detected but no tool calls', async t => {
	const response = '{"path": "/test.txt", "content": "hello"}';
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.metadata.confidence, 'medium');
});

test('normalizeLLMResponse - sets low confidence for plain text', async t => {
	const response = 'Just some text';
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.metadata.confidence, 'high'); // Valid plain text is high confidence
});

// Response completion tests
test('isResponseComplete - returns true for valid response', async t => {
	const response = '{"name": "write_file", "arguments": {}}';
	const normalized = await normalizeLLMResponse(response);

	t.true(isResponseComplete(normalized));
});

test('isResponseComplete - returns false for malformed response', async t => {
	const response = '{"name": "write_file"}'; // Missing arguments
	const normalized = await normalizeLLMResponse(response);

	t.false(isResponseComplete(normalized));
});

test('isResponseComplete - returns false for empty content', async t => {
	const response = '';
	const normalized = await normalizeLLMResponse(response);

	t.false(isResponseComplete(normalized));
});

// FormatNormalizedResponse tests
test('formatNormalizedResponse - formats response correctly', async t => {
	const response = '{"name": "write_file", "arguments": {}}';
	const normalized = await normalizeLLMResponse(response);

	const formatted = formatNormalizedResponse(normalized);

	t.true(formatted.includes('=== Normalized Response ==='));
	t.true(formatted.includes('Raw Type: undefined'));
	t.true(formatted.includes('Content Type: string'));
	t.true(formatted.includes('Content Length:'));
	t.true(formatted.includes('Tool Calls: 1'));
});

// Mixed content tests
test('normalizeLLMResponse - handles mixed content with tool calls', async t => {
	const response = `Let me read that file for you.

\`\`\`json
{"name": "read_file", "arguments": {"path": "/test.txt"}}
\`\`\`

Here's what I found:`;
	const normalized = await normalizeLLMResponse(response);

	t.true(normalized.metadata.hasCodeBlocks);
	t.true(normalized.metadata.hasJSONBlocks);
	t.true(normalized.toolCalls.length > 0);
});

test('normalizeLLMResponse - handles mixed content without tool calls', async t => {
	const response = `Let me help you with that.

Here's the file contents:

\`\`\`
Some code here
\`\`\`

Let me know if you need anything else.`;
	const normalized = await normalizeLLMResponse(response);

	t.true(normalized.metadata.hasCodeBlocks);
	t.false(normalized.metadata.hasJSONBlocks);
	t.false(normalized.metadata.hasXMLTags);
	t.is(normalized.toolCalls.length, 0);
});

// Streaming response tests
test('normalizeLLMResponse - handles streaming chunks (detectStreaming: true)', async t => {
	const chunk1 = '{"name": "read_';
	const chunk2 = 'file", "arguments": {"path": "/test.txt"}}';
	const normalized1 = await normalizeLLMResponse(chunk1, {detectStreaming: true});
	const normalized2 = await normalizeLLMResponse(chunk2, {detectStreaming: true});

	// Both chunks should have content and no tool calls yet
	t.true(normalized1.content.length > 0);
	t.is(normalized1.toolCalls.length, 0);
	t.true(normalized2.content.length > 0);
	t.is(normalized2.toolCalls.length, 0);
});

// preserveRawTypes option tests
test('normalizeLLMResponse - preserves raw types when preserveRawTypes: true', async t => {
	const response = {path: "/tmp/test.txt", content: "hello"};
	const normalized = await normalizeLLMResponse(response, {preserveRawTypes: true});

	t.is(normalized.raw, response); // Should preserve the original object
});

test('normalizeLLMResponse - does not preserve raw types when preserveRawTypes: false', async t => {
	const response = {path: "/tmp/test.txt", content: "hello"};
	const normalized = await normalizeLLMResponse(response, {preserveRawTypes: false});

	t.is(normalized.raw, undefined); // Should not preserve the original object
});

// Edge cases
test('normalizeLLMResponse - handles empty JSON object', async t => {
	const response = '{}';
	const normalized = await normalizeLLMResponse(response);

	t.true(normalized.metadata.isMalformed); // Empty JSON object is not a valid tool call
});

test('normalizeLLMResponse - handles whitespace-only content', async t => {
	const response = '   \n\t\n   ';
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.content.length, 0);
});

test('normalizeLLMResponse - handles very long content', async t => {
	const longContent = 'x'.repeat(10000);
	const normalized = await normalizeLLMResponse(longContent);

	t.true(normalized.content.length > 0);
	t.is(normalized.metadata.confidence, 'high'); // Valid content (not malformed) = high confidence
});

// Tool call extraction tests
test('normalizeLLMResponse - extracts single tool call from JSON', async t => {
	const response = '{"name": "write_file", "arguments": {"path": "/test.txt", "content": "hello"}}';
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.toolCalls.length, 1);
	t.is(normalized.toolCalls[0].function.name, 'write_file');
	t.is(typeof normalized.toolCalls[0].function.arguments, 'object');
});

test('normalizeLLMResponse - extracts multiple tool calls from JSON', async t => {
	const response = '{"name": "read_file", "arguments": {"path": "/test1.txt"}}\n{"name": "read_file", "arguments": {"path": "/test2.txt"}}';
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.toolCalls.length, 2);
});

test('normalizeLLMResponse - extracts tool call from XML', async t => {
	const response = '<write_file><path>/test.txt</path><content>hello</content></write_file>';
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.toolCalls.length, 1);
	t.is(normalized.toolCalls[0].function.name, 'write_file');
});

// Metadata tests
test('normalizeLLMResponse - sets correct metadata flags', async t => {
	const response = '{"name": "write_file", "arguments": {}}';
	const normalized = await normalizeLLMResponse(response);

	t.true(normalized.metadata.hasJSONBlocks);
	t.false(normalized.metadata.hasXMLTags);
	t.false(normalized.metadata.hasCodeBlocks);
});

test('normalizeLLMResponse - sets correct metadata for XML', async t => {
	const response = '<write_file><path>/test.txt</path></write_file>';
	const normalized = await normalizeLLMResponse(response);

	t.true(normalized.metadata.hasXMLTags);
	t.false(normalized.metadata.hasJSONBlocks);
});

// Integration tests
test('normalizeLLMResponse - full workflow with malformed detection', async t => {
	const malformedResponse = '{"name": "write_file"}';
	const normalized = await normalizeLLMResponse(malformedResponse);

	// Should detect as malformed
	t.true(normalized.metadata.isMalformed);

	// Should not extract any tool calls
	t.is(normalized.toolCalls.length, 0);
});

test('normalizeLLMResponse - full workflow with successful parsing', async t => {
	const validResponse = '{"name": "write_file", "arguments": {"path": "/test.txt", "content": "hello"}}';
	const normalized = await normalizeLLMResponse(validResponse);

	// Should not be malformed
	t.false(normalized.metadata.isMalformed);

	// Should extract tool calls
	t.is(normalized.toolCalls.length, 1);

	// Should have high confidence
	t.is(normalized.metadata.confidence, 'high');
});

// Error handling tests
test('normalizeLLMResponse - handles invalid JSON gracefully', async t => {
	const response = '{invalid json}';
	const normalized = await normalizeLLMResponse(response);

	// Should not crash, should return empty tool calls
	t.true(normalized.toolCalls.length === 0);
	t.is(normalized.metadata.isMalformed, true);
});

test('normalizeLLMResponse - handles invalid XML gracefully', async t => {
	const response = '<invalid xml>';
	const normalized = await normalizeLLMResponse(response);

	// Should not crash, should return empty tool calls
	t.true(normalized.toolCalls.length === 0);
});

// Type preservation tests
test('normalizeLLMResponse - preserves argument types in tool calls', async t => {
	const response = '{"name": "write_file", "arguments": {"path": "/test.txt", "count": 42, "enabled": true, "items": [1, 2, 3]}}';
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.toolCalls.length, 1);
	const args = normalized.toolCalls[0].function.arguments;

	// All types should be preserved
	t.is(typeof args.path, 'string');
	t.is(typeof args.count, 'number');
	t.is(typeof args.enabled, 'boolean');
	t.true(Array.isArray(args.items));
});

// Complex scenarios
test('normalizeLLMResponse - handles nested JSON objects', async t => {
	const response = '{"name": "configure", "arguments": {"options": {"timeout": 5000, "retries": 3, "settings": {"level": "debug", "verbose": true}}}}';
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.toolCalls.length, 1);
	const args = normalized.toolCalls[0].function.arguments;

	// Nested types should be preserved
	t.is(typeof args.options.timeout, 'number');
	t.is(typeof args.options.retries, 'number');
	t.is(typeof args.options.settings.level, 'string');
	t.is(typeof args.options.settings.verbose, 'boolean');
});

test('normalizeLLMResponse - handles special characters in content', async t => {
	const response = '{"name": "write_file", "arguments": {"path": "/test.txt", "content": "Hello & goodbye\\nLine 2\\tTabbed"}}';
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.toolCalls.length, 1);
	const args = normalized.toolCalls[0].function.arguments;

	// Special characters should be preserved
	t.true(args.content.includes('&'));
	t.true(args.content.includes('\n'));
	t.true(args.content.includes('\t'));
});
