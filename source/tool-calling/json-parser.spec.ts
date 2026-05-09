import test from 'ava';
import {
	cleanJSONToolCalls,
	detectMalformedJSONToolCall,
	parseJSONToolCalls,
} from './json-parser';

test('parseJSONToolCalls: parses fenced JSON tool call', t => {
	const content = `
\`\`\`json
{
  "name": "read_file",
  "arguments": {
    "path": "/tmp/test.txt"
  }
}
\`\`\`
	`;

	const calls = parseJSONToolCalls(content);

	t.is(calls.length, 1);
	t.is(calls[0].function.name, 'read_file');
	t.deepEqual(calls[0].function.arguments, {path: '/tmp/test.txt'});
});

test('cleanJSONToolCalls: removes fenced JSON tool call but keeps surrounding text', t => {
	const content = `Before

\`\`\`json
{
  "name": "read_file",
  "arguments": {
    "path": "/tmp/test.txt"
  }
}
\`\`\`

After`;

	const calls = parseJSONToolCalls(content);
	const cleaned = cleanJSONToolCalls(content, calls);

	t.is(cleaned, `Before

After`);
});

test('detectMalformedJSONToolCall: detects missing arguments field', t => {
	const result = detectMalformedJSONToolCall('{"name": "read_file"}');

	t.truthy(result);
	t.regex(result?.error || '', /missing "arguments" field/i);
});
