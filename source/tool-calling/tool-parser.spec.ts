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

test('parseToolCalls: detects malformed XML with attribute syntax', t => {
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

// JSON Parser Tests

test('parseToolCalls: successfully parses valid JSON tool call', t => {
	const content = `
{
  "name": "read_file",
  "arguments": {
    "path": "/path/to/file.txt"
  }
}
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

test('parseToolCalls: detects malformed JSON missing arguments field', t => {
	const content = `
{
  "name": "read_file"
}
  `;

	const result = parseToolCalls(content);

	t.false(result.success);
	if (!result.success) {
		t.regex(result.error, /missing "arguments" field/i);
		t.regex(result.examples, /Correct format/i);
	}
});

test('parseToolCalls: detects malformed JSON missing name field', t => {
	const content = `
{
  "arguments": {
    "path": "/path/to/file.txt"
  }
}
  `;

	const result = parseToolCalls(content);

	t.false(result.success);
	if (!result.success) {
		t.regex(result.error, /missing "name" field/i);
		t.regex(result.examples, /Correct format/i);
	}
});

test('parseToolCalls: detects malformed JSON with string arguments', t => {
	const content = `
{
  "name": "read_file",
  "arguments": "/path/to/file.txt"
}
  `;

	const result = parseToolCalls(content);

	t.false(result.success);
	if (!result.success) {
		t.regex(result.error, /"arguments" must be an object/i);
		t.regex(result.examples, /Correct format/i);
	}
});

test('parseToolCalls: handles JSON in markdown code blocks', t => {
	const content = `
\`\`\`json
{
  "name": "read_file",
  "arguments": {
    "path": "/path/to/file.txt"
  }
}
\`\`\`
  `;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.is(result.toolCalls[0].function.name, 'read_file');
	}
});

test('parseToolCalls: cleans JSON tool calls from content', t => {
	const content = `
Here is some text before.

{
  "name": "read_file",
  "arguments": {
    "path": "/path/to/file.txt"
  }
}

And some text after.
  `;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.regex(result.cleanedContent, /Here is some text before/);
		t.regex(result.cleanedContent, /And some text after/);
		t.notRegex(result.cleanedContent, /"name":\s*"read_file"/);
	}
});

// Priority Tests (XML should be tried first)

test('parseToolCalls: prioritizes XML over JSON when both present', t => {
	const content = `
<read_file>
  <path>/xml/path.txt</path>
</read_file>

{
  "name": "read_file",
  "arguments": {
    "path": "/json/path.txt"
  }
}
  `;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		// Should parse XML first and return immediately
		t.is(result.toolCalls.length, 1);
		t.is(result.toolCalls[0].function.name, 'read_file');
		// Verify it's the XML call (xml_call_ prefix)
		t.regex(result.toolCalls[0].id, /xml_call/);
		t.is(
			(result.toolCalls[0].function.arguments as {path: string}).path,
			'/xml/path.txt',
		);
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

test('parseToolCalls: deduplicates identical tool calls', t => {
	const content = `
{
  "name": "read_file",
  "arguments": {
    "path": "/path/to/file.txt"
  }
}

{
  "name": "read_file",
  "arguments": {
    "path": "/path/to/file.txt"
  }
}
  `;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		// Should deduplicate to single call
		t.is(result.toolCalls.length, 1);
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
