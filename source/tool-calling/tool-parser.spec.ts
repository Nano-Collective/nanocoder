import test from 'ava';
import {parseToolCalls} from './tool-parser';

console.log(`\ntool-parser.spec.ts`);

// XML Parser Tests

test('parseToolCalls: successfully parses valid XML tool call', t => {
	const content = `
<read_file>
  <path>/path/to/file.txt</path>
</read_file>
  `;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.is(result.toolCalls[0].function.name, 'read_file');
		t.deepEqual(result.toolCalls[0].function.arguments, {
			path: '/path/to/file.txt',
		});
	}
});

test('parseToolCalls: detects malformed mixed function/parameter syntax (non-JSON body)', t => {
	// The outer <function=name> body is XML, not JSON, so the function-tag
	// parser skips it. The inner <parameter=name> still triggers the
	// malformed-XML detector — preserves the existing self-correction loop
	// for models that produce this incomplete shape.
	const content = `
<function=read_file>
  <parameter=path>/path/to/file.txt</parameter>
</function>

I want to read the file at /path/to/file.txt
  `;

	const result = parseToolCalls(content);

	t.false(result.success);
	if (!result.success) {
		t.regex(result.error, /Invalid syntax/i);
		t.regex(result.examples, /native tool calling/i);
	}
});

test('parseToolCalls: handles multiple valid XML tool calls', t => {
	const content = `
<read_file>
  <path>/path/to/file1.txt</path>
</read_file>

<create_file>
  <path>/path/to/file2.txt</path>
  <content>Hello world</content>
</create_file>
  `;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 2);
		t.is(result.toolCalls[0].function.name, 'read_file');
		t.is(result.toolCalls[1].function.name, 'create_file');
	}
});

test('parseToolCalls: cleans XML tool calls from content', t => {
	const content = `
Here is some text before the tool call.

<read_file>
  <path>/path/to/file.txt</path>
</read_file>

And some text after.
  `;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.regex(result.cleanedContent, /Here is some text before/);
		t.regex(result.cleanedContent, /And some text after/);
		t.notRegex(result.cleanedContent, /<read_file>/);
	}
});

// Edge Cases

test('parseToolCalls: handles empty content', t => {
	const result = parseToolCalls('');

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 0);
		t.is(result.cleanedContent, '');
	}
});

test('parseToolCalls: handles content with no tool calls', t => {
	const content = 'Just some plain text without any tool calls.';

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 0);
		t.is(result.cleanedContent, content);
	}
});

test('parseToolCalls: handles empty JSON object', t => {
	const content = '{}';

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 0);
	}
});

test('parseToolCalls: preserves identical XML tool calls (no deduplication)', t => {
	const content = `
<read_file>
  <path>/path/to/file.txt</path>
</read_file>

<read_file>
  <path>/path/to/file.txt</path>
</read_file>
  `;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		// No deduplication - both calls preserved
		t.is(result.toolCalls.length, 2);
	}
});

// Think Tag Tests (models like GLM-4 emit these for chain-of-thought)

test('parseToolCalls: strips complete <think>...</think> tags', t => {
	const content = `<think>
Let me think about this...
I should read the file first.
</think>

Here is my response to your question.`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 0);
		t.notRegex(result.cleanedContent, /<think>/);
		t.notRegex(result.cleanedContent, /<\/think>/);
		t.regex(result.cleanedContent, /Here is my response/);
	}
});

test('parseToolCalls: strips orphaned closing </think> tags', t => {
	const content = `</think>

Here is my response after some thinking.`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.notRegex(result.cleanedContent, /<\/think>/);
		t.regex(result.cleanedContent, /Here is my response/);
	}
});

test('parseToolCalls: strips incomplete opening <think> tags (streaming)', t => {
	const content = `Here is my response.

<think>
I'm still thinking about this...`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.notRegex(result.cleanedContent, /<think>/);
		t.regex(result.cleanedContent, /Here is my response/);
		// The incomplete thinking content should be removed
		t.notRegex(result.cleanedContent, /still thinking/);
	}
});

test('parseToolCalls: handles think tags with tool calls', t => {
	const content = `<think>
Let me analyze this request...
I'll need to read the file first.
</think>

<read_file>
  <path>/path/to/file.txt</path>
</read_file>`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.is(result.toolCalls[0].function.name, 'read_file');
		t.notRegex(result.cleanedContent, /<think>/);
		t.notRegex(result.cleanedContent, /<\/think>/);
	}
});

test('parseToolCalls: handles case-insensitive think tags', t => {
	const content = `<THINK>
Some thinking...
</THINK>

<Think>
More thinking...
</Think>

The actual response.`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.notRegex(result.cleanedContent, /<think>/i);
		t.notRegex(result.cleanedContent, /<\/think>/i);
		t.regex(result.cleanedContent, /The actual response/);
	}
});

// Llama 3.x Function-Tag Tests (<function=name>{json}</function>)

test('parseToolCalls: parses Llama 3.x <function=name>{json}</function> tool call', t => {
	const content = `<function=read_file>{"path": "/etc/hosts"}</function>`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.is(result.toolCalls[0].function.name, 'read_file');
		t.deepEqual(result.toolCalls[0].function.arguments, {
			path: '/etc/hosts',
		});
	}
});

test('parseToolCalls: cleans Llama function tags from surrounding prose', t => {
	const content = `Reading the file now.

<function=read_file>{"path": "/x"}</function>

Done.`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.regex(result.cleanedContent, /Reading the file now/);
		t.regex(result.cleanedContent, /Done\./);
		t.notRegex(result.cleanedContent, /<function=/);
		t.notRegex(result.cleanedContent, /<\/function>/);
	}
});

test('parseToolCalls: parses multiple Llama function tags', t => {
	const content = `<function=read_file>{"path": "/a"}</function>\n<function=read_file>{"path": "/b"}</function>`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 2);
		t.is(result.toolCalls[0].function.name, 'read_file');
		t.is(result.toolCalls[1].function.name, 'read_file');
	}
});

test('parseToolCalls: skips Llama function tag with non-JSON body', t => {
	// Body is plain text, not JSON — must not be treated as a tool call.
	const content = `<function=read_file>just some prose here</function>`;

	const result = parseToolCalls(content);

	// Function-tag parser skips it; XML parser doesn't match either; JSON
	// fallback finds nothing. Result should be no tool calls (success: true).
	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 0);
	}
});

// JSON Fallback Tests (open-weights models that emit JSON-shaped tool calls)

test('parseToolCalls: parses fenced ```json tool call', t => {
	const content = `Here you go:

\`\`\`json
{"name": "read_file", "arguments": {"path": "/etc/hosts"}}
\`\`\`
`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.is(result.toolCalls[0].function.name, 'read_file');
		t.deepEqual(result.toolCalls[0].function.arguments, {
			path: '/etc/hosts',
		});
		t.notRegex(result.cleanedContent, /```/);
		t.regex(result.cleanedContent, /Here you go/);
	}
});

test('parseToolCalls: parses fenced code block without language hint', t => {
	const content = `\`\`\`
{"name": "create_file", "arguments": {"path": "/tmp/x", "content": "hi"}}
\`\`\``;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.is(result.toolCalls[0].function.name, 'create_file');
	}
});

test('parseToolCalls: parses bare inline JSON tool call', t => {
	const content = `{"name": "read_file", "arguments": {"path": "/file.txt"}}`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.is(result.toolCalls[0].function.name, 'read_file');
		t.deepEqual(result.toolCalls[0].function.arguments, {
			path: '/file.txt',
		});
	}
});

test('parseToolCalls: parses multiple JSON tool calls', t => {
	const content = `
\`\`\`json
{"name": "read_file", "arguments": {"path": "/a.txt"}}
\`\`\`

\`\`\`json
{"name": "read_file", "arguments": {"path": "/b.txt"}}
\`\`\`
`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 2);
		t.is(result.toolCalls[0].function.name, 'read_file');
		t.is(result.toolCalls[1].function.name, 'read_file');
	}
});

test('parseToolCalls: detects malformed JSON with string arguments', t => {
	const content = `{"name": "read_file", "arguments": "/file.txt"}`;

	const result = parseToolCalls(content);

	t.false(result.success);
	if (!result.success) {
		t.regex(result.error, /"arguments" must be an object/i);
		t.regex(result.examples, /native tool calling/i);
	}
});

test('parseToolCalls: detects malformed JSON with missing arguments field', t => {
	const content = `{"name": "read_file"}`;

	const result = parseToolCalls(content);

	t.false(result.success);
	if (!result.success) {
		t.regex(result.error, /missing "arguments" field/i);
		t.regex(result.examples, /native tool calling/i);
	}
});

test('parseToolCalls: detects malformed JSON with missing name field', t => {
	const content = `{"arguments": {"path": "/file.txt"}}`;

	const result = parseToolCalls(content);

	t.false(result.success);
	if (!result.success) {
		t.regex(result.error, /missing "name" field/i);
		t.regex(result.examples, /native tool calling/i);
	}
});

test('parseToolCalls: prefers XML when XML is unambiguous and JSON is inline', t => {
	const content = `<read_file>
  <path>/from-xml.txt</path>
</read_file>

Also tried: {"name": "read_file", "arguments": {"path": "/from-json.txt"}}`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.deepEqual(result.toolCalls[0].function.arguments, {
			path: '/from-xml.txt',
		});
	}
});

test('parseToolCalls: does not double-count fenced + inline overlap', t => {
	const content = `\`\`\`json
{"name": "read_file", "arguments": {"path": "/x.txt"}}
\`\`\``;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
	}
});

test('parseToolCalls: leaves plain prose alone when JSON-shaped text is just discussion', t => {
	const content = `The user asked about {"name": "read_file"} but I should not call it.`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 0);
	}
});
