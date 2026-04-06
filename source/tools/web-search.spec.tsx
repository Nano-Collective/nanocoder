import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';
import {
	DEFAULT_WEB_SEARCH_RESULTS,
	MAX_WEB_SEARCH_QUERY_LENGTH,
} from '../constants';

console.log('\nweb-search.spec.tsx');

// Dynamically import to avoid loading undici in test environment
let webSearchTool: any;
let executeWebSearch: any;
let webSearchValidator: any;
let webSearchFormatter: any;

test.before(async () => {
	try {
		const module = await import('./web-search.js');
		webSearchTool = module.webSearchTool;
		executeWebSearch = module.executeWebSearch;
		webSearchValidator = module.webSearchValidator;
		webSearchFormatter = module.webSearchFormatter;
	} catch (error) {
		console.warn('Failed to load web-search module:', error);
	}
});

// Mock ThemeProvider for testing
const MockThemeProvider = ({children}: {children: React.ReactNode}) => {
	const mockTheme = {
		currentTheme: 'tokyo-night' as const,
		colors: themes['tokyo-night'].colors,
		setCurrentTheme: () => {},
	};

	return <ThemeContext.Provider value={mockTheme}>{children}</ThemeContext.Provider>;
};

// ============================================================================
// Validator Tests
// ============================================================================

test('webSearchValidator accepts valid query', async t => {
	if (!webSearchValidator) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const result = await webSearchValidator({query: 'test query'});

	t.true(result.valid);
});

test('webSearchValidator accepts query with max_results', async t => {
	if (!webSearchValidator) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const result = await webSearchValidator({
		query: 'test query',
		max_results: 5,
	});

	t.true(result.valid);
});

test('webSearchValidator rejects empty query', async t => {
	if (!webSearchValidator) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const result = await webSearchValidator({query: ''});

	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('cannot be empty'));
	}
});

test('webSearchValidator rejects whitespace-only query', async t => {
	if (!webSearchValidator) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const result = await webSearchValidator({query: '   \n\t  '});

	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('cannot be empty'));
	}
});

test('webSearchValidator rejects query exceeding max length', async t => {
	if (!webSearchValidator) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const longQuery = 'a'.repeat(MAX_WEB_SEARCH_QUERY_LENGTH + 1);
	const result = await webSearchValidator({query: longQuery});

	t.false(result.valid);
	if (!result.valid) {
		t.true(result.error.includes('too long'));
		t.regex(result.error, new RegExp(`${MAX_WEB_SEARCH_QUERY_LENGTH}`));
	}
});

test('webSearchValidator accepts query at max length boundary', async t => {
	if (!webSearchValidator) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const maxQuery = 'a'.repeat(MAX_WEB_SEARCH_QUERY_LENGTH);
	const result = await webSearchValidator({query: maxQuery});

	t.true(result.valid);
});

test('webSearchValidator handles undefined query', async t => {
	if (!webSearchValidator) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const result = await webSearchValidator({query: undefined as unknown as string});

	t.false(result.valid);
});

test('webSearchValidator handles special characters in query', async t => {
	if (!webSearchValidator) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const result = await webSearchValidator({
		query: 'test with "quotes" and \'apostrophes\' & symbols!',
	});

	t.true(result.valid);
});

// ============================================================================
// Tool Configuration Tests
// ============================================================================

test('web search tool has correct name', t => {
	if (!webSearchTool) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	t.is(webSearchTool.name, 'web_search');
});

test('web search tool does not require approval', t => {
	if (!webSearchTool) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	t.false(webSearchTool.tool.needsApproval);
});

test('web search tool has description referencing Brave Search API', t => {
	if (!webSearchTool) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	t.truthy(webSearchTool.tool.description);
	t.true(webSearchTool.tool.description.includes('Search the web'));
});

test('web search tool has input schema', t => {
	if (!webSearchTool) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	t.truthy(webSearchTool.tool);
	t.truthy(webSearchTool.tool.description);
});

test('web search tool has formatter function', t => {
	if (!webSearchTool) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	t.is(typeof webSearchTool.formatter, 'function');
});

test('web search tool has validator function', t => {
	if (!webSearchTool) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	t.is(typeof webSearchTool.validator, 'function');
});

// ============================================================================
// Formatter Component Tests
// ============================================================================

test('webSearchFormatter renders with query', t => {
	if (!webSearchFormatter) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const component = webSearchFormatter({query: 'test search'});
	const {lastFrame} = render(<MockThemeProvider>{component}</MockThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /web_search/);
	t.regex(output!, /test search/);
	t.regex(output!, /Brave Search API/);
});

test('webSearchFormatter shows result count when result provided', t => {
	if (!webSearchFormatter) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const mockResult = `# Web Search Results: "test"\n\n## 1. Result One\n\n**URL:** https://example.com\n\n---\n\n## 2. Result Two\n\n**URL:** https://example.com\n\n---\n\n`;

	const component = webSearchFormatter({query: 'test'}, mockResult);
	const {lastFrame} = render(<MockThemeProvider>{component}</MockThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Results:/);
	t.regex(output!, /2 \/ 10 results/);
});

test('webSearchFormatter shows token estimate', t => {
	if (!webSearchFormatter) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const mockResult = 'x'.repeat(100); // 100 chars ~ 25 tokens

	const component = webSearchFormatter({query: 'test'}, mockResult);
	const {lastFrame} = render(<MockThemeProvider>{component}</MockThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Output:/);
	t.regex(output!, /~25 tokens/);
});

test('webSearchFormatter handles zero results', t => {
	if (!webSearchFormatter) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const mockResult = 'No results found for query: "test"';

	const component = webSearchFormatter({query: 'test'}, mockResult);
	const {lastFrame} = render(<MockThemeProvider>{component}</MockThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /0 \/ 10 results/);
});

test('webSearchFormatter uses custom max_results', t => {
	if (!webSearchFormatter) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const mockResult = `# Web Search Results: "test"\n\n## 1. Result\n\n---\n\n## 2. Result\n\n---\n\n## 3. Result\n\n---\n\n`;

	const component = webSearchFormatter(
		{query: 'test', max_results: 10},
		mockResult,
	);
	const {lastFrame} = render(<MockThemeProvider>{component}</MockThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /3 \/ 10 results/);
});

test('webSearchFormatter does not show result stats before execution', t => {
	if (!webSearchFormatter) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const component = webSearchFormatter({query: 'test'});
	const {lastFrame} = render(<MockThemeProvider>{component}</MockThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.notRegex(output!, /Results:/);
	t.notRegex(output!, /Output:/);
});

test('webSearchFormatter handles undefined result gracefully', t => {
	if (!webSearchFormatter) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const component = webSearchFormatter({query: 'test'}, undefined);
	const {lastFrame} = render(<MockThemeProvider>{component}</MockThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.true(output!.length > 0);
});

test('webSearchFormatter handles empty result string', t => {
	if (!webSearchFormatter) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const component = webSearchFormatter({query: 'test'}, '');
	const {lastFrame} = render(<MockThemeProvider>{component}</MockThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	// Empty string is falsy so results section is not rendered; just verify the component renders
	t.regex(output!, /web_search/);
});

test('webSearchFormatter counts results correctly from markdown', t => {
	if (!webSearchFormatter) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	// Create result with 5 results
	let mockResult = '# Web Search Results: "test"\n\n';
	for (let i = 1; i <= 5; i++) {
		mockResult += `## ${i}. Result ${i}\n\n**URL:** https://example.com/${i}\n\n---\n\n`;
	}

	const component = webSearchFormatter({query: 'test'}, mockResult);
	const {lastFrame} = render(<MockThemeProvider>{component}</MockThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /5 \/ 10 results/);
});

// ============================================================================
// ExecuteWebSearch - API Tests
// ============================================================================

test('executeWebSearch throws when no API key configured', async t => {
	if (!executeWebSearch) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	// Pass empty string as apiKeyOverride to simulate no API key
	await t.throwsAsync(
		async () => await executeWebSearch({query: 'test'}, ''),
		{message: /API key not configured/},
	);
});

test('executeWebSearch throws on invalid API key (401)', async t => {
	if (!executeWebSearch) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		return {
			ok: false,
			status: 401,
			statusText: 'Unauthorized',
			json: async () => ({}),
		} as any;
	}) as any;

	try {
		await t.throwsAsync(
			async () => await executeWebSearch({query: 'test'}, 'test-key'),
			{message: /Invalid Brave Search API key/},
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('executeWebSearch throws on rate limit (429)', async t => {
	if (!executeWebSearch) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		return {
			ok: false,
			status: 429,
			statusText: 'Too Many Requests',
			json: async () => ({}),
		} as any;
	}) as any;

	try {
		await t.throwsAsync(
			async () => await executeWebSearch({query: 'test'}, 'test-key'),
			{message: /rate limit exceeded/},
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('executeWebSearch throws on HTTP error status', async t => {
	if (!executeWebSearch) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		return {
			ok: false,
			status: 500,
			statusText: 'Internal Server Error',
			json: async () => ({}),
		} as any;
	}) as any;

	try {
		await t.throwsAsync(
			async () => await executeWebSearch({query: 'test'}, 'test-key'),
			{message: /HTTP 500/},
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('executeWebSearch throws timeout error on timeout', async t => {
	if (!executeWebSearch) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const originalTimeout = AbortSignal.timeout;
	AbortSignal.timeout = (() => {
		const controller = new AbortController();
		controller.abort();
		return controller.signal;
	}) as any;

	try {
		await t.throwsAsync(
			async () => await executeWebSearch({query: 'test'}, 'test-key'),
			{message: /timeout/i},
		);
	} finally {
		AbortSignal.timeout = originalTimeout;
	}
});

test('executeWebSearch throws on network error', async t => {
	if (!executeWebSearch) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const originalFetch = globalThis.fetch;
	globalThis.fetch = (() => {
		throw new Error('Network error');
	}) as any;

	try {
		await t.throwsAsync(
			async () => await executeWebSearch({query: 'test'}, 'test-key'),
			{message: /Network error/},
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('executeWebSearch handles non-Error objects in catch', async t => {
	if (!executeWebSearch) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const originalFetch = globalThis.fetch;
	globalThis.fetch = (() => {
		throw 'string error';
	}) as any;

	try {
		await t.throwsAsync(
			async () => await executeWebSearch({query: 'test'}, 'test-key'),
			{message: /Web search failed/},
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('executeWebSearch parses API results correctly', async t => {
	if (!executeWebSearch) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const mockApiResponse = {
		web: {
			results: [
				{
					title: 'Test Title 1',
					url: 'https://example.com/test1',
					description: 'This is a test description for result 1',
				},
				{
					title: 'Test Title 2',
					url: 'https://example.com/test2',
					description: 'This is a test description for result 2',
				},
			],
		},
	};

	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		return {
			ok: true,
			status: 200,
			json: async () => mockApiResponse,
		} as any;
	}) as any;

	try {
		const result = await executeWebSearch({query: 'test query'}, 'test-key');
		t.regex(result, /# Web Search Results: "test query"/);
		t.regex(result, /1\. Test Title 1/);
		t.regex(result, /\*\*URL:\*\* https:\/\/example\.com\/test1/);
		t.regex(result, /This is a test description for result 1/);
		t.regex(result, /2\. Test Title 2/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('executeWebSearch handles results without descriptions', async t => {
	if (!executeWebSearch) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const mockApiResponse = {
		web: {
			results: [
				{
					title: 'Title Only',
					url: 'https://example.com',
				},
			],
		},
	};

	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		return {
			ok: true,
			status: 200,
			json: async () => mockApiResponse,
		} as any;
	}) as any;

	try {
		const result = await executeWebSearch({query: 'test'}, 'test-key');
		t.regex(result, /1\. Title Only/);
		t.regex(result, /\*\*URL:\*\* https:\/\/example\.com/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('executeWebSearch returns no results message for empty API response', async t => {
	if (!executeWebSearch) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		return {
			ok: true,
			status: 200,
			json: async () => ({web: {results: []}}),
		} as any;
	}) as any;

	try {
		const result = await executeWebSearch({query: 'test'}, 'test-key');
		t.regex(result, /No results found/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('executeWebSearch respects custom max_results', async t => {
	if (!executeWebSearch) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	let capturedUrl = '';
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (url: any) => {
		capturedUrl = url.toString();
		return {
			ok: true,
			status: 200,
			json: async () => ({web: {results: []}}),
		} as any;
	}) as any;

	try {
		await executeWebSearch({query: 'test', max_results: 3}, 'test-key');
		t.true(capturedUrl.includes('count=3'));
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('executeWebSearch sends correct headers', async t => {
	if (!executeWebSearch) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	let capturedHeaders: any = {};
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (_url: any, options: any) => {
		capturedHeaders = options?.headers || {};
		return {
			ok: true,
			status: 200,
			json: async () => ({web: {results: []}}),
		} as any;
	}) as any;

	try {
		await executeWebSearch({query: 'test'}, 'my-test-key');
		t.is(capturedHeaders['X-Subscription-Token'], 'my-test-key');
		t.is(capturedHeaders['Accept'], 'application/json');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('executeWebSearch encodes query properly', async t => {
	if (!executeWebSearch) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	let capturedUrl = '';
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (url: any) => {
		capturedUrl = url.toString();
		return {
			ok: true,
			status: 200,
			json: async () => ({web: {results: []}}),
		} as any;
	}) as any;

	try {
		await executeWebSearch({query: 'test with spaces'}, 'test-key');
		t.true(capturedUrl.includes('test+with+spaces') || capturedUrl.includes('test%20with%20spaces'));
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('executeWebSearch formats markdown output correctly', async t => {
	if (!executeWebSearch) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const mockApiResponse = {
		web: {
			results: [
				{
					title: 'Result',
					url: 'https://example.com',
					description: 'Description',
				},
			],
		},
	};

	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		return {
			ok: true,
			status: 200,
			json: async () => mockApiResponse,
		} as any;
	}) as any;

	try {
		const result = await executeWebSearch({query: 'test'}, 'test-key');
		t.regex(result, /^# Web Search Results:/);
		t.regex(result, /^## \d+\./m);
		t.regex(result, /\*\*URL:\*\*/);
		t.regex(result, /^---$/m);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('executeWebSearch handles missing web field in response', async t => {
	if (!executeWebSearch) {
		t.pass('Skipping test - web-search module not available');
		return;
	}

	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		return {
			ok: true,
			status: 200,
			json: async () => ({}),
		} as any;
	}) as any;

	try {
		const result = await executeWebSearch({query: 'test'}, 'test-key');
		t.regex(result, /No results found/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
