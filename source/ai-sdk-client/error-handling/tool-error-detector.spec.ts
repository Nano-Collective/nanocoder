import test from 'ava';
import {isToolSupportError} from './tool-error-detector.js';

test('isToolSupportError returns false for non-Error values', t => {
	t.false(isToolSupportError(null));
	t.false(isToolSupportError(undefined));
	t.false(isToolSupportError('string error'));
	t.false(isToolSupportError(123));
	t.false(isToolSupportError({}));
});

test('isToolSupportError returns false for generic errors without tool patterns', t => {
	t.false(isToolSupportError(new Error('Something went wrong')));
	t.false(isToolSupportError(new Error('Network error')));
	t.false(isToolSupportError(new Error('Rate limit exceeded')));
});

test('isToolSupportError detects 400 Bad Request with tool keyword', t => {
	t.true(
		isToolSupportError(
			new Error('400 Bad Request: invalid parameter "tools"'),
		),
	);
	t.true(
		isToolSupportError(
			new Error('400 bad request: unexpected field "tools"'),
		),
	);
});

test('isToolSupportError detects 400 Bad Request with function keyword', t => {
	t.true(
		isToolSupportError(
			new Error('400 Bad Request: invalid parameter "functions"'),
		),
	);
	t.true(
		isToolSupportError(
			new Error('400 bad request: unrecognized field "function_calls"'),
		),
	);
});

test('isToolSupportError detects 400 Bad Request with invalid parameter', t => {
	t.true(
		isToolSupportError(
			new Error('400 Bad Request: invalid parameter found'),
		),
	);
});

test('isToolSupportError detects 400 Bad Request with unexpected field', t => {
	t.true(
		isToolSupportError(
			new Error('400 bad request: unexpected field in request'),
		),
	);
});

test('isToolSupportError detects 400 Bad Request with unrecognized keyword', t => {
	t.true(
		isToolSupportError(
			new Error('400 Bad Request: unrecognized parameter'),
		),
	);
});

test('isToolSupportError returns false for 400 without tool-related patterns', t => {
	t.false(
		isToolSupportError(
			new Error('400 Bad Request: invalid input format'),
		),
	);
	t.false(isToolSupportError(new Error('400 bad request: malformed JSON')));
});

test('isToolSupportError detects direct tool not supported messages', t => {
	t.true(isToolSupportError(new Error('tool not supported')));
	t.true(isToolSupportError(new Error('Tool not supported by model')));
	t.true(isToolSupportError(new Error('This tool is not supported')));
});

test('isToolSupportError detects function not supported messages', t => {
	t.true(isToolSupportError(new Error('function not supported')));
	t.true(isToolSupportError(new Error('Function calling not supported')));
	t.true(isToolSupportError(new Error('This function is not supported')));
});

test('isToolSupportError detects tool unsupported messages', t => {
	t.true(isToolSupportError(new Error('tool unsupported')));
	t.true(isToolSupportError(new Error('Tools are unsupported')));
});

test('isToolSupportError detects function unsupported messages', t => {
	t.true(isToolSupportError(new Error('function unsupported')));
	t.true(isToolSupportError(new Error('Function calling unsupported')));
});

test('isToolSupportError detects invalid tool messages', t => {
	t.true(isToolSupportError(new Error('invalid tool')));
	t.true(isToolSupportError(new Error('Invalid tool definition')));
});

test('isToolSupportError detects invalid function messages', t => {
	t.true(isToolSupportError(new Error('invalid function')));
	t.true(isToolSupportError(new Error('Invalid function definition')));
});

test('isToolSupportError detects tool parameter invalid messages', t => {
	t.true(
		isToolSupportError(new Error('tool parameter invalid')),
	);
	t.true(
		isToolSupportError(new Error('Invalid tool parameters provided')),
	);
});

test('isToolSupportError detects function parameter invalid messages', t => {
	t.true(
		isToolSupportError(new Error('function parameter invalid')),
	);
	t.true(
		isToolSupportError(
			new Error('Invalid function parameters in request'),
		),
	);
});

test('isToolSupportError is case-insensitive for direct patterns', t => {
	t.true(isToolSupportError(new Error('TOOL NOT SUPPORTED')));
	t.true(isToolSupportError(new Error('Tool Not Supported')));
	t.true(isToolSupportError(new Error('tool NOT supported')));
});

test('isToolSupportError detects Ollama-specific error with invalid character', t => {
	t.true(
		isToolSupportError(
			new Error(
				'invalid character after top-level value',
			),
		),
	);
	t.true(
		isToolSupportError(
			new Error(
				'invalid character after top-level value: unmarshal error',
			),
		),
	);
});

test('isToolSupportError requires both invalid character and top-level value patterns', t => {
	t.false(
		isToolSupportError(new Error('invalid character in string')),
	);
	t.false(
		isToolSupportError(new Error('after top-level value')),
	);
});

test('isToolSupportError detects mixed provider error messages', t => {
	// OpenAI-style
	t.true(
		isToolSupportError(
			new Error('400 Bad Request: invalid parameter tools'),
		),
	);

	// Anthropic-style
	t.true(
		isToolSupportError(new Error('function calling not supported')),
	);

	// Ollama-style
	t.true(
		isToolSupportError(
			new Error(
				'invalid character after top-level value: unmarshal error',
			),
		),
	);

	// Generic
	t.true(
		isToolSupportError(new Error('tool parameter invalid')),
	);
});

test('isToolSupportError returns false for other error types', t => {
	t.false(
		isToolSupportError(new Error('404 Not Found: model not available')),
	);
	t.false(
		isToolSupportError(
			new Error('401 Unauthorized: invalid API key'),
		),
	);
	t.false(
		isToolSupportError(new Error('500 Internal Server Error')),
	);
	t.false(
		isToolSupportError(new Error('Timeout: request took too long')),
	);
	t.false(
		isToolSupportError(
			new Error('Connection refused: cannot reach server'),
		),
	);
});

test('isToolSupportError handles Error subclasses', t => {
	class CustomError extends Error {
		constructor(message: string) {
			super(message);
			this.name = 'CustomError';
		}
	}

	t.true(
		isToolSupportError(new CustomError('tool not supported')),
	);
	t.false(
		isToolSupportError(new CustomError('some other error')),
	);
});
