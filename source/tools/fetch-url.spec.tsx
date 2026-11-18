import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';

console.log(`\nfetch-url.spec.tsx – ${React.version}`);

// Polyfill File for undici in Node.js test environment
if (typeof File === 'undefined') {
	(global as any).File = class File {
		constructor(
			public parts: any[],
			public name: string,
			public options?: any,
		) {}
	};
}

// Dynamically import to avoid loading undici in test environment
let fetchUrlTool: any;

// Hostnames are resolved before every hop; point them all at a public address
// so these specs never touch real DNS, and put the real resolver back after.
// Individual tests override it.
let originalResolve: typeof import('./fetch-url-guard.js').hostResolver.resolve;

test.before(async () => {
	const {hostResolver} = await import('./fetch-url-guard.js');
	originalResolve = hostResolver.resolve;
	hostResolver.resolve = async () => ['93.184.216.34'];

	// Only import when we need it, and handle the case where undici might not work
	try {
		const module = await import('./fetch-url.js');
		fetchUrlTool = module.fetchUrlTool;
	} catch (error) {
		// If undici fails to load (e.g., in CI), we'll skip handler tests
		console.warn('Failed to load fetch-url module:', error);
	}
});

test.after.always(async () => {
	const {hostResolver} = await import('./fetch-url-guard.js');
	hostResolver.resolve = originalResolve;
});

// Mock ThemeProvider for testing
const MockThemeProvider = ({children}: {children: React.ReactNode}) => {
	const mockTheme = {
		currentTheme: 'default' as const,
		colors: themes['tokyo-night'].colors, // Use tokyo-night theme colors
		setCurrentTheme: () => {},
	};

	return (
		<ThemeContext.Provider value={mockTheme}>{children}</ThemeContext.Provider>
	);
};

// Note: These tests validate the tool configuration and validator logic.
// Handler tests that make actual network requests are skipped to avoid flakiness.
// For handler testing, consider using integration tests with known stable URLs
// or mocking the convertToMarkdown function at the module level.

test('handler validates URL format', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}

	await t.throwsAsync(
		async () => {
			await fetchUrlTool.tool.execute!(
				{url: 'not-a-valid-url'},
				{toolCallId: 'test', messages: []},
			);
		},
		{message: /Invalid URL/},
	);
});

test('handler rejects loopback aliases without fetching', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}

	for (const url of [
		'http://127.0.0.2/',
		'http://metadata.google.internal/',
		'http://metadata.goog/',
	]) {
		await t.throwsAsync(
			async () => {
				await fetchUrlTool.tool.execute!(
					{url},
					{toolCallId: 'test', messages: []},
				);
			},
			{message: /internal\/private network/},
			url,
		);
	}
});

test.serial(
	'handler validates each redirect before fetching its destination',
	async t => {
		if (!fetchUrlTool) {
			t.pass('Skipping test - fetch-url module not available');
			return;
		}

		const originalFetch = globalThis.fetch;
		const requests: Array<{url: string; init: RequestInit}> = [];
		globalThis.fetch = async (input, init) => {
			const request = {url: String(input), init: init ?? {}};
			requests.push(request);
			if (request.url === 'https://public.example.test/redirect') {
				return new Response(null, {
					status: 302,
					statusText: 'Found',
					headers: {location: 'http://127.0.0.1:8080/internal'},
				});
			}

			throw new Error(`Unexpected request to ${request.url}`);
		};

		try {
			await t.throwsAsync(
				async () => {
					await fetchUrlTool.tool.execute!(
						{url: 'https://public.example.test/redirect'},
						{toolCallId: 'test', messages: []},
					);
				},
				{message: /internal\/private network/},
			);
			t.is(requests.length, 1);
			t.is(requests[0]?.url, 'https://public.example.test/redirect');
			t.is(requests[0]?.init.redirect, 'manual');
			t.notRegex(
				requests.map(request => request.url).join('\n'),
				/127\.0\.0\.1/,
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	},
);

// A public name whose DNS record points at an internal address (#1662).
const resolveInternalNames = async (host: string) =>
	host.endsWith('.nip.io') || host === 'localtest.me'
		? ['127.0.0.1']
		: ['93.184.216.34'];

test.serial(
	'handler rejects a public name that resolves to an internal address without fetching',
	async t => {
		if (!fetchUrlTool) {
			t.pass('Skipping test - fetch-url module not available');
			return;
		}

		const {hostResolver} = await import('./fetch-url-guard.js');
		const originalResolve = hostResolver.resolve;
		const originalFetch = globalThis.fetch;
		const requests: string[] = [];
		hostResolver.resolve = resolveInternalNames;
		globalThis.fetch = async input => {
			requests.push(String(input));
			throw new Error(`Unexpected request to ${String(input)}`);
		};

		try {
			for (const url of [
				'http://localtest.me:18080/admin',
				'http://169.254.169.254.nip.io/latest/meta-data/',
			]) {
				await t.throwsAsync(
					async () => {
						await fetchUrlTool.tool.execute!(
							{url},
							{toolCallId: 'test', messages: []},
						);
					},
					{message: /internal\/private network address: .* resolves to /},
					url,
				);
			}
			t.deepEqual(requests, []);
		} finally {
			hostResolver.resolve = originalResolve;
			globalThis.fetch = originalFetch;
		}
	},
);

test.serial(
	'handler rejects a redirect to a name that resolves to an internal address',
	async t => {
		if (!fetchUrlTool) {
			t.pass('Skipping test - fetch-url module not available');
			return;
		}

		const {hostResolver} = await import('./fetch-url-guard.js');
		const originalResolve = hostResolver.resolve;
		const originalFetch = globalThis.fetch;
		const requests: string[] = [];
		hostResolver.resolve = resolveInternalNames;
		globalThis.fetch = async input => {
			requests.push(String(input));
			if (String(input) === 'https://public.example.test/redirect') {
				return new Response(null, {
					status: 302,
					statusText: 'Found',
					headers: {location: 'http://127.0.0.1.nip.io:8080/internal'},
				});
			}

			throw new Error(`Unexpected request to ${String(input)}`);
		};

		try {
			await t.throwsAsync(
				async () => {
					await fetchUrlTool.tool.execute!(
						{url: 'https://public.example.test/redirect'},
						{toolCallId: 'test', messages: []},
					);
				},
				{message: /resolves to 127\.0\.0\.1/},
			);
			t.deepEqual(requests, ['https://public.example.test/redirect']);
		} finally {
			hostResolver.resolve = originalResolve;
			globalThis.fetch = originalFetch;
		}
	},
);

test.serial(
	'handler follows safe redirects and converts the final URL',
	async t => {
		if (!fetchUrlTool) {
			t.pass('Skipping test - fetch-url module not available');
			return;
		}

		const originalFetch = globalThis.fetch;
		const requests: Array<{url: string; init: RequestInit}> = [];
		globalThis.fetch = async (input, init) => {
			const request = {url: String(input), init: init ?? {}};
			requests.push(request);
			if (request.url === 'https://public.example.test/redirect') {
				return new Response(null, {
					status: 302,
					statusText: 'Found',
					headers: {location: '/intermediate'},
				});
			}

			if (request.url === 'https://public.example.test/intermediate') {
				return new Response(null, {
					status: 307,
					statusText: 'Temporary Redirect',
					headers: {location: 'https://public.example.test/docs'},
				});
			}

			if (request.url === 'https://public.example.test/docs') {
				return new Response('<html><body><h1>Safe page</h1></body></html>', {
					status: 200,
					headers: {'content-type': 'text/html'},
				});
			}

			throw new Error(`Unexpected request to ${request.url}`);
		};

		try {
			const result = await fetchUrlTool.tool.execute!(
				{url: 'https://public.example.test/redirect'},
				{toolCallId: 'test', messages: []},
			);
			t.regex(result, /Safe page/);
			t.deepEqual(
				requests.map(request => request.url),
				[
					'https://public.example.test/redirect',
					'https://public.example.test/intermediate',
					'https://public.example.test/docs',
					'https://public.example.test/docs',
				],
			);
			t.true(requests.every(request => request.init.redirect === 'manual'));
			// The walk only needs a status and a Location, so every hop is a
			// HEAD. The final URL is visited twice - once to learn it does not
			// redirect, once by the converter - but only the second transfers a
			// body. A GET walk moved the whole page twice per call.
			t.deepEqual(
				requests.map(request => request.init.method ?? 'GET'),
				['HEAD', 'HEAD', 'HEAD', 'GET'],
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	},
);

test.serial(
	'handler falls back to GET for a server that refuses HEAD',
	async t => {
		if (!fetchUrlTool) {
			t.pass('Skipping test - fetch-url module not available');
			return;
		}

		const originalFetch = globalThis.fetch;
		const requests: Array<{url: string; method: string}> = [];
		globalThis.fetch = async (input, init) => {
			const method = (init?.method as string | undefined) ?? 'GET';
			requests.push({url: String(input), method});

			// A server that answers HEAD with 405 must not break the tool: the
			// redirect walk retries the hop as a GET and discards the body.
			if (method === 'HEAD') {
				return new Response(null, {status: 405, statusText: 'Not Allowed'});
			}
			return new Response('<html><body><h1>Only GET</h1></body></html>', {
				status: 200,
				headers: {'content-type': 'text/html'},
			});
		};

		try {
			const result = await fetchUrlTool.tool.execute!(
				{url: 'https://public.example.test/no-head'},
				{toolCallId: 'test', messages: []},
			);
			t.regex(result, /Only GET/);
			t.deepEqual(
				requests.map(request => request.method),
				['HEAD', 'GET', 'GET'],
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	},
);

test.serial('handler follows a redirect reported only on HEAD', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}

	const originalFetch = globalThis.fetch;
	const requests: Array<{url: string; method: string}> = [];
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		const method = (init?.method as string | undefined) ?? 'GET';
		requests.push({url, method});

		if (url === 'https://public.example.test/start') {
			// A redirect must still be caught when it is a HEAD that sees it,
			// and its destination must still be validated before it is visited.
			return new Response(null, {
				status: 301,
				headers: {location: 'http://169.254.169.254/latest/meta-data/'},
			});
		}
		throw new Error(`Unexpected request to ${url}`);
	};

	try {
		await t.throwsAsync(
			async () => {
				await fetchUrlTool.tool.execute!(
					{url: 'https://public.example.test/start'},
					{toolCallId: 'test', messages: []},
				);
			},
			{message: /internal\/private network/},
		);
		t.deepEqual(requests, [
			{url: 'https://public.example.test/start', method: 'HEAD'},
		]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('validator accepts valid HTTP URLs', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	const result = await fetchUrlTool.validator!({url: 'https://example.com'});

	t.true(result.valid);
});

test('validator accepts valid HTTPS URLs', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	const result = await fetchUrlTool.validator!({url: 'http://example.com'});

	t.true(result.valid);
});

test('validator rejects invalid URL formats', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	const result = await fetchUrlTool.validator!({url: 'not a url'});

	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('Invalid URL format'));
	}
});

test('validator rejects non-HTTP/HTTPS protocols', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	const result = await fetchUrlTool.validator!({url: 'ftp://example.com'});

	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('Invalid URL protocol'));
		t.true(result.error.includes('ftp:'));
	}
});

test('validator rejects localhost URLs', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	const result = await fetchUrlTool.validator!({url: 'http://localhost:3000'});

	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('internal/private network'));
	}
});

test('validator rejects 127.0.0.1 URLs', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	const result = await fetchUrlTool.validator!({
		url: 'http://127.0.0.1:8080',
	});

	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('internal/private network'));
	}
});

test('validator rejects IPv6 loopback [::1] URLs', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	const result = await fetchUrlTool.validator!({
		url: 'http://[::1]:8080',
	});

	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('internal/private network'));
	}
});

test('validator rejects expanded and IPv4-mapped IPv6 loopback URLs', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	for (const url of [
		'http://[0:0:0:0:0:0:0:1]',
		'http://[::ffff:127.0.0.1]',
		'http://[::]',
	]) {
		const result = await fetchUrlTool.validator!({url});
		t.false(result.valid, `expected ${url} to be rejected`);
	}
});

test('validator rejects 192.168.x.x URLs', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	const result = await fetchUrlTool.validator!({
		url: 'http://192.168.1.1',
	});

	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('internal/private network'));
	}
});

test('validator rejects 10.x.x.x URLs', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	const result = await fetchUrlTool.validator!({url: 'http://10.0.0.1'});

	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('internal/private network'));
	}
});

test('validator rejects 172.16-31.x.x URLs', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	const result = await fetchUrlTool.validator!({url: 'http://172.16.0.1'});

	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('internal/private network'));
	}
});

test('validator accepts external IP addresses', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	const result = await fetchUrlTool.validator!({url: 'http://8.8.8.8'});

	t.true(result.valid);
});

test('validator rejects 127.0.0.2 and cloud metadata hosts', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	for (const url of [
		'http://127.0.0.2',
		'http://169.254.169.254/latest/meta-data/',
		'http://metadata.google.internal',
		'http://metadata.goog',
		'http://metadata/',
		'http://[::ffff:127.0.0.2]',
	]) {
		const result = await fetchUrlTool.validator!({url});
		t.false(result.valid, `expected ${url} to be rejected`);
	}
});

test('tool has correct name', t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	t.is(fetchUrlTool.name, 'fetch_url');
});

test('tool does not require confirmation', t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	t.true(fetchUrlTool.readOnly);
	t.is(fetchUrlTool.approval, undefined);
});

test('formatter is a function', t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	t.is(typeof fetchUrlTool.formatter, 'function');
});

test('formatter returns a React element', t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	const result = fetchUrlTool.formatter!({url: 'https://example.com'});

	t.truthy(result);
	t.is(typeof result, 'object');
});

// ============================================================================
// Component Rendering Tests
// ============================================================================

test('formatter renders component with URL', t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	const component = fetchUrlTool.formatter!({
		url: 'https://example.com',
	});

	const {lastFrame} = render(
		<MockThemeProvider>{component}</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /fetch_url/);
	t.regex(output!, /https:\/\/example\.com/);
});

test('formatter renders component with result stats', t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	const mockResult = 'Test content with some markdown';

	const component = fetchUrlTool.formatter!(
		{url: 'https://example.com'},
		mockResult,
	);

	const {lastFrame} = render(
		<MockThemeProvider>{component}</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /fetch_url/);
	t.regex(output!, /https:\/\/example\.com/);
	t.regex(output!, /Tokens:/);
	t.regex(output!, /tokens/);
});

test('formatter shows truncation warning when content is truncated', t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	const truncatedResult =
		'x'.repeat(100000) +
		'\n\n[Content truncated - showing characters 0-100000 of 150000. Call fetch_url again with start_index=100000 to continue.]';

	const component = fetchUrlTool.formatter!(
		{url: 'https://large-content.com'},
		truncatedResult,
	);

	const {lastFrame} = render(
		<MockThemeProvider>{component}</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.true(output!.includes('Showing characters 0-100,000 of 150,000'));
});

test('formatter renders without result (before execution)', t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	const component = fetchUrlTool.formatter!({
		url: 'https://example.com',
	});

	const {lastFrame} = render(
		<MockThemeProvider>{component}</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /fetch_url/);
	t.regex(output!, /https:\/\/example\.com/);
	// Should not show token stats before execution
	t.notRegex(output!, /Tokens:/);
});

test('formatter calculates token estimate correctly', t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	// 100 characters should estimate ~25 tokens (divide by 4)
	const mockResult = 'a'.repeat(100);

	const component = fetchUrlTool.formatter!(
		{url: 'https://example.com'},
		mockResult,
	);

	const {lastFrame} = render(
		<MockThemeProvider>{component}</MockThemeProvider>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /~25 tokens/);
});

// ============================================================================
// Pagination (start_index / max_length)
// ============================================================================

const PAGE_LIMIT = 100_000;
const NOTE =
	/\n\n\[Content truncated - showing characters (\d+)-(\d+) of (\d+)\. Call fetch_url again with start_index=(\d+) to continue\.\]$/;

/** A page whose markdown is a few hundred thousand characters, ids in order. */
const longPageHtml = (entries: number) =>
	`<html><body>${Array.from(
		{length: entries},
		(_, i) =>
			`<p>entry-${String(i).padStart(6, '0')} lorem ipsum dolor sit amet</p>`,
	).join('')}</body></html>`;

/**
 * Serve `html` for every URL and count what is requested. A HEAD is the
 * redirect probe; a GET is the conversion, the one that moves the body.
 */
const servePages = (html: string) => {
	const requests = {head: 0, get: 0};
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (_input, init) => {
		if ((init?.method as string | undefined) === 'HEAD') {
			requests.head++;
			return new Response(null, {status: 200});
		}
		requests.get++;
		return new Response(html, {
			status: 200,
			headers: {'content-type': 'text/html'},
		});
	};
	return {requests, restore: () => (globalThis.fetch = originalFetch)};
};

const callFetchUrl = async (args: {
	url: string;
	start_index?: number;
	max_length?: number;
}): Promise<string> =>
	await fetchUrlTool.tool.execute!(args, {toolCallId: 'test', messages: []});

test.serial(
	'windows join back into the whole page with no gap and no overlap',
	async t => {
		if (!fetchUrlTool) {
			t.pass('Skipping test - fetch-url module not available');
			return;
		}

		const server = servePages(longPageHtml(7000));
		try {
			const url = 'https://pages.example.test/long';
			const parts: string[] = [];
			let start = 0;
			let total = 0;

			for (;;) {
				const result = await callFetchUrl({url, start_index: start});
				const note = result.match(NOTE);
				if (!note) {
					parts.push(result);
					break;
				}
				// The note describes the window just returned, and points at the
				// character right after it.
				const [, from, to, size, next] = note;
				const body = result.slice(0, note.index);
				t.is(Number(from), start);
				t.is(body.length, Number(to) - Number(from));
				t.is(Number(next), Number(to));
				total = Number(size);
				parts.push(body);
				start = Number(next);
			}

			t.true(parts.length >= 3, `expected 3+ windows, got ${parts.length}`);
			t.is(parts[0]?.length, PAGE_LIMIT);
			const whole = parts.join('');
			t.is(whole.length, total);
			// Nothing lost or repeated at a seam: every entry appears once, in order.
			// The converter's front matter repeats the first entry, so compare
			// the last 7000: a seam that dropped or repeated text shifts these.
			const ids = (whole.match(/entry-\d{6}/g) ?? []).slice(-7000);
			t.deepEqual(
				ids,
				Array.from({length: 7000}, (_, i) => `entry-${String(i).padStart(6, '0')}`),
			);
		} finally {
			server.restore();
		}
	},
);

test.serial('the truncation note names the window and the next start_index', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}

	const server = servePages(longPageHtml(4000));
	try {
		const result = await callFetchUrl({url: 'https://pages.example.test/note'});
		const note = result.match(NOTE);
		t.truthy(note, result.slice(-200));
		// The formatter finds the note by this prefix, so it has to stay.
		t.true(result.includes('[Content truncated'));
		t.is(Number(note![1]), 0);
		t.is(Number(note![2]), PAGE_LIMIT);
		t.is(Number(note![4]), PAGE_LIMIT);
		t.true(Number(note![3]) > PAGE_LIMIT);
	} finally {
		server.restore();
	}
});

test.serial('a page that fits is returned whole, with no note', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}

	const server = servePages('<html><body><h1>Short page</h1></body></html>');
	try {
		const result = await callFetchUrl({url: 'https://pages.example.test/short'});
		t.regex(result, /Short page/);
		t.notRegex(result, /Content truncated/);
	} finally {
		server.restore();
	}
});

test.serial('max_length shortens the window and still points onward', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}

	const server = servePages(longPageHtml(500));
	try {
		const result = await callFetchUrl({
			url: 'https://pages.example.test/max-length',
			max_length: 1000,
		});
		const note = result.match(NOTE);
		t.truthy(note);
		t.is(result.slice(0, note!.index).length, 1000);
		t.is(Number(note![4]), 1000);
	} finally {
		server.restore();
	}
});

test.serial('max_length cannot exceed the hard limit', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}

	const server = servePages(longPageHtml(4000));
	try {
		const result = await callFetchUrl({
			url: 'https://pages.example.test/max-cap',
			max_length: 10_000_000,
		});
		const note = result.match(NOTE);
		t.truthy(note);
		t.is(result.slice(0, note!.index).length, PAGE_LIMIT);
	} finally {
		server.restore();
	}
});

test.serial('unusable start_index and max_length fall back to the defaults', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}

	const server = servePages(longPageHtml(4000));
	try {
		const url = 'https://pages.example.test/bad-args';
		const defaults = await callFetchUrl({url});
		for (const args of [
			{start_index: -5},
			{start_index: Number.NaN},
			{max_length: 0},
			{max_length: -1},
			{max_length: Number.NaN},
		]) {
			t.is(
				await callFetchUrl({url, ...args}),
				defaults,
				`${JSON.stringify(args)} should behave like no argument`,
			);
		}
		// A model that sends numbers as strings still gets the window it meant.
		const result = await callFetchUrl({
			url,
			max_length: '50' as unknown as number,
		});
		t.is(result.match(NOTE) ? result.slice(0, result.match(NOTE)!.index).length : -1, 50);
	} finally {
		server.restore();
	}
});

test.serial('a start_index past the end explains itself instead of failing', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}

	const server = servePages('<html><body><h1>Short page</h1></body></html>');
	try {
		const result = await callFetchUrl({
			url: 'https://pages.example.test/past-end',
			start_index: 99_999,
		});
		t.regex(result, /start_index 99999 is past the end of the content/);
		t.regex(result, /characters long/);
	} finally {
		server.restore();
	}
});

test.serial('a window never splits a surrogate pair at either edge', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}

	// Every character is two UTF-16 units, so any odd offset is mid-pair.
	const server = servePages(
		`<html><body><p>${'😀'.repeat(50)}</p></body></html>`,
	);
	try {
		const url = 'https://pages.example.test/emoji';
		const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

		// The converter adds front matter, so find where the emoji begin.
		const whole = await callFetchUrl({url});
		const at = whole.indexOf('😀');
		t.true(at >= 0);

		// The end of a window of 5 units lands inside the third emoji.
		const first = await callFetchUrl({url, start_index: at, max_length: 5});
		const note = first.match(NOTE);
		t.truthy(note);
		const body = first.slice(0, note!.index);
		t.is(body, '😀😀');
		t.notRegex(body, lone);
		t.is(Number(note![4]), at + 4);

		// A start_index inside a pair reads from the start of that pair.
		const second = await callFetchUrl({
			url,
			start_index: at + 1,
			max_length: 4,
		});
		t.notRegex(second.replace(NOTE, ''), lone);
		t.true(second.startsWith('😀'));

		// A window too small for a pair still returns the pair, not nothing.
		const tiny = await callFetchUrl({url, start_index: at, max_length: 1});
		t.true(tiny.startsWith('😀'));
		t.notRegex(tiny.replace(NOTE, ''), lone);
	} finally {
		server.restore();
	}
});

test.serial('paging the same URL converts the page once', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}

	const server = servePages(longPageHtml(4000));
	try {
		const url = 'https://pages.example.test/cache-hit';
		await callFetchUrl({url});
		t.is(server.requests.get, 1);
		const probesAfterFirst = server.requests.head;

		const second = await callFetchUrl({url, start_index: PAGE_LIMIT});
		t.true(second.includes('entry-'));
		// The conversion is saved; the address walk is not.
		t.is(server.requests.get, 1);
		t.true(server.requests.head > probesAfterFirst);
	} finally {
		server.restore();
	}
});

test.serial('a cached page is fetched again once it has expired', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}

	const server = servePages(longPageHtml(500));
	const realNow = Date.now;
	try {
		const url = 'https://pages.example.test/cache-expiry';
		await callFetchUrl({url});
		t.is(server.requests.get, 1);

		Date.now = () => realNow() + 89_000;
		await callFetchUrl({url, start_index: 10});
		t.is(server.requests.get, 1, 'still fresh inside the TTL');

		Date.now = () => realNow() + 91_000;
		await callFetchUrl({url, start_index: 10});
		t.is(server.requests.get, 2, 'expired entries are fetched again');
	} finally {
		Date.now = realNow;
		server.restore();
	}
});

test.serial('the cache keeps only the most recent pages', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}

	const server = servePages(longPageHtml(500));
	try {
		const urls = Array.from(
			{length: 6},
			(_, i) => `https://pages.example.test/evict-${i}`,
		);
		for (const url of urls) {
			await callFetchUrl({url});
		}
		t.is(server.requests.get, 6);

		// The newest are still cached; the oldest was pushed out.
		await callFetchUrl({url: urls[5]!, start_index: 10});
		t.is(server.requests.get, 6);
		await callFetchUrl({url: urls[0]!, start_index: 10});
		t.is(server.requests.get, 7);
	} finally {
		server.restore();
	}
});

test.serial('a cached page is still checked against the address guard', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}

	const {hostResolver} = await import('./fetch-url-guard.js');
	const originalResolve = hostResolver.resolve;
	const server = servePages(longPageHtml(500));
	try {
		const url = 'https://pages.example.test/cache-guard';
		await callFetchUrl({url});
		const afterFirst = {...server.requests};

		// The name now resolves somewhere internal. The cache must not let a
		// call through that a fresh fetch would have refused.
		hostResolver.resolve = async () => ['127.0.0.1'];
		await t.throwsAsync(() => callFetchUrl({url, start_index: 10}), {
			message: /internal\/private network/,
		});
		// Refused on the address alone, before anything was requested.
		t.deepEqual(server.requests, afterFirst);
	} finally {
		hostResolver.resolve = originalResolve;
		server.restore();
	}
});

test('formatter shows the window that was returned', t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	const result =
		'x'.repeat(1000) +
		'\n\n[Content truncated - showing characters 100000-200000 of 482113. Call fetch_url again with start_index=200000 to continue.]';

	const {lastFrame} = render(
		<MockThemeProvider>
			{fetchUrlTool.formatter!({url: 'https://large-content.com'}, result)}
		</MockThemeProvider>,
	);

	t.true(lastFrame()!.includes('Showing characters 100,000-200,000 of 482,113'));
});

test('formatter shows no warning for the last window of a page', t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}

	const {lastFrame} = render(
		<MockThemeProvider>
			{fetchUrlTool.formatter!(
				{url: 'https://large-content.com', start_index: 400000},
				'the tail of a long page',
			)}
		</MockThemeProvider>,
	);

	t.notRegex(lastFrame()!, /Showing characters/);
	t.notRegex(lastFrame()!, /truncated/);
});

test('the schema offers start_index and max_length without requiring them', t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}
	const schema = (
		fetchUrlTool.tool.inputSchema as unknown as {
			jsonSchema: {properties: Record<string, {type: string}>; required: string[]};
		}
	).jsonSchema;
	t.is(schema.properties.start_index?.type, 'number');
	t.is(schema.properties.max_length?.type, 'number');
	t.deepEqual(schema.required, ['url']);
});

test.serial(
	'a cached page is refused once its redirect points somewhere internal',
	async t => {
		if (!fetchUrlTool) {
			t.pass('Skipping test - fetch-url module not available');
			return;
		}

		const originalFetch = globalThis.fetch;
		let redirectTo = 'https://pages.example.test/public-target';
		globalThis.fetch = async (input, init) => {
			const url = String(input);
			if (url === 'https://pages.example.test/entry') {
				return new Response(null, {
					status: 302,
					headers: {location: redirectTo},
				});
			}
			if ((init?.method as string | undefined) === 'HEAD') {
				return new Response(null, {status: 200});
			}
			return new Response(longPageHtml(500), {
				status: 200,
				headers: {'content-type': 'text/html'},
			});
		};

		try {
			const url = 'https://pages.example.test/entry';
			const first = await callFetchUrl({url});
			t.true(first.includes('entry-'));

			// Same URL, but the chain now ends at a private address. The page
			// it used to reach is cached; that must not matter.
			redirectTo = 'http://127.0.0.1:8080/internal';
			await t.throwsAsync(() => callFetchUrl({url, start_index: 10}), {
				message: /internal\/private network/,
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	},
);

test.serial('the cache belongs to the address the redirects reached', async t => {
	if (!fetchUrlTool) {
		t.pass('Skipping test - fetch-url module not available');
		return;
	}

	const originalFetch = globalThis.fetch;
	let redirectTo = 'https://pages.example.test/first-target';
	let conversions = 0;
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		if (url === 'https://pages.example.test/moving') {
			return new Response(null, {
				status: 302,
				headers: {location: redirectTo},
			});
		}
		if ((init?.method as string | undefined) === 'HEAD') {
			return new Response(null, {status: 200});
		}
		conversions++;
		return new Response(`<html><body><h1>page at ${url}</h1></body></html>`, {
			status: 200,
			headers: {'content-type': 'text/html'},
		});
	};

	try {
		const url = 'https://pages.example.test/moving';
		t.regex(await callFetchUrl({url}), /first-target/);
		t.is(conversions, 1);

		// Reading it again serves the cached conversion.
		t.regex(await callFetchUrl({url}), /first-target/);
		t.is(conversions, 1);

		// The chain now ends elsewhere, so that page is fetched instead of the
		// one cached for the old destination.
		redirectTo = 'https://pages.example.test/second-target';
		t.regex(await callFetchUrl({url}), /second-target/);
		t.is(conversions, 2);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
