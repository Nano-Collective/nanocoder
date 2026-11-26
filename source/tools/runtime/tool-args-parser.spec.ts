import test from 'ava';
import {parseToolArguments} from './tool-args-parser';

console.log(`\ntool-args-parser.spec.ts`);

// Tests for lenient mode (default, strict=false)
test('parseToolArguments - parses valid JSON string in lenient mode', t => {
	const input = '{"path": "/test", "count": 42}';
	const result = parseToolArguments(input);
	t.deepEqual(result, {path: '/test', count: 42});
});

test('parseToolArguments - returns object as-is in lenient mode', t => {
	const input = {path: '/test', count: 42};
	const result = parseToolArguments(input);
	t.deepEqual(result, input);
});

test('parseToolArguments - returns unparsed string on parse failure in lenient mode', t => {
	const input = '{invalid json}';
	const result = parseToolArguments<unknown>(input);
	t.is(result, input); // Should return the string as-is
});

test('parseToolArguments - handles empty object string in lenient mode', t => {
	const input = '{}';
	const result = parseToolArguments(input);
	t.deepEqual(result, {});
});

test('parseToolArguments - handles array JSON in lenient mode', t => {
	const input = '[1, 2, 3]';
	const result = parseToolArguments(input);
	t.deepEqual(result, [1, 2, 3]);
});

test('parseToolArguments - handles null in lenient mode', t => {
	const result = parseToolArguments<unknown>(null);
	t.is(result, null);
});

test('parseToolArguments - handles undefined in lenient mode', t => {
	const result = parseToolArguments<unknown>(undefined);
	t.is(result, undefined);
});

test('parseToolArguments - handles number in lenient mode', t => {
	const result = parseToolArguments<unknown>(42);
	t.is(result, 42);
});

// Tests for strict mode (strict=true)
test('parseToolArguments - parses valid JSON string in strict mode', t => {
	const input = '{"path": "/test", "count": 42}';
	const result = parseToolArguments(input, {strict: true});
	t.deepEqual(result, {path: '/test', count: 42});
});

test('parseToolArguments - returns object as-is in strict mode', t => {
	const input = {path: '/test', count: 42};
	const result = parseToolArguments(input, {strict: true});
	t.deepEqual(result, input);
});

test('parseToolArguments - throws on parse failure in strict mode', t => {
	const input = '{invalid json}';
	const error = t.throws(() => {
		parseToolArguments(input, {strict: true});
	});
	t.true(error?.message.includes('Error: Invalid tool arguments'));
});

test('parseToolArguments - throws on malformed JSON in strict mode', t => {
	const input = '{"unclosed": ';
	const error = t.throws(() => {
		parseToolArguments(input, {strict: true});
	});
	t.true(error?.message.includes('Error: Invalid tool arguments'));
});

test('parseToolArguments - handles empty object string in strict mode', t => {
	const input = '{}';
	const result = parseToolArguments(input, {strict: true});
	t.deepEqual(result, {});
});

// Tests for type parameter
test('parseToolArguments - respects type parameter', t => {
	interface TestType {
		path: string;
		count: number;
	}
	const input = '{"path": "/test", "count": 42}';
	const result = parseToolArguments<TestType>(input);
	t.deepEqual(result, {path: '/test', count: 42});
});

// Edge cases
test('parseToolArguments - handles nested JSON', t => {
	const input = '{"outer": {"inner": {"value": 123}}}';
	const result = parseToolArguments(input);
	t.deepEqual(result, {outer: {inner: {value: 123}}});
});

test('parseToolArguments - handles JSON with special characters', t => {
	const input = '{"message": "Hello \\"world\\"", "newline": "test\\nline"}';
	const result = parseToolArguments(input);
	t.deepEqual(result, {message: 'Hello "world"', newline: 'test\nline'});
});

test('parseToolArguments - preserves boolean values', t => {
	const input = '{"enabled": true, "disabled": false}';
	const result = parseToolArguments(input);
	t.deepEqual(result, {enabled: true, disabled: false});
});

test('parseToolArguments - preserves null values in JSON', t => {
	const input = '{"value": null}';
	const result = parseToolArguments(input);
	t.deepEqual(result, {value: null});
});

// Comparison between strict and lenient modes
test('parseToolArguments - lenient vs strict behavior on invalid JSON', t => {
	const invalidJson = '{broken}';

	// Lenient mode: returns unparsed string
	const lenientResult = parseToolArguments<unknown>(invalidJson);
	t.is(lenientResult, invalidJson);

	// Strict mode: throws error
	const error = t.throws(() => {
		parseToolArguments(invalidJson, {strict: true});
	});
	t.true(error?.message.includes('Error: Invalid tool arguments'));
});
