import test from 'ava';
import {parseAPIError} from '@/ai-sdk-client';

// Tests for parseAPIError function
// Now using the actual exported function instead of a duplicated copy

test('parseAPIError - handles Ollama unmarshal error from issue #87', t => {
	const error = new Error(
		"RetryError [AI_RetryError]: Failed after 3 attempts. Last error: unmarshal: invalid character '{' after top-level value",
	);

	const result = parseAPIError(error);

	t.true(result.includes('Ollama server error'));
	t.true(result.includes('malformed JSON'));
	t.true(result.includes('Restart Ollama'));
	t.true(result.includes('Re-pull the model'));
	t.true(result.includes('Check Ollama logs'));
	t.true(result.includes('Try a different model'));
	t.true(result.includes('Original error:'));
});

test('parseAPIError - handles unmarshal error without retry wrapper', t => {
	const error = new Error(
		"unmarshal: invalid character '{' after top-level value",
	);

	const result = parseAPIError(error);

	t.true(result.includes('Ollama server error'));
	t.true(result.includes('malformed JSON'));
});

test('parseAPIError - handles 500 error with invalid character (status code takes precedence)', t => {
	// This test verifies that HTTP status codes are parsed FIRST,
	// so a 500 error with "invalid character" in the message is treated
	// as a server error, not an Ollama-specific error
	const error = new Error(
		"500 Internal Server Error: invalid character 'x' after top-level value",
	);

	const result = parseAPIError(error);

	// Status code parsing takes precedence over Ollama-specific pattern matching
	t.is(result, "Server error: invalid character 'x' after top-level value");
});

test('parseAPIError - handles 500 error without JSON parsing issue', t => {
	const error = new Error(
		'500 Internal Server Error: database connection failed',
	);

	const result = parseAPIError(error);

	t.is(result, 'Server error: database connection failed');
});

test('parseAPIError - handles 404 error', t => {
	const error = new Error('404 Not Found: model not available');

	const result = parseAPIError(error);

	t.is(
		result,
		'Model not found: The requested model may not exist or is unavailable',
	);
});

test('parseAPIError - handles connection refused', t => {
	const error = new Error('ECONNREFUSED: Connection refused');

	const result = parseAPIError(error);

	t.is(result, 'Connection failed: Unable to reach the model server');
});

test('parseAPIError - handles timeout error', t => {
	const error = new Error('Request timeout: ETIMEDOUT');

	const result = parseAPIError(error);

	t.is(result, 'Request timed out: The model took too long to respond');
});

test('parseAPIError - handles non-Error objects', t => {
	const result = parseAPIError('string error');

	t.is(result, 'An unknown error occurred while communicating with the model');
});

test('parseAPIError - handles context length errors', t => {
	const error = new Error('context length exceeded');

	const result = parseAPIError(error);

	// Use exact assertion instead of OR condition
	t.is(
		result,
		'Context too large: Please reduce the conversation length or message size',
	);
});

test('parseAPIError - handles too many tokens errors', t => {
	const error = new Error('too many tokens in the request');

	const result = parseAPIError(error);

	t.is(
		result,
		'Context too large: Please reduce the conversation length or message size',
	);
});

test('parseAPIError - handles 400 with context length in message', t => {
	const error = new Error('400 Bad Request: context length exceeded');

	const result = parseAPIError(error);

	// The 400 status code pattern matches first, so we get the full message
	t.is(result, 'Bad request: context length exceeded');
});

test('parseAPIError - handles 401 authentication error', t => {
	const error = new Error('401 Unauthorized: Invalid API key');

	const result = parseAPIError(error);

	t.is(result, 'Authentication failed: Invalid API key or credentials');
});

test('parseAPIError - handles 403 forbidden error', t => {
	const error = new Error('403 Forbidden: Access denied');

	const result = parseAPIError(error);

	t.is(result, 'Access forbidden: Check your API permissions');
});

test('parseAPIError - handles 429 rate limit error', t => {
	const error = new Error('429 Too Many Requests: Rate limit exceeded');

	const result = parseAPIError(error);

	t.is(
		result,
		'Rate limit exceeded: Too many requests. Please wait and try again',
	);
});

test('parseAPIError - handles 502 bad gateway error', t => {
	const error = new Error('502 Bad Gateway: upstream error');

	const result = parseAPIError(error);

	t.is(result, 'Server error: upstream error');
});

test('parseAPIError - handles 503 service unavailable error', t => {
	const error = new Error('503 Service Unavailable: server overloaded');

	const result = parseAPIError(error);

	t.is(result, 'Server error: server overloaded');
});

test('parseAPIError - handles reduce tokens message', t => {
	const error = new Error('Please reduce the number of tokens in your request');

	const result = parseAPIError(error);

	t.is(
		result,
		'Too many tokens: Please shorten your message or clear conversation history',
	);
});

test('parseAPIError - cleans up unknown errors', t => {
	const error = new Error(
		'Error: Something unexpected happened\nWith more details',
	);

	const result = parseAPIError(error);

	// Should strip "Error: " prefix and only return first line
	t.is(result, 'Something unexpected happened');
});
