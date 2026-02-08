import test from 'ava';
import {
	cleanJSONToolCalls,
	detectMalformedJSONToolCall,
	parseJSONToolCalls,
} from './json-parser';

console.log(`\njson-parser.spec.ts`);

// Malformed Detection Tests

test('detectMalformedJSONToolCall: detects missing arguments field', t => {
	const content = `
{
  "name": "read_file"
}
  `;

	const result = detectMalformedJSONToolCall(content);

	t.truthy(result);
	if (result) {
		t.regex(result.error, /missing "arguments" field/i);
		t.regex(result.examples, /native tool calling format/i);
	}
});

test('detectMalformedJSONToolCall: detects missing name field', t => {
	const content = `
{
  "arguments": {
    "path": "/path/to/file.txt"
  }
}
  `;

	const result = detectMalformedJSONToolCall(content);

	t.truthy(result);
	if (result) {
		t.regex(result.error, /missing "name" field/i);
		t.regex(result.examples, /native tool calling format/i);
	}
});

test('detectMalformedJSONToolCall: detects string arguments instead of object', t => {
	const content = `
{
  "name": "read_file",
  "arguments": "/path/to/file.txt"
}
  `;

	const result = detectMalformedJSONToolCall(content);

	t.truthy(result);
	if (result) {
		t.regex(result.error, /"arguments" must be an object/i);
		t.regex(result.examples, /native tool calling format/i);
	}
});

test('detectMalformedJSONToolCall: returns null for valid JSON', t => {
	const content = `
{
  "name": "read_file",
  "arguments": {
    "path": "/path/to/file.txt"
  }
}
  `;

	const result = detectMalformedJSONToolCall(content);

	t.is(result, null);
});

test('detectMalformedJSONToolCall: returns null for plain text', t => {
	const content = 'Just some plain text without any JSON';

	const result = detectMalformedJSONToolCall(content);

	t.is(result, null);
});

test('detectMalformedJSONToolCall: includes helpful guidance in error', t => {
	const content = '{"name": "test"}';

	const result = detectMalformedJSONToolCall(content);

	t.truthy(result);
	if (result) {
		t.regex(result.examples, /native tool calling format/i);
		t.regex(result.examples, /function calling interface/i);
	}
});

// Parse Tests

test('parseJSONToolCalls: parses single JSON tool call', t => {
	const content = `
{
  "name": "read_file",
  "arguments": {
    "path": "/path/to/file.txt"
  }
}
  `;

	const calls = parseJSONToolCalls(content);

	t.is(calls.length, 1);
	t.is(calls[0].function.name, 'read_file');
	t.deepEqual(calls[0].function.arguments, {path: '/path/to/file.txt'});
});

test('parseJSONToolCalls: parses JSON in markdown code block', t => {
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

	const calls = parseJSONToolCalls(content);

	t.is(calls.length, 1);
	t.is(calls[0].function.name, 'read_file');
});

test('parseJSONToolCalls: parses JSON in code block without language', t => {
	const content = `
\`\`\`
{
  "name": "read_file",
  "arguments": {
    "path": "/path/to/file.txt"
  }
}
\`\`\`
  `;

	const calls = parseJSONToolCalls(content);

	t.is(calls.length, 1);
	t.is(calls[0].function.name, 'read_file');
});

test('parseJSONToolCalls: parses multiple tool calls', t => {
	const content = `
{
  "name": "read_file",
  "arguments": {
    "path": "/file1.txt"
  }
}

{
  "name": "create_file",
  "arguments": {
    "path": "/file2.txt",
    "content": "Hello"
  }
}
  `;

	const calls = parseJSONToolCalls(content);

	t.is(calls.length, 2);
	t.is(calls[0].function.name, 'read_file');
	t.is(calls[1].function.name, 'create_file');
});

test('parseJSONToolCalls: parses multiline JSON blocks', t => {
	const content = `
{
  "name": "create_file",
  "arguments": {
    "path": "/path/to/file.txt",
    "content": "Multi\\nline\\ncontent"
  }
}
  `;

	const calls = parseJSONToolCalls(content);

	t.is(calls.length, 1);
	t.is(calls[0].function.name, 'create_file');
	// The \\n in JSON gets parsed as actual newline characters
	t.true(
		(calls[0].function.arguments as {content: string}).content.includes('\n'),
	);
});

test('parseJSONToolCalls: parses inline JSON tool calls', t => {
	const content =
		'Here is a tool call: {"name": "read_file", "arguments": {"path": "/test.txt"}} and some more text';

	const calls = parseJSONToolCalls(content);

	t.is(calls.length, 1);
	t.is(calls[0].function.name, 'read_file');
});

test('parseJSONToolCalls: handles nested objects in arguments', t => {
	const content = `
{
  "name": "complex_tool",
  "arguments": {
    "config": {
      "nested": {
        "value": 123
      }
    }
  }
}
  `;

	const calls = parseJSONToolCalls(content);

	t.is(calls.length, 1);
	t.is(calls[0].function.name, 'complex_tool');
	t.deepEqual(calls[0].function.arguments, {
		config: {nested: {value: 123}},
	});
});

test('parseJSONToolCalls: handles arrays in arguments', t => {
	const content = `
{
  "name": "batch_tool",
  "arguments": {
    "files": ["file1.txt", "file2.txt", "file3.txt"]
  }
}
  `;

	const calls = parseJSONToolCalls(content);

	t.is(calls.length, 1);
	t.deepEqual(calls[0].function.arguments, {
		files: ['file1.txt', 'file2.txt', 'file3.txt'],
	});
});

test('parseJSONToolCalls: handles empty arguments object', t => {
	const content = `
{
  "name": "no_args_tool",
  "arguments": {}
}
  `;

	const calls = parseJSONToolCalls(content);

	t.is(calls.length, 1);
	t.is(calls[0].function.name, 'no_args_tool');
	t.deepEqual(calls[0].function.arguments, {});
});

test('parseJSONToolCalls: returns empty array for empty JSON object', t => {
	const content = '{}';

	const calls = parseJSONToolCalls(content);

	t.is(calls.length, 0);
});

test('parseJSONToolCalls: returns empty array for plain text', t => {
	const content = 'Just some plain text without any tool calls';

	const calls = parseJSONToolCalls(content);

	t.is(calls.length, 0);
});

test('parseJSONToolCalls: returns empty array for empty string', t => {
	const content = '';

	const calls = parseJSONToolCalls(content);

	t.is(calls.length, 0);
});

test('parseJSONToolCalls: preserves identical tool calls (no deduplication)', t => {
	const content = `
{
  "name": "read_file",
  "arguments": {
    "path": "/test.txt"
  }
}

{
  "name": "read_file",
  "arguments": {
    "path": "/test.txt"
  }
}
  `;

	const calls = parseJSONToolCalls(content);

	// No deduplication - both calls preserved
	t.is(calls.length, 2);
});

test('parseJSONToolCalls: preserves different tool calls', t => {
	const content = `
{
  "name": "read_file",
  "arguments": {
    "path": "/file1.txt"
  }
}

{
  "name": "read_file",
  "arguments": {
    "path": "/file2.txt"
  }
}
  `;

	const calls = parseJSONToolCalls(content);

	// Different arguments, should not deduplicate
	t.is(calls.length, 2);
});

test('parseJSONToolCalls: generates unique IDs for tool calls', t => {
	const content = `
{
  "name": "read_file",
  "arguments": {
    "path": "/file1.txt"
  }
}

{
  "name": "read_file",
  "arguments": {
    "path": "/file2.txt"
  }
}
  `;

	const calls = parseJSONToolCalls(content);

	t.is(calls.length, 2);
	t.not(calls[0].id, calls[1].id);
	t.truthy(calls[0].id);
	t.truthy(calls[1].id);
});

test('parseJSONToolCalls: handles malformed JSON gracefully', t => {
	const content = `
{
  "name": "read_file",
  "arguments": {
    "path": "/test.txt"
    // missing closing braces
  `;

	const calls = parseJSONToolCalls(content);

	// Should return empty array, not throw
	t.is(calls.length, 0);
});

// Clean Content Tests

test('cleanJSONToolCalls: removes JSON tool call from content', t => {
	const content = `
Here is some text before.

{
  "name": "read_file",
  "arguments": {
    "path": "/test.txt"
  }
}

And some text after.
  `;

	const calls = parseJSONToolCalls(content);
	const cleaned = cleanJSONToolCalls(content, calls);

	t.regex(cleaned, /Here is some text before/);
	t.regex(cleaned, /And some text after/);
	t.notRegex(cleaned, /"name":\s*"read_file"/);
});

test('cleanJSONToolCalls: removes code blocks containing tool calls', t => {
	const content = `
Some text before.

\`\`\`json
{
  "name": "read_file",
  "arguments": {
    "path": "/test.txt"
  }
}
\`\`\`

Some text after.
  `;

	const calls = parseJSONToolCalls(content);
	const cleaned = cleanJSONToolCalls(content, calls);

	t.regex(cleaned, /Some text before/);
	t.regex(cleaned, /Some text after/);
	t.notRegex(cleaned, /```/);
	t.notRegex(cleaned, /"name":\s*"read_file"/);
});

test('cleanJSONToolCalls: keeps code blocks without tool calls', t => {
	const content = `
Some text before.

\`\`\`json
{
  "someOtherData": "value"
}
\`\`\`

Some text after.
  `;

	const calls = parseJSONToolCalls(content);
	const cleaned = cleanJSONToolCalls(content, calls);

	// Should keep the code block since it doesn't contain a tool call
	t.regex(cleaned, /```/);
	t.regex(cleaned, /someOtherData/);
});

test('cleanJSONToolCalls: removes multiple tool calls', t => {
	const content = `
{"name": "tool1", "arguments": {"a": 1}}
Some text in between.
{"name": "tool2", "arguments": {"b": 2}}
  `;

	const calls = parseJSONToolCalls(content);
	const cleaned = cleanJSONToolCalls(content, calls);

	t.regex(cleaned, /Some text in between/);
	t.notRegex(cleaned, /"name":\s*"tool1"/);
	t.notRegex(cleaned, /"name":\s*"tool2"/);
});

test('cleanJSONToolCalls: removes inline tool calls', t => {
	const content =
		'Here is text {"name": "read_file", "arguments": {"path": "/test.txt"}} and more text';

	const calls = parseJSONToolCalls(content);
	const cleaned = cleanJSONToolCalls(content, calls);

	t.regex(cleaned, /Here is text/);
	t.regex(cleaned, /and more text/);
	t.notRegex(cleaned, /"name":\s*"read_file"/);
});

test('cleanJSONToolCalls: cleans up excessive whitespace', t => {
	const content = `
Text before.


{
  "name": "read_file",
  "arguments": {
    "path": "/test.txt"
  }
}



Text after.
  `;

	const calls = parseJSONToolCalls(content);
	const cleaned = cleanJSONToolCalls(content, calls);

	// Should reduce multiple newlines
	t.notRegex(cleaned, /\n\n\n\n/);
	t.regex(cleaned, /Text before/);
	t.regex(cleaned, /Text after/);
});

test('cleanJSONToolCalls: returns original content when no tool calls', t => {
	const content = 'Just some plain text without any tool calls';

	const cleaned = cleanJSONToolCalls(content, []);

	t.is(cleaned, content);
});

test('cleanJSONToolCalls: handles empty content', t => {
	const content = '';

	const cleaned = cleanJSONToolCalls(content, []);

	t.is(cleaned, '');
});

test('cleanJSONToolCalls: handles content with only tool calls', t => {
	const content = `
{
  "name": "read_file",
  "arguments": {
    "path": "/test.txt"
  }
}
  `;

	const calls = parseJSONToolCalls(content);
	const cleaned = cleanJSONToolCalls(content, calls);

	// Should be empty or whitespace only
	t.is(cleaned.trim(), '');
});

// Integration Tests

test('parseJSONToolCalls + cleanJSONToolCalls: full workflow', t => {
	const content = `
I want to read this file:

{
  "name": "read_file",
  "arguments": {
    "path": "/important.txt"
  }
}

And then create a backup:

{
  "name": "create_file",
  "arguments": {
    "path": "/backup.txt",
    "content": "backup content"
  }
}

That's all!
  `;

	const calls = parseJSONToolCalls(content);
	const cleaned = cleanJSONToolCalls(content, calls);

	// Verify parsing
	t.is(calls.length, 2);
	t.is(calls[0].function.name, 'read_file');
	t.is(calls[1].function.name, 'create_file');

	// Verify cleaning
	t.regex(cleaned, /I want to read this file/);
	t.regex(cleaned, /And then create a backup/);
	t.regex(cleaned, /That's all!/);
	t.notRegex(cleaned, /"name":\s*"read_file"/);
	t.notRegex(cleaned, /"name":\s*"create_file"/);
});

test('parseJSONToolCalls: handles special characters in arguments', t => {
	const content = `
{
  "name": "create_file",
  "arguments": {
    "path": "/test.txt",
    "content": "Special chars: \\"quotes\\", \\n newlines, \\t tabs"
  }
}
  `;

	const calls = parseJSONToolCalls(content);

	t.is(calls.length, 1);
	t.is(calls[0].function.name, 'create_file');
	t.truthy(calls[0].function.arguments);
});

test('parseJSONToolCalls: handles numbers in arguments', t => {
	const content = `
{
  "name": "repeat_tool",
  "arguments": {
    "count": 42,
    "delay": 1.5
  }
}
  `;

	const calls = parseJSONToolCalls(content);

	t.is(calls.length, 1);
	t.deepEqual(calls[0].function.arguments, {count: 42, delay: 1.5});
});

test('parseJSONToolCalls: handles booleans in arguments', t => {
	const content = `
{
  "name": "config_tool",
  "arguments": {
    "enabled": true,
    "debug": false
  }
}
  `;

	const calls = parseJSONToolCalls(content);

	t.is(calls.length, 1);
	t.deepEqual(calls[0].function.arguments, {enabled: true, debug: false});
});

test('parseJSONToolCalls: handles null in arguments', t => {
	const content = `
{
  "name": "nullable_tool",
  "arguments": {
    "optionalValue": null
  }
}
  `;

	const calls = parseJSONToolCalls(content);

	t.is(calls.length, 1);
	t.deepEqual(calls[0].function.arguments, {optionalValue: null});
});
