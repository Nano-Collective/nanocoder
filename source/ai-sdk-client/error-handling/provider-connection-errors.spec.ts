import test from 'ava';
import {parseAPIError} from './error-parser.js';

const localContext = {
	providerName: 'MyProvider',
	baseUrl: 'http://127.0.0.1:59999/v1',
};

test('connection refused: identifies provider, URL, code and hint', t => {
	const error = Object.assign(new Error('fetch failed'), {
		cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:59999'), {
			code: 'ECONNREFUSED',
		}),
	});
	const message = parseAPIError(error, localContext);
	t.true(message.includes('MyProvider'));
	t.true(message.includes('http://127.0.0.1:59999/v1'));
	t.true(message.includes('ECONNREFUSED'));
	t.true(message.includes('server running'));
});

test('DNS failure: distinguishes ENOTFOUND from ECONNREFUSED', t => {
	const error = Object.assign(new Error('fetch failed'), {
		cause: Object.assign(new Error('getaddrinfo ENOTFOUND no-such-host.invalid'), {
			code: 'ENOTFOUND',
		}),
	});
	const message = parseAPIError(error, {
		providerName: 'MyProvider',
		baseUrl: 'https://no-such-host.invalid/v1',
	});
	t.true(message.includes('MyProvider'));
	t.regex(
    message,
    /provider "MyProvider" at https:\/\/no-such-host\.invalid\/v1 \(ENOTFOUND\)/,
	);
	t.true(message.includes('ENOTFOUND'));
	t.true(message.includes('DNS'));
	t.false(message.includes('ECONNREFUSED'));
});

test('temporary DNS failure: identifies EAI_AGAIN in nested cause', t => {
	const error = new Error('fetch failed', {
		cause: Object.assign(new Error('DNS lookup failed'), {code: 'EAI_AGAIN'}),
	});
	const message = parseAPIError(error, localContext);
	t.true(message.includes('EAI_AGAIN'));
	t.true(message.includes('temporarily failed'));
});

test('connection reset: gives specific hint', t => {
	const message = parseAPIError(new Error('read ECONNRESET'), localContext);
	t.true(message.includes('ECONNRESET'));
	t.true(message.includes('Connection was reset'));
});

test('connection timeout: includes provider context', t => {
	const message = parseAPIError(new Error('connect ETIMEDOUT 127.0.0.1:59999'), localContext);
	t.true(message.includes('MyProvider'));
	t.true(message.includes('ETIMEDOUT'));
	t.true(message.includes('Connection timed out'));
});

test('headers timeout: preserves existing tuning guidance', t => {
	const message = parseAPIError(new Error('UND_ERR_HEADERS_TIMEOUT: Headers Timeout Error'), localContext);
	t.true(message.includes('requestTimeout/socketTimeout'));
});

test('bad port: explains invalid base URL', t => {
	const message = parseAPIError(new Error('bad port'), {
		providerName: 'MyProvider',
		baseUrl: 'http://127.0.0.1:9/v1',
	});
	t.true(message.includes('Invalid provider URL'));
	t.true(message.includes('MyProvider'));
	t.true(message.includes('hostname, port, and protocol'));
});

test('missing environment variable: advises checking environment', t => {
	const message = parseAPIError(new TypeError('Invalid URL'), {
		providerName: 'MyProvider',
		baseUrl: '${MISSING_URL}',
	});
	t.true(message.includes('MyProvider'));
	t.true(message.includes('environment variables'));
	t.false(message.includes('${MISSING_URL}'));
});

test('empty base URL: gives missing configuration hint', t => {
	const message = parseAPIError(new TypeError('Invalid URL'), {
		providerName: 'MyProvider',
		baseUrl: '',
	});
	t.true(message.includes('(not configured)'));
	t.true(message.includes('missing or unresolved'));
});

test('missing scheme: suggests http or https', t => {
	const message = parseAPIError(new Error('unknown scheme'), {
		providerName: 'MyProvider',
		baseUrl: 'localhost:11434/v1',
	});
	t.true(message.includes('Invalid provider URL'));
	t.true(message.includes('http:// or https://'));
});

test('sanitizes credentials and query parameters from valid URL', t => {
	const message = parseAPIError(new Error('fetch failed'), {
		providerName: 'MyProvider',
		baseUrl: 'https://user:secret@example.com/v1?api_key=private#token',
	});
	t.regex(
		message,
		/provider "MyProvider" at https:\/\/example\.com\/v1\. Check that/,
	);
	t.false(message.includes('user:secret'));
	t.false(message.includes('private'));
	t.false(message.includes('token'));
});

test('malformed URL is not echoed into user-facing error', t => {
	const message = parseAPIError(new TypeError('Invalid URL'), {
		providerName: 'MyProvider',
		baseUrl: 'https://user:secret@example.com:99999/v1',
	});
	t.true(message.includes('(invalid URL)'));
	t.false(message.includes('secret'));
});

test('unrelated errors still use generic behavior', t => {
	t.is(parseAPIError(new Error('Something went wrong'), localContext), 'Something went wrong');
});

test('Node.js credential URL errors do not leak secrets', t => {
    const baseUrl =
        'https://user:secret@127.0.0.1:59999/v1?api_key=private';

    const error = new TypeError(
        `Request cannot be constructed from a URL that includes credentials: ${baseUrl}`,
    );

    const message = parseAPIError(error, {
        providerName: 'MyProvider',
        baseUrl,
    });

    t.true(message.includes('MyProvider'));
    t.true(message.includes('127.0.0.1:59999'));
    t.true(message.includes('credentials'));

    t.false(message.includes('user:secret'));
    t.false(message.includes('secret'));
    t.false(message.includes('api_key'));
    t.false(message.includes('private'));
});
