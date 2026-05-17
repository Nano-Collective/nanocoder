import test from 'ava';
import {formatError} from './error-formatter';

console.log(`\nerror-formatter.spec.ts`);

// Tests for Error instances
test('formatError - formats standard Error instance', t => {
	const error = new Error('Something went wrong');
	const result = formatError(error);
	t.is(result, 'Something went wrong');
});

test('formatError - formats Error with empty message', t => {
	const error = new Error('');
	const result = formatError(error);
	t.is(result, '');
});

test('formatError - formats TypeError instance', t => {
	const error = new TypeError('Invalid type');
	const result = formatError(error);
	t.is(result, 'Invalid type');
});

test('formatError - formats RangeError instance', t => {
	const error = new RangeError('Out of range');
	const result = formatError(error);
	t.is(result, 'Out of range');
});

test('formatError - formats SyntaxError instance', t => {
	const error = new SyntaxError('Unexpected token');
	const result = formatError(error);
	t.is(result, 'Unexpected token');
});

test('formatError - formats custom Error subclass', t => {
	class CustomError extends Error {
		constructor(message: string) {
			super(message);
			this.name = 'CustomError';
		}
	}
	const error = new CustomError('Custom error message');
	const result = formatError(error);
	t.is(result, 'Custom error message');
});

// Tests for non-Error types
test('formatError - formats string error', t => {
	const error = 'Simple error string';
	const result = formatError(error);
	t.is(result, 'Simple error string');
});

test('formatError - formats number error', t => {
	const error = 404;
	const result = formatError(error);
	t.is(result, '404');
});

test('formatError - formats boolean error', t => {
	const error = false;
	const result = formatError(error);
	t.is(result, 'false');
});

test('formatError - formats null error', t => {
	const error = null;
	const result = formatError(error);
	t.is(result, 'null');
});

test('formatError - formats undefined error', t => {
	const error = undefined;
	const result = formatError(error);
	t.is(result, 'undefined');
});

test('formatError - formats object error', t => {
	const error = {code: 'ERR_001', message: 'Custom error'};
	const result = formatError(error);
	t.is(result, '{"code":"ERR_001","message":"Custom error"}');
});

test('formatError - falls back to String() for objects with circular refs', t => {
	const error: Record<string, unknown> = {code: 'ERR_002'};
	error.self = error;
	const result = formatError(error);
	t.is(result, '[object Object]');
});

test('formatError - formats array error', t => {
	const error = ['error1', 'error2'];
	const result = formatError(error);
	t.is(result, 'error1,error2');
});

test('formatError - formats object with toString method', t => {
	const error = {
		toString() {
			return 'Custom toString';
		},
	};
	const result = formatError(error);
	t.is(result, 'Custom toString');
});

// Edge cases
test('formatError - formats Error with multiline message', t => {
	const error = new Error('Line 1\nLine 2\nLine 3');
	const result = formatError(error);
	t.is(result, 'Line 1\nLine 2\nLine 3');
});

test('formatError - formats Error with special characters', t => {
	const error = new Error('Error: "quoted" \'text\' with\ttabs');
	const result = formatError(error);
	t.is(result, 'Error: "quoted" \'text\' with\ttabs');
});

test('formatError - formats Error with unicode characters', t => {
	const error = new Error('Error: 日本語 emoji 🚀');
	const result = formatError(error);
	t.is(result, 'Error: 日本語 emoji 🚀');
});

test('formatError - handles Error.cause if present', t => {
	const error = new Error('Main error');
	// Note: Error.cause is a modern feature, just test that formatError still works
	const result = formatError(error);
	t.is(result, 'Main error');
});

// Type consistency tests
test('formatError - always returns string type for Error', t => {
	const error = new Error('Test');
	const result = formatError(error);
	t.is(typeof result, 'string');
});

test('formatError - always returns string type for non-Error', t => {
	const error = {custom: 'object'};
	const result = formatError(error);
	t.is(typeof result, 'string');
});

// Real-world scenario tests
test('formatError - handles JSON parse error', t => {
	let error: unknown;
	try {
		JSON.parse('{invalid}');
	} catch (e) {
		error = e;
	}
	const result = formatError(error);
	t.true(result.includes('JSON') || result.includes('Unexpected'));
});

test('formatError - handles fetch-like error', t => {
	const error = new Error('Failed to fetch: Network error');
	const result = formatError(error);
	t.is(result, 'Failed to fetch: Network error');
});

test('formatError - handles validation error object', t => {
	const error = {
		field: 'email',
		message: 'Invalid email format',
		toString() {
			return `${this.field}: ${this.message}`;
		},
	};
	const result = formatError(error);
	t.is(result, 'email: Invalid email format');
});
