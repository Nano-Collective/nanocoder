import test from 'ava';
import {APICallError, NoOutputGeneratedError} from 'ai';
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
	t.is(
		result,
		"Couldn't reach the model server (ECONNREFUSED: connection refused). Check the provider's baseUrl and that the server is running.",
	);
});

test('parseAPIError handles context length errors', t => {
	const error = new Error('context length exceeded');
	const result = parseAPIError(error);
	t.is(
		result,
		'Context too large: Please reduce the conversation length or message size',
	);
});

test('parseAPIError handles LM Studio available context size errors', t => {
	const error = new Error(
		'request (5360 tokens) exceeds the available context size (4096 tokens), try increasing it',
	);
	const result = parseAPIError(error);
	t.is(
		result,
		'Context too large: Please reduce the conversation length or message size',
	);
});

test('parseAPIError unwraps AI_NoOutputGeneratedError causes before classifying', t => {
	const error = new NoOutputGeneratedError({
		cause: new Error(
			'request (5360 tokens) exceeds the available context size (4096 tokens), try increasing it',
		),
	});
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
	t.is(
		result,
		"Couldn't reach the model server (ECONNRESET: connection reset by peer). Check the provider's baseUrl and that the server is running.",
	);
});

test('parseAPIError handles ENOTFOUND errors', t => {
	const error = new Error('getaddrinfo ENOTFOUND example.invalid');
	const result = parseAPIError(error);
	t.is(
		result,
		"Couldn't reach the model server (ENOTFOUND: host not found (DNS lookup failed)). Check the provider's baseUrl and that the server is running.",
	);
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
	t.is(
		result,
		"Couldn't reach the model server. Check the provider's baseUrl and that the server is running.",
	);
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

// --- Issue #1742: name the provider, the URL, and the cause -----------------

const CONTEXT = {
	providerName: 'MyProvider',
	baseUrl: 'http://127.0.0.1:59999/v1',
};

test('parseAPIError names provider and baseUrl on a refused connection', t => {
	const error = new TypeError('fetch failed', {
		cause: new Error('connect ECONNREFUSED 127.0.0.1:59999'),
	});
	const result = parseAPIError(error, CONTEXT);
	t.is(
		result,
		"Couldn't reach provider \"MyProvider\" at http://127.0.0.1:59999/v1 (ECONNREFUSED: connection refused). Check the provider's baseUrl and that the server is running.",
	);
});

test('parseAPIError distinguishes an unknown host from a refused connection', t => {
	const refused = parseAPIError(
		new Error('connect ECONNREFUSED 127.0.0.1:59999'),
		CONTEXT,
	);
	const unknownHost = parseAPIError(
		new Error('getaddrinfo ENOTFOUND no-such-host.invalid'),
		{providerName: 'MyProvider', baseUrl: 'https://no-such-host.invalid/v1'},
	);
	t.true(refused.includes('ECONNREFUSED'));
	t.true(unknownHost.includes('ENOTFOUND'));
	t.not(refused, unknownHost);
});

test('parseAPIError wraps a bad port with the provider and URL', t => {
	const error = new TypeError('fetch failed', {cause: new Error('bad port')});
	const result = parseAPIError(error, {
		providerName: 'MyProvider',
		baseUrl: 'http://127.0.0.1:9/v1',
	});
	t.is(
		result,
		'Invalid baseUrl for provider "MyProvider" (http://127.0.0.1:9/v1): it uses a port the HTTP client refuses to connect to. Check that baseUrl is a complete URL (http:// or https://) and that any environment variables it references are set.',
	);
});

test('parseAPIError explains an unknown scheme (missing http://)', t => {
	const error = new TypeError('fetch failed', {
		cause: new Error('unknown scheme'),
	});
	const result = parseAPIError(error, {
		providerName: 'MyProvider',
		baseUrl: 'localhost:11434/v1',
	});
	t.true(result.includes('Invalid baseUrl for provider "MyProvider"'));
	t.true(result.includes('localhost:11434/v1'));
	t.true(result.includes('missing a scheme'));
});

test('parseAPIError explains an unparseable baseUrl (missing env var)', t => {
	// What `new URL()` throws for `${MISSING_URL}` or an empty string: a
	// TypeError whose message is the one-word "Invalid URL".
	const error = Object.assign(new TypeError('Invalid URL'), {
		code: 'ERR_INVALID_URL',
	});
	const result = parseAPIError(error, {
		providerName: 'MyProvider',
		baseUrl: '',
	});
	t.true(result.includes('Invalid baseUrl for provider "MyProvider"'));
	t.true(result.includes('it is not a valid URL'));
	t.true(result.includes('environment variables'));
});

test('parseAPIError omits provider name when no context is supplied', t => {
	const result = parseAPIError(new Error('bad port'));
	t.is(
		result,
		'Invalid baseUrl: it uses a port the HTTP client refuses to connect to. Check that baseUrl is a complete URL (http:// or https://) and that any environment variables it references are set.',
	);
});

test('parseAPIError does not treat a URL phrase mid-message as a baseUrl error', t => {
	const result = parseAPIError(
		new Error('The upstream returned invalid url metadata'),
	);
	t.is(result, 'The upstream returned invalid url metadata');
});
