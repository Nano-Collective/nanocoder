import test from 'ava';
import {XMLToolCallParser} from './xml-parser';

console.log(`\nxml-parser.spec.ts`);

// Basic parsing tests
test('parseToolCalls - parses simple tool call', t => {
	const content = '<read_file><path>/test/file.txt</path></read_file>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 1);
	t.is(result[0].toolName, 'read_file');
	t.deepEqual(result[0].parameters, {path: '/test/file.txt'});
});

test('parseToolCalls - parses multiple parameters', t => {
	const content =
		'<create_file><path>/test/new.txt</path><content>Hello World</content><mode>0644</mode></create_file>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 1);
	t.is(result[0].toolName, 'create_file');
	t.deepEqual(result[0].parameters, {
		path: '/test/new.txt',
		content: 'Hello World',
		mode: '0644',
	});
});

test('parseToolCalls - parses multiple tool calls', t => {
	const content = `<read_file><path>/test/file1.txt</path></read_file>
<read_file><path>/test/file2.txt</path></read_file>`;
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 2);
	t.is(result[0].toolName, 'read_file');
	t.deepEqual(result[0].parameters, {path: '/test/file1.txt'});
	t.is(result[1].toolName, 'read_file');
	t.deepEqual(result[1].parameters, {path: '/test/file2.txt'});
});

test('parseToolCalls - handles empty parameters', t => {
	const content = '<list_files></list_files>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 1);
	t.is(result[0].toolName, 'list_files');
	t.deepEqual(result[0].parameters, {});
});

test('parseToolCalls - handles empty parameter values', t => {
	const content = '<search><query></query><path>/test</path></search>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 1);
	t.is(result[0].toolName, 'search');
	t.deepEqual(result[0].parameters, {query: '', path: '/test'});
});

// JSON parameter tests
test('parseToolCalls - parses JSON array parameters', t => {
	const content =
		'<batch_read><files>["file1.txt", "file2.txt", "file3.txt"]</files></batch_read>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 1);
	t.is(result[0].toolName, 'batch_read');
	t.deepEqual(result[0].parameters, {
		files: ['file1.txt', 'file2.txt', 'file3.txt'],
	});
});

test('parseToolCalls - parses JSON object parameters', t => {
	const content =
		'<configure><options>{"timeout": 5000, "retries": 3}</options></configure>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 1);
	t.is(result[0].toolName, 'configure');
	t.deepEqual(result[0].parameters, {
		options: {timeout: 5000, retries: 3},
	});
});

test('parseToolCalls - parses JSON boolean parameters', t => {
	const content =
		'<set_flag><enabled>true</enabled><verbose>false</verbose></set_flag>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 1);
	t.is(result[0].toolName, 'set_flag');
	t.deepEqual(result[0].parameters, {enabled: true, verbose: false});
});

test('parseToolCalls - parses JSON number parameters', t => {
	const content = '<calculate><x>42</x><y>3.14</y><z>-10</z></calculate>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 1);
	t.is(result[0].toolName, 'calculate');
	t.deepEqual(result[0].parameters, {x: 42, y: 3.14, z: -10});
});

test('parseToolCalls - treats invalid JSON as string', t => {
	const content = '<test><invalid>{not valid json}</invalid></test>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 1);
	t.is(result[0].toolName, 'test');
	t.deepEqual(result[0].parameters, {invalid: '{not valid json}'});
});

// Markdown code block tests
test('parseToolCalls - extracts tool calls from markdown code blocks', t => {
	const content =
		'```xml\n<read_file><path>/test/file.txt</path></read_file>\n```';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 1);
	t.is(result[0].toolName, 'read_file');
	t.deepEqual(result[0].parameters, {path: '/test/file.txt'});
});

test('parseToolCalls - handles code blocks without language identifier', t => {
	const content =
		'```\n<read_file><path>/test/file.txt</path></read_file>\n```';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 1);
	t.is(result[0].toolName, 'read_file');
	t.deepEqual(result[0].parameters, {path: '/test/file.txt'});
});

test('parseToolCalls - handles code blocks with various languages', t => {
	const content =
		'```typescript\n<read_file><path>/test/file.txt</path></read_file>\n```';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 1);
	t.is(result[0].toolName, 'read_file');
});

// tool_call wrapper tests
test('parseToolCalls - removes tool_call wrapper tags', t => {
	const content =
		'<tool_call><read_file><path>/test/file.txt</path></read_file></tool_call>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 1);
	t.is(result[0].toolName, 'read_file');
	t.deepEqual(result[0].parameters, {path: '/test/file.txt'});
});

test('parseToolCalls - skips tool_call tags when found as top-level match', t => {
	const content =
		'<tool_call><read_file><path>/test/file.txt</path></read_file></tool_call>';
	const result = XMLToolCallParser.parseToolCalls(content);

	// Should parse read_file, not tool_call
	t.is(result.length, 1);
	t.is(result[0].toolName, 'read_file');
});

// Special characters and content tests
test('parseToolCalls - handles multiline content', t => {
	const content = `<create_file>
		<path>/test/file.txt</path>
		<content>Line 1
Line 2
Line 3</content>
	</create_file>`;
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 1);
	t.is(result[0].toolName, 'create_file');
	t.is(result[0].parameters.path, '/test/file.txt');
	t.is(result[0].parameters.content, 'Line 1\nLine 2\nLine 3');
});

test('parseToolCalls - handles special characters in content', t => {
	const content =
		'<execute_bash><command>echo "Hello & goodbye" | grep -v "test"</command></execute_bash>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 1);
	t.is(result[0].toolName, 'execute_bash');
	t.deepEqual(result[0].parameters, {
		command: 'echo "Hello & goodbye" | grep -v "test"',
	});
});

test('parseToolCalls - handles XML-like content in parameters', t => {
	const content =
		'<create_file><content><div>HTML content</div></content></create_file>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 1);
	t.is(result[0].toolName, 'create_file');
	// Should capture the innermost match first
	t.truthy(result[0].parameters.content);
});

test('parseToolCalls - handles escaped characters', t => {
	const content = '<test><value>&lt;tag&gt;</value></test>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 1);
	t.is(result[0].toolName, 'test');
	t.deepEqual(result[0].parameters, {value: '&lt;tag&gt;'});
});

// Edge cases
test('parseToolCalls - returns empty array for no tool calls', t => {
	const content = 'Just some regular text without any tool calls';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.deepEqual(result, []);
});

test('parseToolCalls - handles empty string', t => {
	const content = '';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.deepEqual(result, []);
});

test('parseToolCalls - handles whitespace-only content', t => {
	const content = '   \n\t\n   ';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.deepEqual(result, []);
});

test('parseToolCalls - handles unclosed tags gracefully', t => {
	const content = '<read_file><path>/test/file.txt</path>';
	const result = XMLToolCallParser.parseToolCalls(content);

	// Should not match incomplete XML
	t.deepEqual(result, []);
});

test('parseToolCalls - handles mismatched tags gracefully', t => {
	const content = '<read_file><path>/test/file.txt</wrong_close></read_file>';
	const result = XMLToolCallParser.parseToolCalls(content);

	// Regex should still match the outer tags
	t.is(result.length, 1);
	t.is(result[0].toolName, 'read_file');
});

test('parseToolCalls - handles nested tool names', t => {
	// Parameters can have same name as parent tool
	const content = '<read_file><read_file>nested_value</read_file></read_file>';
	const result = XMLToolCallParser.parseToolCalls(content);

	// Should parse the outer read_file
	t.truthy(result.length > 0);
});

test('parseToolCalls - handles tool names with underscores and numbers', t => {
	const content = '<tool_name_123><param_1>value</param_1></tool_name_123>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 1);
	t.is(result[0].toolName, 'tool_name_123');
	t.deepEqual(result[0].parameters, {param_1: 'value'});
});

test('parseToolCalls - handles case sensitivity', t => {
	const content = '<ReadFile><Path>/test/file.txt</Path></ReadFile>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 1);
	t.is(result[0].toolName, 'ReadFile');
	t.deepEqual(result[0].parameters, {Path: '/test/file.txt'});
});

// convertToToolCalls tests
test('convertToToolCalls - converts parsed calls to ToolCall format', t => {
	const parsed = [
		{toolName: 'read_file', parameters: {path: '/test/file.txt'}},
		{toolName: 'create_file', parameters: {path: '/new.txt', content: 'test'}},
	];

	const result = XMLToolCallParser.convertToToolCalls(parsed);

	t.is(result.length, 2);
	t.is(result[0].id, 'xml_call_0');
	t.is(result[0].function.name, 'read_file');
	t.deepEqual(result[0].function.arguments, {path: '/test/file.txt'});
	t.is(result[1].id, 'xml_call_1');
	t.is(result[1].function.name, 'create_file');
	t.deepEqual(result[1].function.arguments, {
		path: '/new.txt',
		content: 'test',
	});
});

test('convertToToolCalls - generates unique IDs', t => {
	const parsed = [
		{toolName: 'tool1', parameters: {}},
		{toolName: 'tool2', parameters: {}},
		{toolName: 'tool3', parameters: {}},
	];

	const result = XMLToolCallParser.convertToToolCalls(parsed);

	const ids = result.map(call => call.id);
	const uniqueIds = new Set(ids);
	t.is(ids.length, uniqueIds.size);
});

// removeToolCallsFromContent tests
test('removeToolCallsFromContent - removes tool calls from plain text', t => {
	const content = `Here is some text
<read_file><path>/test/file.txt</path></read_file>
And some more text`;

	const result = XMLToolCallParser.removeToolCallsFromContent(content);

	t.is(result, 'Here is some text\n\nAnd some more text');
});

test('removeToolCallsFromContent - removes code blocks containing tool calls', t => {
	const content = `Some text
\`\`\`xml
<read_file><path>/test/file.txt</path></read_file>
\`\`\`
More text`;

	const result = XMLToolCallParser.removeToolCallsFromContent(content);

	t.is(result, 'Some text\n\nMore text');
});

test('removeToolCallsFromContent - keeps code blocks without tool calls', t => {
	const content = `Some text
\`\`\`javascript
const x = 42;
\`\`\`
More text`;

	const result = XMLToolCallParser.removeToolCallsFromContent(content);

	t.true(result.includes('const x = 42;'));
});

test('removeToolCallsFromContent - removes multiple tool calls', t => {
	const content = `Text
<read_file><path>/file1.txt</path></read_file>
Middle text
<read_file><path>/file2.txt</path></read_file>
End text`;

	const result = XMLToolCallParser.removeToolCallsFromContent(content);

	t.false(result.includes('<read_file>'));
	t.true(result.includes('Text'));
	t.true(result.includes('Middle text'));
	t.true(result.includes('End text'));
});

test('removeToolCallsFromContent - removes tool_call wrappers', t => {
	const content = `Text
<tool_call><read_file><path>/test.txt</path></read_file></tool_call>
More text`;

	const result = XMLToolCallParser.removeToolCallsFromContent(content);

	t.false(result.includes('<tool_call>'));
	t.false(result.includes('<read_file>'));
	t.true(result.includes('Text'));
});

test('removeToolCallsFromContent - cleans up excessive whitespace', t => {
	const content = `Line 1


<read_file><path>/test.txt</path></read_file>


Line 2`;

	const result = XMLToolCallParser.removeToolCallsFromContent(content);

	// Should reduce multiple newlines to double newlines
	t.false(result.includes('\n\n\n'));
});

test('removeToolCallsFromContent - handles empty content', t => {
	const content = '';
	const result = XMLToolCallParser.removeToolCallsFromContent(content);

	t.is(result, '');
});

test('removeToolCallsFromContent - handles content with only tool calls', t => {
	const content = '<read_file><path>/test.txt</path></read_file>';
	const result = XMLToolCallParser.removeToolCallsFromContent(content);

	t.is(result, '');
});

// hasToolCalls tests
test('hasToolCalls - returns true for content with tool calls', t => {
	const content = '<read_file><path>/test/file.txt</path></read_file>';
	const result = XMLToolCallParser.hasToolCalls(content);

	t.true(result);
});

test('hasToolCalls - returns true for tool calls in code blocks', t => {
	const content =
		'```\n<read_file><path>/test/file.txt</path></read_file>\n```';
	const result = XMLToolCallParser.hasToolCalls(content);

	t.true(result);
});

test('hasToolCalls - returns false for plain text', t => {
	const content = 'Just some regular text';
	const result = XMLToolCallParser.hasToolCalls(content);

	t.false(result);
});

test('hasToolCalls - returns false for empty string', t => {
	const content = '';
	const result = XMLToolCallParser.hasToolCalls(content);

	t.false(result);
});

test('hasToolCalls - returns false for incomplete XML', t => {
	const content = '<read_file><path>/test';
	const result = XMLToolCallParser.hasToolCalls(content);

	t.false(result);
});

// detectMalformedToolCall tests
test('detectMalformedToolCall - detects [tool_use: name] syntax', t => {
	const content = '[tool_use: read_file]';
	const result = XMLToolCallParser.detectMalformedToolCall(content);

	t.truthy(result);
	t.true(result!.error.includes('[tool_use: name]'));
	t.true(result!.examples.includes('native tool calling'));
});

test('detectMalformedToolCall - detects [Tool: name] syntax', t => {
	const content = '[Tool: read_file]';
	const result = XMLToolCallParser.detectMalformedToolCall(content);

	t.truthy(result);
	t.true(result!.error.includes('[tool_use: name]'));
	t.true(result!.examples.includes('native tool calling'));
});

test('detectMalformedToolCall - detects [Tool: name] in context', t => {
	const content =
		'Let me read the file for you.\n\n[Tool: read_file]\nThe file contains...';
	const result = XMLToolCallParser.detectMalformedToolCall(content);

	t.truthy(result);
	t.true(result!.error.includes('[tool_use: name]'));
});

test('detectMalformedToolCall - detects <function=name> syntax', t => {
	const content = '<function=read_file><path>/test.txt</path></function>';
	const result = XMLToolCallParser.detectMalformedToolCall(content);

	t.truthy(result);
	t.true(result!.error.includes('<function=name>'));
	t.true(result!.examples.includes('native tool calling'));
});

test('detectMalformedToolCall - detects <parameter=name> syntax', t => {
	const content =
		'<read_file><parameter=path>/test.txt</parameter></read_file>';
	const result = XMLToolCallParser.detectMalformedToolCall(content);

	t.truthy(result);
	t.true(result!.error.includes('<parameter=name>'));
});

test('detectMalformedToolCall - detects generic </parameter> closing tag', t => {
	const content =
		'<read_file><parameter=path>/test.txt</parameter></read_file>';
	const result = XMLToolCallParser.detectMalformedToolCall(content);

	t.truthy(result);
	t.truthy(result!.error);
});

test('detectMalformedToolCall - detects generic </function> closing tag', t => {
	const content = '<function=read_file><path>/test.txt</path></function>';
	const result = XMLToolCallParser.detectMalformedToolCall(content);

	t.truthy(result);
	t.truthy(result!.error);
});

test('detectMalformedToolCall - returns null for valid XML', t => {
	const content = '<read_file><path>/test.txt</path></read_file>';
	const result = XMLToolCallParser.detectMalformedToolCall(content);

	t.is(result, null);
});

test('detectMalformedToolCall - returns null for plain text', t => {
	const content = 'Just regular text';
	const result = XMLToolCallParser.detectMalformedToolCall(content);

	t.is(result, null);
});

test('detectMalformedToolCall - includes helpful examples in error', t => {
	const content = '<function=test><param>value</param></function>';
	const result = XMLToolCallParser.detectMalformedToolCall(content);

	t.truthy(result);
	t.true(result!.examples.includes('native tool calling'));
	t.true(result!.examples.includes('function calling interface'));
});

// Complex integration tests
test('full workflow - parse, convert, and extract multiple tool calls', t => {
	const content = `Let me help you with that.

\`\`\`xml
<read_file><path>/src/app.ts</path></read_file>
<read_file><path>/src/config.ts</path></read_file>
\`\`\`

I'll read those files for you.`;

	// Check detection
	t.true(XMLToolCallParser.hasToolCalls(content));

	// Parse
	const parsed = XMLToolCallParser.parseToolCalls(content);
	t.is(parsed.length, 2);

	// Convert
	const toolCalls = XMLToolCallParser.convertToToolCalls(parsed);
	t.is(toolCalls.length, 2);
	t.is(toolCalls[0].function.name, 'read_file');
	t.is(toolCalls[1].function.name, 'read_file');

	// Remove from content
	const cleaned = XMLToolCallParser.removeToolCallsFromContent(content);
	t.false(cleaned.includes('<read_file>'));
	t.true(cleaned.includes('Let me help you'));
	t.true(cleaned.includes("I'll read those files"));
});

test('full workflow - handles mixed content with malformed detection', t => {
	const malformedContent = '<function=test><param>value</param></function>';

	// Should detect malformation
	const malformed = XMLToolCallParser.detectMalformedToolCall(malformedContent);
	t.truthy(malformed);

	// Should not parse as valid tool calls
	const parsed = XMLToolCallParser.parseToolCalls(malformedContent);
	t.is(parsed.length, 0);

	// Should not be detected as having tool calls
	t.false(XMLToolCallParser.hasToolCalls(malformedContent));
});

test('stress test - handles large number of tool calls', t => {
	const toolCalls = Array.from(
		{length: 100},
		(_, i) => `<read_file><path>/file${i}.txt</path></read_file>`,
	).join('\n');

	const parsed = XMLToolCallParser.parseToolCalls(toolCalls);
	t.is(parsed.length, 100);

	const converted = XMLToolCallParser.convertToToolCalls(parsed);
	t.is(converted.length, 100);
});

test('stress test - handles deeply nested parameters', t => {
	const content =
		'<test><config>{"level1": {"level2": {"level3": {"value": 42}}}}</config></test>';
	const parsed = XMLToolCallParser.parseToolCalls(content);

	t.is(parsed.length, 1);
	t.deepEqual(parsed[0].parameters.config, {
		level1: {level2: {level3: {value: 42}}},
	});
});

test('stress test - handles very long parameter values', t => {
	const longValue = 'x'.repeat(10000);
	const content = `<test><data>${longValue}</data></test>`;
	const parsed = XMLToolCallParser.parseToolCalls(content);

	t.is(parsed.length, 1);
	t.is((parsed[0].parameters.data as string).length, 10000);
});

// HTML tag rejection tests
test('parseToolCalls - rejects HTML div tags', t => {
	const content = '<div><p>Some HTML content</p></div>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 0);
});

test('parseToolCalls - rejects HTML ul/li list tags', t => {
	const content = '<ul><li>Item 1</li><li>Item 2</li></ul>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 0);
});

test('parseToolCalls - rejects HTML table tags', t => {
	const content = '<table><tr><td>Cell 1</td><td>Cell 2</td></tr></table>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 0);
});

test('parseToolCalls - rejects HTML header tags', t => {
	const content = '<h1>Title</h1><h2>Subtitle</h2>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 0);
});

test('parseToolCalls - rejects HTML formatting tags', t => {
	const content = '<strong>Bold</strong><em>Italic</em>';
	const result = XMLToolCallParser.parseToolCalls(content);

	t.is(result.length, 0);
});

test('parseToolCalls - rejects mixed HTML and valid tool calls correctly', t => {
	const content = `<div>Some HTML</div>
<read_file><path>/test.txt</path></read_file>
<p>More HTML</p>`;
	const result = XMLToolCallParser.parseToolCalls(content);

	// Should only parse the valid tool call, not the HTML
	t.is(result.length, 1);
	t.is(result[0].toolName, 'read_file');
});

test('parseToolCalls - allows valid tool calls with HTML-like parameter content', t => {
	const content =
		'<create_file><path>/test.html</path><content><div>HTML content</div></content></create_file>';
	const result = XMLToolCallParser.parseToolCalls(content);

	// Should parse the tool call, with HTML as parameter value
	t.is(result.length, 1);
	t.is(result[0].toolName, 'create_file');
	t.truthy(result[0].parameters.content);
});
