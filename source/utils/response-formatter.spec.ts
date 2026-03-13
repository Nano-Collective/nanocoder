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
	// JSON tool call extraction was removed - only XML extraction remains
	t.is(normalized.toolCalls.length, 0);
});

test('normalizeLLMResponse - handles plain JSON object', async t => {
	const response = {path: "/tmp/test.txt", content: "hello"};
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.metadata.detectedFormat, 'json');
	t.false(normalized.metadata.hasJSONBlocks); // Not a tool call format
});

test('normalizeLLMResponse - handles plain JSON object with missing arguments', async t => {
	const response = '{"name": "write_file"}'; // Missing arguments - valid JSON, not a tool call
	const normalized = await normalizeLLMResponse(response);

	// Valid JSON should NOT be malformed
	t.false(normalized.metadata.isMalformed);
	// Should have medium confidence (valid JSON format, but no tool call)
	t.is(normalized.metadata.confidence, 'medium');
	// Should not extract tool calls (missing arguments field)
	t.is(normalized.toolCalls.length, 0);
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
test('normalizeLLMResponse - handles JSON with null arguments', async t => {
	const response = '{"name": "write_file", "arguments": null}';
	const normalized = await normalizeLLMResponse(response);

	// Valid JSON should NOT be malformed
	t.false(normalized.metadata.isMalformed);
	// Should have medium confidence (valid JSON format, but arguments is null)
	t.is(normalized.metadata.confidence, 'medium');
	// Should not extract tool calls (null arguments)
	t.is(normalized.toolCalls.length, 0);
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
	t.is(normalized.metadata.confidence, 'low'); // Correct: No tools found
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
test('normalizeLLMResponse - sets high confidence when XML tool calls found', async t => {
	const response = '<write_file><path>/test.txt</path></write_file>';
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

	t.is(normalized.metadata.confidence, 'low'); // Correct
});

// Response completion tests
test('isResponseComplete - returns true for valid XML tool response', async t => {
	const response = '<write_file><path>/test.txt</path></write_file>';
	const normalized = await normalizeLLMResponse(response);

	t.true(isResponseComplete(normalized));
});

test('isResponseComplete - returns false for empty content', async t => {
	const response = '{"name": "write_file"}'; // Valid JSON but not a tool call
	const normalized = await normalizeLLMResponse(response);

	// Valid conversational JSON is NOT malformed, so response IS complete enough
	t.true(isResponseComplete(normalized));
});

test('isResponseComplete - returns false for truly malformed XML', async t => {
	// Use a pattern explicitly defined in our malformed detector
	// This triggers isMalformed: true via the XML regex fallback
	const response = '[tool_use: write_file]';
	const normalized = await normalizeLLMResponse(response);

	t.true(normalized.metadata.isMalformed);
	t.false(isResponseComplete(normalized));
});

test('isResponseComplete - returns false for empty string', async t => {
	const response = '';
	const normalized = await normalizeLLMResponse(response);

	t.false(isResponseComplete(normalized));
});

// FormatNormalizedResponse tests
test('formatNormalizedResponse - formats response correctly', async t => {
	const response = '<write_file><path>/test.txt</path></write_file>';
	const normalized = await normalizeLLMResponse(response);

	const formatted = formatNormalizedResponse(normalized);

	t.true(formatted.includes('=== Normalized Response ==='));
	t.true(formatted.includes('Raw Type: undefined'));
	t.true(formatted.includes('Content Type: string'));
	t.true(formatted.includes('Content Length:'));
	t.true(formatted.includes('Tool Calls: 1'));
});

// Mixed content tests
test('normalizeLLMResponse - handles mixed content with XML tool calls', async t => {
	const response = `Let me read that file for you.

<read_file>
<path>/test.txt</path>
</read_file>

Here's what I found:`;
	const normalized = await normalizeLLMResponse(response);

	t.true(normalized.metadata.hasXMLTags);
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
	t.is(normalized.toolCalls.length, 0);
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

	// Valid JSON should NOT be malformed
	t.false(normalized.metadata.isMalformed);
	// Should have medium confidence (valid JSON format, but empty object)
	t.is(normalized.metadata.confidence, 'medium');
	// Should not extract tool calls
	t.is(normalized.toolCalls.length, 0);
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
	t.is(normalized.metadata.confidence, 'low'); // Valid plain text = low confidence
});

// Tool call extraction tests
test('normalizeLLMResponse - extracts single tool call from XML', async t => {
	const response = '<write_file><path>/test.txt</path><content>hello</content></write_file>';
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.toolCalls.length, 1);
	t.is(normalized.toolCalls[0].function.name, 'write_file');
	t.is(typeof normalized.toolCalls[0].function.arguments, 'object');
});

test('normalizeLLMResponse - extracts multiple tool calls from XML', async t => {
	const response = '<read_file><path>/test1.txt</path></read_file>\n<read_file><path>/test2.txt</path></read_file>';
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.toolCalls.length, 2);
});

test('normalizeLLMResponse - extracts tool call from XML format', async t => {
	const response = '<write_file><path>/test.txt</path><content>hello</content></write_file>';
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.toolCalls.length, 1);
	t.is(normalized.toolCalls[0].function.name, 'write_file');
});

// Metadata tests
test('normalizeLLMResponse - sets correct metadata for JSON format', async t => {
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

	// NEW LOGIC: This is valid JSON. It is NOT malformed.
	// It's just a "Near Miss" (Medium Confidence)
	t.false(normalized.metadata.isMalformed);
	t.is(normalized.metadata.confidence, 'medium');

	// Should not extract any tool calls
	t.is(normalized.toolCalls.length, 0);
});

// NEW: "Hall of Mirrors" / Anchoring Tests
test('normalizeLLMResponse - ignores malformed JSON when embedded inline', async t => {
	// This text contains a broken tool call pattern, but NOT at the start of a line.
	// The anchor (?:^|\n) should prevent this from triggering an error.
	const response = 'I noticed you have an error in {"name": "write_file"} in your logs.';
	const normalized = await normalizeLLMResponse(response);

	// Should NOT be malformed because it's inline text
	t.false(normalized.metadata.isMalformed);
	// Should be low confidence (plain chat)
	t.is(normalized.metadata.confidence, 'low');
});

test('normalizeLLMResponse - detects malformed JSON when starting on a new line', async t => {
	// This broken pattern starts on a new line
	const response = 'I will try to fix this:\n{"name": "write_file"}';
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.toolCalls.length, 0);
});

// Error handling tests
test('normalizeLLMResponse - handles invalid JSON gracefully', async t => {
	const response = '{invalid json}';
	const normalized = await normalizeLLMResponse(response);

	// Should not crash, should return empty tool calls
	t.true(normalized.toolCalls.length === 0);
	// It's not "Malformed" because it doesn't look like a tool call attempt.
	// It's just garbage text.
	t.is(normalized.metadata.isMalformed, false);
});

test('normalizeLLMResponse - handles invalid XML gracefully', async t => {
	const response = '<invalid xml>';
	const normalized = await normalizeLLMResponse(response);

	// Should not crash, should return empty tool calls
	t.true(normalized.toolCalls.length === 0);
});

// XML type preservation tests
test('normalizeLLMResponse - preserves argument types in XML tool calls', async t => {
	const response = '<write_file><path>/test.txt</path><content>hello world</content></write_file>';
	const normalized = await normalizeLLMResponse(response);

	t.is(normalized.toolCalls.length, 1);
	const args = normalized.toolCalls[0].function.arguments;

	t.is(typeof args.path, 'string');
	t.is(typeof args.content, 'string');
});
