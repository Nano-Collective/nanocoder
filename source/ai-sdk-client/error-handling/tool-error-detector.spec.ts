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

test('isToolSupportError ignores 400 Bad Request with tool keyword', t => {
	t.false(
		isToolSupportError(
			new Error('400 Bad Request: invalid parameter "tools"'),
		),
	);
	t.false(
		isToolSupportError(
			new Error('400 bad request: unexpected field "tools"'),
		),
	);
});

test('isToolSupportError ignores 400 Bad Request with function keyword', t => {
	t.false(
		isToolSupportError(
			new Error('400 Bad Request: invalid parameter "functions"'),
		),
	);
	t.false(
		isToolSupportError(
			new Error('400 bad request: unrecognized field "function_calls"'),
		),
	);
});

test('isToolSupportError ignores 400 Bad Request with invalid parameter', t => {
	t.false(
		isToolSupportError(
			new Error('400 Bad Request: invalid parameter found'),
		),
	);
});

test('isToolSupportError ignores 400 Bad Request with unexpected field', t => {
	t.false(
		isToolSupportError(
			new Error('400 bad request: unexpected field in request'),
		),
	);
});

test('isToolSupportError ignores 400 Bad Request with unrecognized keyword', t => {
	t.false(
		isToolSupportError(
			new Error('400 Bad Request: unrecognized parameter'),
		),
	);
});

test('isToolSupportError ignores invalid tool-related validation errors', t => {
	for (const message of [
		"Invalid schema for function 'mcp_broken': 'additionalProperties' is required",
		'Invalid function call arguments in message history',
		'Invalid tool_choice value',
	]) {
		t.false(isToolSupportError(new Error(message)), message);
	}
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
	t.true(isToolSupportError(new Error('This model does not support tools')));
});

test('isToolSupportError detects function not supported messages', t => {
	t.true(isToolSupportError(new Error('function not supported')));
	t.true(isToolSupportError(new Error('Function calling not supported')));
	t.true(isToolSupportError(new Error('Function calling is not supported')));
	t.true(isToolSupportError(new Error('This function is not supported')));
});

test('isToolSupportError detects tool unsupported messages', t => {
	t.true(isToolSupportError(new Error('tool unsupported')));
	t.true(isToolSupportError(new Error('Tools are unsupported')));
	t.true(isToolSupportError(new Error('Tool calling is unsupported')));
});

test('isToolSupportError detects function unsupported messages', t => {
	t.true(isToolSupportError(new Error('function unsupported')));
	t.true(isToolSupportError(new Error('Function calling unsupported')));
});

test('isToolSupportError ignores invalid tool messages', t => {
	t.false(isToolSupportError(new Error('invalid tool')));
	t.false(isToolSupportError(new Error('Invalid tool definition')));
});

test('isToolSupportError ignores invalid function messages', t => {
	t.false(isToolSupportError(new Error('invalid function')));
	t.false(isToolSupportError(new Error('Invalid function definition')));
});

test('isToolSupportError ignores tool parameter invalid messages', t => {
	t.false(
		isToolSupportError(new Error('tool parameter invalid')),
	);
	t.false(
		isToolSupportError(new Error('Invalid tool parameters provided')),
	);
});

test('isToolSupportError ignores function parameter invalid messages', t => {
	t.false(
		isToolSupportError(new Error('function parameter invalid')),
	);
	t.false(
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
	t.false(
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
	t.false(
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

test('isToolSupportError ignores errors about tool calls in the history', t => {
	// These mention tools because the history holds tool calls, but the model
	// supports tools: retrying without them would hide the real error.
	for (const message of [
		"400 Bad Request: Invalid parameter: messages with role 'tool' must be a response to a preceeding message with 'tool_calls'.",
		"An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. The following tool_call_ids did not have response messages: call_abc",
		'messages.3: `tool_use` ids were found without `tool_result` blocks immediately after: toolu_01',
		'unexpected `tool_use_id` found in `tool_result` blocks: toolu_01',
		"Invalid 'messages[4].tool_calls[0].function.arguments': expected a JSON string",
		"400 Bad Request: This model's maximum context length is 128000 tokens, including tool definitions",
	]) {
		t.false(isToolSupportError(new Error(message)), message);
	}
});

test('isToolSupportError detects Ollama models without tool support', t => {
	t.true(
		isToolSupportError(
			new Error('registry.ollama.ai/library/deepseek-r1:8b does not support tools'),
		),
	);
	t.true(isToolSupportError(new Error("This model doesn't support function calling")));
});

test('isToolSupportError reads the server message from stream errors', t => {
	// A refused streamed request throws a bare NoOutputGeneratedError; the
	// server's explanation is only on the error the stream reported.
	const thrown = new Error('No output generated. Check the stream for errors.');
	thrown.name = 'AI_NoOutputGeneratedError';

	t.false(isToolSupportError(thrown));
	t.true(
		isToolSupportError(thrown, [
			new Error('registry.ollama.ai/library/gemma:2b does not support tools'),
		]),
	);
	t.false(
		isToolSupportError(thrown, [
			new Error(
				"Invalid parameter: messages with role 'tool' must be a response to a preceeding message with 'tool_calls'.",
			),
		]),
	);
});
