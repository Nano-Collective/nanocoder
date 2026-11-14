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

test('parseToolCalls: finds XML tool calls after a fenced code example', t => {
	const content = `Here is the relevant code:

\`\`\`javascript
const x = 1;
\`\`\`

<read_file><path>src/app.ts</path></read_file>`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.is(result.toolCalls[0].function.name, 'read_file');
		t.deepEqual(result.toolCalls[0].function.arguments, {
			path: 'src/app.ts',
		});
		t.regex(result.cleanedContent, /Here is the relevant code:/);
		t.regex(result.cleanedContent, /const x = 1;/);
		t.notRegex(result.cleanedContent, /<read_file>/);
	}
});

test('parseToolCalls: finds XML tool calls before a fenced code example', t => {
	const content = `<read_file><path>src/app.ts</path></read_file>

Here is the relevant code:

\`\`\`javascript
const x = 1;
\`\`\``;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.is(result.toolCalls[0].function.name, 'read_file');
		t.deepEqual(result.toolCalls[0].function.arguments, {
			path: 'src/app.ts',
		});
		t.regex(result.cleanedContent, /Here is the relevant code:/);
		t.regex(result.cleanedContent, /const x = 1;/);
		t.notRegex(result.cleanedContent, /<read_file>/);
	}
});

test('parseToolCalls: parses XML tool calls whose values contain =', t => {
	const content = `<execute_bash><command>FOO=1 echo hi</command></execute_bash>
<string_replace><path>a.ts</path><old_str>const x = 1;</old_str><new_str>const x = 2;</new_str></string_replace>`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 2);
		t.is(result.toolCalls[0].function.name, 'execute_bash');
		t.deepEqual(result.toolCalls[0].function.arguments, {
			command: 'FOO=1 echo hi',
		});
		t.is(result.toolCalls[1].function.name, 'string_replace');
		t.deepEqual(result.toolCalls[1].function.arguments, {
			path: 'a.ts',
			old_str: 'const x = 1;',
			new_str: 'const x = 2;',
		});
	}
});

const EMBEDDED_XML =
	'<execute_bash><command>FOO=1 echo hi</command></execute_bash>';

test('parseToolCalls: XML quoted inside a Llama function-tag call stays an argument', t => {
	const args = {path: 'examples.md', content: EMBEDDED_XML};
	const content = `<function=write_file>${JSON.stringify(args)}</function>`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.is(result.toolCalls[0].function.name, 'write_file');
		t.deepEqual(result.toolCalls[0].function.arguments, args);
	}
});

test('parseToolCalls: XML quoted inside a JSON tool call stays an argument', t => {
	const args = {path: 'examples.md', content: EMBEDDED_XML};
	const content = JSON.stringify({name: 'write_file', arguments: args});

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.is(result.toolCalls[0].function.name, 'write_file');
		t.deepEqual(result.toolCalls[0].function.arguments, args);
	}
});

test('parseToolCalls: JSON strings containing braces and escapes keep XML as an argument', t => {
	for (const prefix of [
		'{{x}}',
		'a "quoted }} value"',
		'C:\\templates\\{{x}}',
		'an unclosed { brace and }}} closers',
	]) {
		const args = {path: 'docs.md', content: `${prefix} ${EMBEDDED_XML}`};
		const result = parseToolCalls(
			JSON.stringify({name: 'write_file', arguments: args}),
		);

		t.true(result.success, prefix);
		if (result.success) {
			t.is(result.toolCalls.length, 1, prefix);
			t.is(result.toolCalls[0].function.name, 'write_file', prefix);
			t.deepEqual(result.toolCalls[0].function.arguments, args, prefix);
			t.is(result.cleanedContent, '', prefix);
		}
	}
});

test('parseToolCalls: scans complete JSON objects with nested arguments and reordered keys', t => {
	const args = {
		path: 'docs.md',
		content: EMBEDDED_XML,
		options: {groups: [{message: '}}', values: [1, true, null]}]},
	};
	const result = parseToolCalls(
		JSON.stringify({arguments: args, name: 'write_file'}),
	);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.is(result.toolCalls[0].function.name, 'write_file');
		t.deepEqual(result.toolCalls[0].function.arguments, args);
		t.is(result.cleanedContent, '');
	}
});

test('parseToolCalls: finds JSON tool calls inside wrapper objects', t => {
	const call = {name: 'read_file', arguments: {path: 'src/a.ts'}};
	for (const wrapper of [
		{tool_calls: [call]},
		{tool_call: call},
		{response: {action: call}},
		{name: 'plan', steps: [call]},
	]) {
		const content = JSON.stringify(wrapper);
		const result = parseToolCalls(content);

		t.true(result.success, content);
		if (result.success) {
			t.is(result.toolCalls.length, 1, content);
			t.is(result.toolCalls[0].function.name, 'read_file', content);
			t.deepEqual(
				result.toolCalls[0].function.arguments,
				call.arguments,
				content,
			);
		}
	}
});

test('parseToolCalls: finds every JSON tool call in a tool_calls array', t => {
	const content = JSON.stringify({
		tool_calls: [
			{name: 'read_file', arguments: {path: 'a.ts'}},
			{name: 'read_file', arguments: {path: 'b.ts'}},
		],
	});

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.deepEqual(
			result.toolCalls.map(call => call.function.arguments),
			[{path: 'a.ts'}, {path: 'b.ts'}],
		);
	}
});

test('parseToolCalls: many unterminated JSON openers do not stall parsing', t => {
	// ~315 KB each: rescanning to the end from every opener takes seconds.
	for (const opener of [
		`{"${'x'.repeat(61)}`,
		'{"name":"read_file","arguments":{"path":"a.ts"}'.padEnd(63),
	]) {
		const content = opener.repeat(5000);

		const started = Date.now();
		const result = parseToolCalls(content);
		const elapsed = Date.now() - started;

		t.true(result.success, opener);
		if (result.success) {
			t.is(result.toolCalls.length, 0, opener);
		}
		t.true(elapsed < 500, `${opener.trim()}: ${elapsed}ms`);
	}
});

const CUT_OFF_CALL =
	'{"name":"write_file","arguments":{"path":"a.ts","content":"console.log(\\"hi\\");';

test('parseToolCalls: cut-off JSON calls on their own lines stop at the newline', t => {
	// ~400 KB: rescanning to the end from every call takes about 2 s, and
	// the scan budget would run out before the last call.
	const valid = {name: 'read_file', arguments: {path: 'b.ts'}};
	for (const cutOff of [CUT_OFF_CALL, `${CUT_OFF_CALL}\\`]) {
		const content = `${Array(5000).fill(cutOff).join('\n')}\n${JSON.stringify(valid)}`;

		const started = Date.now();
		const result = parseToolCalls(content);
		const elapsed = Date.now() - started;

		t.true(result.success, cutOff);
		if (result.success) {
			t.is(result.toolCalls.length, 1, cutOff);
			t.is(result.toolCalls[0].function.name, 'read_file', cutOff);
			t.deepEqual(
				result.toolCalls[0].function.arguments,
				valid.arguments,
				cutOff,
			);
		}
		t.true(elapsed < 500, `Parsing ${content.length} chars took ${elapsed}ms`);
	}
});

test('parseToolCalls: XML in a JSON call after a few cut-off calls stays an argument', t => {
	const args = {path: 'examples.md', content: EMBEDDED_XML};
	const content = `${Array(20).fill(CUT_OFF_CALL).join(' ')} ${JSON.stringify({name: 'write_file', arguments: args})}`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.is(result.toolCalls[0].function.name, 'write_file');
		t.deepEqual(result.toolCalls[0].function.arguments, args);
	}
});

test('parseToolCalls: rejects a reply that runs out of JSON scan budget', t => {
	// ~400 KB with no newline to stop at: without a budget each call is
	// rescanned to the end, about 2 s. The XML in the last call's arguments
	// must not run once the scan gives up.
	const args = {path: 'examples.md', content: EMBEDDED_XML};
	const content = `${Array(5000).fill(CUT_OFF_CALL).join(' ')} ${JSON.stringify({name: 'write_file', arguments: args})}`;

	const started = Date.now();
	const result = parseToolCalls(content);
	const elapsed = Date.now() - started;

	t.false(result.success);
	if (!result.success) {
		t.regex(result.error, /incomplete JSON tool calls/);
	}
	t.true(elapsed < 500, `Parsing ${content.length} chars took ${elapsed}ms`);
});

test('parseToolCalls: cut-off JSON calls inside an XML call argument stay content', t => {
	// ~16 KB: enough to run out of JSON scan budget if these are scanned.
	const fileContent = Array(200).fill(CUT_OFF_CALL).join(' ');
	const content = `<write_file><path>notes.md</path><content>${fileContent}</content></write_file>`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.is(result.toolCalls[0].function.name, 'write_file');
		t.deepEqual(result.toolCalls[0].function.arguments, {
			path: 'notes.md',
			content: fileContent,
		});
	}
});

test('parseToolCalls: unclosed tags before a code fence do not stall parsing', t => {
	// ~630 KB: scanning these tags for a call around the fence takes about 1 s.
	const tags = `<item>${'x'.repeat(57)}`.repeat(10000);
	const content = `${tags}\n\`\`\`\nhello\n\`\`\``;

	const started = Date.now();
	const result = parseToolCalls(content);
	const elapsed = Date.now() - started;

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 0);
	}
	t.true(elapsed < 100, `Parsing ${content.length} chars took ${elapsed}ms`);
});

test('parseToolCalls: function-tag examples inside XML arguments keep their contents', t => {
	const example = '<function=read_file>{"path":"a.ts"}</function>';
	for (const content of [
		`<write_file><path>docs.md</path><content>${example}</content></write_file>`,
		`<tool_call><write_file><path>docs.md</path><content>${example}</content></write_file></tool_call>`,
	]) {
		const result = parseToolCalls(content);

		t.true(result.success);
		if (result.success) {
			t.is(result.toolCalls.length, 1);
			t.is(result.toolCalls[0].function.name, 'write_file');
			t.deepEqual(result.toolCalls[0].function.arguments, {
				path: 'docs.md',
				content: example,
			});
			t.is(result.cleanedContent, '');
		}
	}
});

test('parseToolCalls: fenced JSON call quoted inside an XML call stays an argument', t => {
	const quoted = JSON.stringify({
		name: 'write_file',
		arguments: {path: 'examples.md', content: EMBEDDED_XML},
	});
	const fenced = `\`\`\`json\n${quoted}\n\`\`\``;
	const content = `<write_file><path>a.md</path><content>${fenced}</content></write_file>`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.is(result.toolCalls[0].function.name, 'write_file');
		t.deepEqual(result.toolCalls[0].function.arguments, {
			path: 'a.md',
			content: fenced,
		});
	}
});

test('parseToolCalls: JSON argument survives an HTML wrapper around a fenced XML call', t => {
	const json = '{"name": "read_file", "arguments": {"path": "/x"}}';
	const content = `<div>\n\`\`\`xml\n<write_file><path>a.json</path><content>${json}</content></write_file>\n\`\`\`\n</div>`;

	const result = parseToolCalls(content);

	t.true(result.success);
	if (result.success) {
		t.is(result.toolCalls.length, 1);
		t.is(result.toolCalls[0].function.name, 'write_file');
		t.deepEqual(result.toolCalls[0].function.arguments, {
			path: 'a.json',
			content: {name: 'read_file', arguments: {path: '/x'}},
		});
	}
});

test('parseToolCalls: JSON tool call quoted inside an XML call stays an argument', t => {
	const json = '{"name": "read_file", "arguments": {"path": "/x"}}';

	for (const content of [
		`<write_file><path>a.json</path><content>${json}</content></write_file>`,
		`<tool_call><write_file><path>a.json</path><content>${json}</content></write_file></tool_call>`,
	]) {
		const result = parseToolCalls(content);

		t.true(result.success);
		if (result.success) {
			t.is(result.toolCalls.length, 1);
			t.is(result.toolCalls[0].function.name, 'write_file');
			t.deepEqual(result.toolCalls[0].function.arguments, {
				path: 'a.json',
				content: {name: 'read_file', arguments: {path: '/x'}},
			});
		}
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

// Broken XML calls. These checks run only when the caller passes the names of
// the tools offered to the model.

const OFFERED = ['read_file', 'write_file', 'list_directory'];

test('parseToolCalls: reports a call that is never closed', t => {
	for (const content of [
		'<read_file><path>/test/file.txt</path>',
		'I will read it first.\n  <read_file>\n    <path>/test/file.txt</path>\n',
		'<read_file><path>/test/file.txt</path></read_files>',
		'<tool_call>\n<read_file>\n<path>/test/file.txt</path>\n',
	]) {
		const result = parseToolCalls(content, OFFERED);
		t.false(result.success, content);
		if (!result.success) {
			t.is(
				result.error,
				'Incomplete tool call: <read_file> is never closed with </read_file>',
			);
		}
	}
});

test('parseToolCalls: reports a call cut off partway through an argument', t => {
	const content = '<write_file>\n<path>a.ts</path>\n<content>\nexport const x = 1;\n';

	const result = parseToolCalls(content, OFFERED);

	t.false(result.success);
	if (!result.success) {
		t.is(
			result.error,
			'Incomplete tool call: <write_file> is never closed with </write_file>',
		);
	}
});

test('parseToolCalls: reports a parameter closed with the wrong tag instead of running without it', t => {
	const result = parseToolCalls(
		'<read_file><path>/test/file.txt</wrong_close></read_file>',
		OFFERED,
	);

	t.false(result.success);
	if (!result.success) {
		t.is(
			result.error,
			'Invalid tool call: <path> inside <read_file> is never closed with </path>',
		);
	}
});

test('parseToolCalls: reports a parameter that is never closed', t => {
	// Without the check this lists the working directory instead of src.
	const result = parseToolCalls(
		'<list_directory><path>src</list_directory>',
		OFFERED,
	);

	t.false(result.success);
	if (!result.success) {
		t.is(
			result.error,
			'Invalid tool call: <path> inside <list_directory> is never closed with </path>',
		);
	}
});

test('parseToolCalls: reports a closing tag that closes no parameter', t => {
	const result = parseToolCalls(
		'<read_file><path>a.ts</path></extra></read_file>',
		OFFERED,
	);

	t.false(result.success);
	if (!result.success) {
		t.is(
			result.error,
			'Invalid tool call: </extra> inside <read_file> does not close any parameter',
		);
	}
});

test('parseToolCalls: runs nothing when a complete call comes with a broken one', t => {
	const content =
		'<read_file><path>a.ts</path></read_file>\n<read_file><path>b.ts</path>';

	const result = parseToolCalls(content, OFFERED);

	t.false(result.success);
});

test('parseToolCalls: leaves HTML tags and tool names in prose alone', t => {
	for (const content of [
		'Add a <br> after the title, or wrap it in <b>bold</b>.',
		'Next I will use <read_file> to check the config.',
	]) {
		const result = parseToolCalls(content, OFFERED);
		t.true(result.success, content);
		if (result.success) {
			t.deepEqual(result.toolCalls, []);
		}
	}
});

test('parseToolCalls: leaves a call written in prose, outside code, alone', t => {
	// An unclosed call is only reported when it starts a line and nothing
	// but its own tags follows it.
	for (const content of [
		'use <read_file><path>x</path> to read a file',
		'To read a file, use <read_file><path>x</path>',
		'<read_file><path>x</path> reads a file.',
	]) {
		const result = parseToolCalls(content, OFFERED);
		t.true(result.success, content);
		if (result.success) {
			t.deepEqual(result.toolCalls, []);
		}
	}
});

test('parseToolCalls: leaves a broken call inside code alone', t => {
	for (const content of [
		'Like this:\n```xml\n<read_file><path>a.ts</path>\n```\nThat is all.',
		'Like this:\n```xml\n<read_file><path>a.ts</path>\n',
		'Call it as `<read_file><path>a.ts</path>` and close it.',
	]) {
		const result = parseToolCalls(content, OFFERED);
		t.true(result.success, content);
		if (result.success) {
			t.deepEqual(result.toolCalls, []);
		}
	}
});

test('parseToolCalls: checks a call the parser already runs from inside a code fence', t => {
	// The first fence is read as a wrapper, so this call would otherwise run
	// with {}.
	const result = parseToolCalls(
		'```xml\n<read_file><path>a.ts</wrong_close></read_file>\n```',
		OFFERED,
	);

	t.false(result.success);
});

test("parseToolCalls: leaves XML quoted inside another call's arguments alone", t => {
	for (const content of [
		'<write_file><path>notes.md</path><content>Use <read_file><path>x</path> to read.</content></write_file>',
		'{"name": "write_file", "arguments": {"path": "notes.md", "content": "Use <read_file><path>x</path> to read."}}',
	]) {
		const result = parseToolCalls(content, OFFERED);
		t.true(result.success, content);
		if (result.success) {
			t.is(result.toolCalls.length, 1);
			t.is(result.toolCalls[0].function.name, 'write_file');
			t.is(
				result.toolCalls[0].function.arguments.content,
				'Use <read_file><path>x</path> to read.',
			);
		}
	}
});

test('parseToolCalls: only checks calls to the offered tools', t => {
	// read_file isn't offered here, so its broken call is handled as before.
	const notOffered = parseToolCalls(
		'<read_file><path>a.ts</wrong_close></read_file>',
		['list_directory'],
	);
	t.true(notOffered.success);
	if (notOffered.success) {
		t.deepEqual(notOffered.toolCalls[0].function.arguments, {});
	}

	const notATool = parseToolCalls('<my_config><setting>on</setting>', OFFERED);
	t.true(notATool.success);
});

test('parseToolCalls: does not call a closed call unclosed when it is rejected for another reason', t => {
	// The = makes this attribute-style syntax, which the parser skips; the
	// call is closed, so the unclosed error would be wrong.
	const result = parseToolCalls(
		'<read_file><path>a.ts</path><start_line=5></read_file>',
		OFFERED,
	);

	t.true(result.success);
});

test('parseToolCalls: without tool names, broken calls are handled as before', t => {
	const unclosed = parseToolCalls('<read_file><path>/test/file.txt</path>');
	t.true(unclosed.success);
	if (unclosed.success) {
		t.deepEqual(unclosed.toolCalls, []);
	}

	const mismatched = parseToolCalls(
		'<read_file><path>/test/file.txt</wrong_close></read_file>',
	);
	t.true(mismatched.success);
	if (mismatched.success) {
		t.deepEqual(mismatched.toolCalls[0].function.arguments, {});
	}
});
