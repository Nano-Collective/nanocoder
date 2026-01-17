import test from 'ava';
import {fetchLocalModels} from './fetch-local-models.js';

// Store original fetch for restoration
const originalFetch = globalThis.fetch;

// Helper to create Ollama-style response
function createOllamaResponse(models: string[]) {
	return {models: models.map(name => ({name}))};
}

// Helper to create OpenAI-compatible response
function createOpenAIResponse(models: string[]) {
	return {data: models.map(id => ({id}))};
}

// Helper to create a mock fetch that captures the request
function createMockFetch(response: unknown, options: {ok?: boolean; status?: number; statusText?: string} = {}) {
	const {ok = true, status = 200, statusText = 'OK'} = options;
	let capturedUrl: string | undefined;
	let capturedOptions: RequestInit | undefined;

	const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
		capturedUrl = url.toString();
		capturedOptions = init;
		return {
			ok,
			status,
			statusText,
			json: async () => response,
		} as Response;
	};

	return {mockFetch, getCapturedUrl: () => capturedUrl, getCapturedOptions: () => capturedOptions};
}

// Ollama tests
test.serial('fetchLocalModels: Ollama - successful fetch returns models', async t => {
	const {mockFetch} = createMockFetch(createOllamaResponse(['llama3:8b', 'mistral:7b']));
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchLocalModels('http://localhost:11434', 'ollama');
		t.true(result.success);
		t.is(result.models.length, 2);
		t.is(result.error, undefined);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchLocalModels: Ollama - uses correct endpoint /api/tags', async t => {
	const {mockFetch, getCapturedUrl} = createMockFetch(createOllamaResponse(['model1']));
	globalThis.fetch = mockFetch;

	try {
		await fetchLocalModels('http://localhost:11434', 'ollama');
		t.is(getCapturedUrl(), 'http://localhost:11434/api/tags');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchLocalModels: Ollama - strips /v1 suffix before building endpoint', async t => {
	const {mockFetch, getCapturedUrl} = createMockFetch(createOllamaResponse(['model1']));
	globalThis.fetch = mockFetch;

	try {
		await fetchLocalModels('http://localhost:11434/v1', 'ollama');
		t.is(getCapturedUrl(), 'http://localhost:11434/api/tags');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

// OpenAI-compatible tests
test.serial('fetchLocalModels: OpenAI-compatible - successful fetch returns models', async t => {
	const {mockFetch} = createMockFetch(createOpenAIResponse(['gpt-4', 'gpt-3.5-turbo']));
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchLocalModels('http://localhost:1234/v1', 'openai-compatible');
		t.true(result.success);
		t.is(result.models.length, 2);
		t.is(result.error, undefined);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchLocalModels: OpenAI-compatible - uses /v1/models endpoint when /v1 present', async t => {
	const {mockFetch, getCapturedUrl} = createMockFetch(createOpenAIResponse(['model1']));
	globalThis.fetch = mockFetch;

	try {
		await fetchLocalModels('http://localhost:1234/v1', 'openai-compatible');
		t.is(getCapturedUrl(), 'http://localhost:1234/v1/models');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchLocalModels: OpenAI-compatible - appends /v1/models when no /v1 in path', async t => {
	const {mockFetch, getCapturedUrl} = createMockFetch(createOpenAIResponse(['model1']));
	globalThis.fetch = mockFetch;

	try {
		await fetchLocalModels('http://localhost:1234', 'openai-compatible');
		t.is(getCapturedUrl(), 'http://localhost:1234/v1/models');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchLocalModels: OpenAI-compatible - handles /v1/ in middle of path', async t => {
	const {mockFetch, getCapturedUrl} = createMockFetch(createOpenAIResponse(['model1']));
	globalThis.fetch = mockFetch;

	try {
		await fetchLocalModels('http://localhost:1234/v1/chat', 'openai-compatible');
		t.is(getCapturedUrl(), 'http://localhost:1234/v1/models');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

// URL normalization tests
test.serial('fetchLocalModels: removes trailing slash from URL', async t => {
	const {mockFetch, getCapturedUrl} = createMockFetch(createOllamaResponse(['model1']));
	globalThis.fetch = mockFetch;

	try {
		await fetchLocalModels('http://localhost:11434/', 'ollama');
		t.is(getCapturedUrl(), 'http://localhost:11434/api/tags');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

// Error handling tests
test.serial('fetchLocalModels: returns error on server error response', async t => {
	const {mockFetch} = createMockFetch({}, {ok: false, status: 500, statusText: 'Internal Server Error'});
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchLocalModels('http://localhost:11434', 'ollama');
		t.false(result.success);
		t.is(result.models.length, 0);
		t.is(result.error, 'Server returned 500: Internal Server Error');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchLocalModels: returns error when no models found', async t => {
	const {mockFetch} = createMockFetch(createOllamaResponse([]));
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchLocalModels('http://localhost:11434', 'ollama');
		t.false(result.success);
		t.is(result.models.length, 0);
		t.is(result.error, 'No models found on the server');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchLocalModels: handles network error', async t => {
	globalThis.fetch = async () => {
		throw new Error('Network error');
	};

	try {
		const result = await fetchLocalModels('http://localhost:11434', 'ollama');
		t.false(result.success);
		t.is(result.models.length, 0);
		t.is(result.error, 'Network error');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchLocalModels: handles timeout (AbortError)', async t => {
	globalThis.fetch = async () => {
		const error = new Error('The operation was aborted');
		error.name = 'AbortError';
		throw error;
	};

	try {
		const result = await fetchLocalModels('http://localhost:11434', 'ollama');
		t.false(result.success);
		t.is(result.models.length, 0);
		t.is(result.error, 'Connection timed out');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchLocalModels: handles unknown error type', async t => {
	globalThis.fetch = async () => {
		throw 'string error'; // Non-Error thrown
	};

	try {
		const result = await fetchLocalModels('http://localhost:11434', 'ollama');
		t.false(result.success);
		t.is(result.models.length, 0);
		t.is(result.error, 'Unknown error occurred');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

// Data validation tests
test.serial('fetchLocalModels: filters out invalid Ollama model entries', async t => {
	const invalidResponse = {
		models: [
			{name: 'valid-model'},
			{name: ''}, // Empty name
			{name: '   '}, // Whitespace only
			{}, // Missing name
			null, // Null entry
			{name: 'another-valid'},
		],
	};
	const {mockFetch} = createMockFetch(invalidResponse);
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchLocalModels('http://localhost:11434', 'ollama');
		t.true(result.success);
		t.is(result.models.length, 2);
		t.is(result.models[0]?.id, 'another-valid');
		t.is(result.models[1]?.id, 'valid-model');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchLocalModels: filters out invalid OpenAI-compatible model entries', async t => {
	const invalidResponse = {
		data: [
			{id: 'valid-model'},
			{id: ''}, // Empty id
			{id: '   '}, // Whitespace only
			{}, // Missing id
			null, // Null entry
			{id: 'another-valid'},
		],
	};
	const {mockFetch} = createMockFetch(invalidResponse);
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchLocalModels('http://localhost:1234/v1', 'openai-compatible');
		t.true(result.success);
		t.is(result.models.length, 2);
		t.is(result.models[0]?.id, 'another-valid');
		t.is(result.models[1]?.id, 'valid-model');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

// Sorting test
test.serial('fetchLocalModels: returns models sorted alphabetically', async t => {
	const {mockFetch} = createMockFetch(createOllamaResponse(['zebra', 'alpha', 'mango']));
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchLocalModels('http://localhost:11434', 'ollama');
		t.true(result.success);
		t.is(result.models.length, 3);
		t.is(result.models[0]?.name, 'alpha');
		t.is(result.models[1]?.name, 'mango');
		t.is(result.models[2]?.name, 'zebra');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

// Whitespace trimming test
test.serial('fetchLocalModels: trims whitespace from model names', async t => {
	const {mockFetch} = createMockFetch(createOllamaResponse(['  model-with-spaces  ']));
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchLocalModels('http://localhost:11434', 'ollama');
		t.true(result.success);
		t.is(result.models[0]?.id, 'model-with-spaces');
		t.is(result.models[0]?.name, 'model-with-spaces');
	} finally {
		globalThis.fetch = originalFetch;
	}
});
