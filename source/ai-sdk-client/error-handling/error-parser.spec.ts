import test from 'ava';
import {APICallError} from 'ai';
import {parseAPIError} from './error-parser.js';

test('parseAPIError handles non-Error values', t => {
	const result = parseAPIError('not an error');
	t.is(result, 'An unknown error occurred while communicating with the model');
});

test('parseAPIError handles APICallError with 400 status', t => {
	const error = new APICallError({
		message: 'Invalid request',
		url: 'https://api.example.com',
		requestBodyValues: {},
		statusCode: 400,
		responseBody: JSON.stringify({error: {message: 'Bad input'}}),
		responseHeaders: {},
		isRetryable: false,
	});

	const result = parseAPIError(error);
	t.is(
		result,
		'Bad request: Bad input\nURL: https://api.example.com\nResponse body: {"error":{"message":"Bad input"}}',
	);
});

test('parseAPIError handles APICallError with 401 status', t => {
	const error = new APICallError({
		message: 'Unauthorized',
		url: 'https://api.example.com',
		requestBodyValues: {},
		statusCode: 401,
		responseBody: '{}',
		responseHeaders: {},
		isRetryable: false,
	});

	const result = parseAPIError(error);
	t.is(result, 'Authentication failed: Invalid API key or credentials');
});

test('parseAPIError handles APICallError with 404 status', t => {
	const error = new APICallError({
		message: 'Not found',
		url: 'https://api.example.com',
		requestBodyValues: {},
		statusCode: 404,
		responseBody: '{}',
		responseHeaders: {},
		isRetryable: false,
	});

	const result = parseAPIError(error);
	t.is(
		result,
		'Model not found: The requested model may not exist or is unavailable',
	);
});

test('parseAPIError handles APICallError with 429 status and quota message', t => {
	const error = new APICallError({
		message: 'Rate limited',
		url: 'https://api.example.com',
		requestBodyValues: {},
		statusCode: 429,
		responseBody: JSON.stringify({
			error: {message: 'You have exceeded your usage limit'},
		}),
		responseHeaders: {},
		isRetryable: true,
	});

	const result = parseAPIError(error);
	t.is(result, 'Rate limit: You have exceeded your usage limit');
});

test('parseAPIError handles APICallError with 429 status without quota message', t => {
	const error = new APICallError({
		message: 'Rate limited',
		url: 'https://api.example.com',
		requestBodyValues: {},
		statusCode: 429,
		responseBody: '{}',
		responseHeaders: {},
		isRetryable: true,
	});

	const result = parseAPIError(error);
	t.is(
		result,
		'Rate limit exceeded: Too many requests. Please wait and try again',
	);
});

test('parseAPIError handles APICallError with 500 status', t => {
	const error = new APICallError({
		message: 'Server error',
		url: 'https://api.example.com',
		requestBodyValues: {},
		statusCode: 500,
		responseBody: JSON.stringify({message: 'Internal server error'}),
		responseHeaders: {},
		isRetryable: true,
	});

	const result = parseAPIError(error);
	t.is(result, 'Server error: Internal server error');
});

test('parseAPIError handles Error with status code in message', t => {
	const error = new Error('400 Bad Request: Invalid parameters');
	const result = parseAPIError(error);
	t.is(result, 'Bad request: Invalid parameters');
});

test('parseAPIError handles Ollama unmarshal errors', t => {
	const error = new Error(
		'invalid character after top-level value: unmarshal error',
	);
	const result = parseAPIError(error);
	t.true(result.includes('Ollama server error'));
	t.true(result.includes('malformed JSON'));
});

test('parseAPIError handles timeout errors', t => {
	const error = new Error('Request timeout: ETIMEDOUT');
	const result = parseAPIError(error);
	t.is(result, 'Request timed out: The model took too long to respond');
});

test('parseAPIError handles Headers Timeout Error with actionable guidance', t => {
	const error = new Error('Cannot connect to API: Headers Timeout Error');
	const result = parseAPIError(error);
	t.true(result.includes('waiting for model response headers'));
	t.true(result.includes('requestTimeout/socketTimeout'));
	t.true(result.includes('set both to -1'));
});

test('parseAPIError handles UND_ERR_HEADERS_TIMEOUT with actionable guidance', t => {
	const error = new Error('UND_ERR_HEADERS_TIMEOUT: Headers Timeout Error');
	const result = parseAPIError(error);
	t.true(result.includes('waiting for model response headers'));
	t.true(result.includes('requestTimeout/socketTimeout'));
});

test('parseAPIError handles variant-case headers timeout errors', t => {
	const error = new Error('und_err_headers_timeout: headers timeout error');
	const result = parseAPIError(error);
	t.true(result.includes('waiting for model response headers'));
	t.true(result.includes('requestTimeout/socketTimeout'));
	t.true(result.includes('set both to -1'));
});

test('parseAPIError handles connection errors', t => {
	const error = new Error('ECONNREFUSED: connection refused');
	const result = parseAPIError(error);
	t.is(result, 'Connection failed: Unable to reach the model server');
});

test('parseAPIError handles context length errors', t => {
	const error = new Error('context length exceeded');
	const result = parseAPIError(error);
	t.is(
		result,
		'Context too large: Please reduce the conversation length or message size',
	);
});

test('parseAPIError handles token limit errors', t => {
	const error = new Error('Please reduce the number of tokens in your message');
	const result = parseAPIError(error);
	t.is(
		result,
		'Too many tokens: Please shorten your message or clear conversation history',
	);
});

test('parseAPIError handles ECONNRESET errors', t => {
	const error = new Error('read ECONNRESET');
	const result = parseAPIError(error);
	t.is(result, 'Connection failed: Unable to reach the model server');
});

test('parseAPIError handles ENOTFOUND errors', t => {
	const error = new Error('getaddrinfo ENOTFOUND example.invalid');
	const result = parseAPIError(error);
	t.is(result, 'Connection failed: Unable to reach the model server');
});

test('parseAPIError handles connect ETIMEDOUT errors as timeout', t => {
	// ETIMEDOUT is caught by the timeout check first, which is correct
	const error = new Error('connect ETIMEDOUT 1.2.3.4:443');
	const result = parseAPIError(error);
	t.is(result, 'Request timed out: The model took too long to respond');
});

test('parseAPIError handles Failed to fetch errors', t => {
	const error = new Error('Failed to fetch');
	const result = parseAPIError(error);
	t.is(result, 'Connection failed: Unable to reach the model server');
});

test('parseAPIError does not misclassify "disconnect" as connection error', t => {
	const error = new Error('Client disconnect during streaming');
	const result = parseAPIError(error);
	// Should fall through to generic handler, not "Connection failed"
	t.is(result, 'Client disconnect during streaming');
});

test('parseAPIError does not misclassify "reconnect" as connection error', t => {
	const error = new Error('Please reconnect to continue');
	const result = parseAPIError(error);
	// Should fall through to generic handler, not "Connection failed"
	t.is(result, 'Please reconnect to continue');
});

test('parseAPIError handles generic errors', t => {
	const error = new Error('Something went wrong');
	const result = parseAPIError(error);
	t.is(result, 'Something went wrong');
});

test('parseAPIError removes "Error:" prefix from generic errors', t => {
	const error = new Error('Error: Something went wrong');
	const result = parseAPIError(error);
	t.is(result, 'Something went wrong');
});

test('parseAPIError extracts first line from multiline errors', t => {
	const error = new Error('First line\nSecond line\nThird line');
	const result = parseAPIError(error);
	t.is(result, 'First line');
});
