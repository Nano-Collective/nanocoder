import test from 'ava';
import {fetchCloudModels} from './fetch-cloud-models.js';

// Store original fetch for restoration
const originalFetch = globalThis.fetch;

// Helper to create standard cloud models response (Anthropic, OpenAI, Mistral)
function createCloudModelsResponse(
	models: Array<{id: string; name?: string; display_name?: string}>,
) {
	return {data: models};
}

// Helper to create GitHub-style response (direct array)
function createGitHubResponse(models: Array<{id: string; name: string}>) {
	return models;
}

// Helper to create a mock fetch that captures the request
function createMockFetch(
	response: unknown,
	options: {ok?: boolean; status?: number; statusText?: string} = {},
) {
	const {ok = true, status = 200, statusText = 'OK'} = options;
	let capturedUrl: string | undefined;
	let capturedHeaders: Record<string, string> | undefined;

	const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
		capturedUrl = url.toString();
		capturedHeaders = init?.headers as Record<string, string>;
		return {
			ok,
			status,
			statusText,
			json: async () => response,
		} as Response;
	};

	return {
		mockFetch,
		getCapturedUrl: () => capturedUrl,
		getCapturedHeaders: () => capturedHeaders,
	};
}

// Anthropic tests
test.serial('fetchCloudModels: Anthropic - successful fetch returns models', async t => {
	const response = createCloudModelsResponse([
		{id: 'claude-3-opus', display_name: 'Claude 3 Opus'},
		{id: 'claude-3-sonnet', display_name: 'Claude 3 Sonnet'},
	]);
	const {mockFetch} = createMockFetch(response);
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchCloudModels('anthropic', 'sk-ant-test-key');
		t.true(result.success);
		t.is(result.models.length, 2);
		t.is(result.error, undefined);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchCloudModels: Anthropic - uses correct endpoint and headers', async t => {
	const {mockFetch, getCapturedUrl, getCapturedHeaders} = createMockFetch(
		createCloudModelsResponse([{id: 'model1'}]),
	);
	globalThis.fetch = mockFetch;

	try {
		await fetchCloudModels('anthropic', 'sk-ant-test-key');
		t.is(getCapturedUrl(), 'https://api.anthropic.com/v1/models');
		t.is(getCapturedHeaders()?.['X-Api-Key'], 'sk-ant-test-key');
		t.is(getCapturedHeaders()?.['anthropic-version'], '2023-06-01');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchCloudModels: Anthropic - uses display_name for model name', async t => {
	const response = createCloudModelsResponse([
		{id: 'claude-3-opus-20240229', display_name: 'Claude 3 Opus'},
	]);
	const {mockFetch} = createMockFetch(response);
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchCloudModels('anthropic', 'sk-ant-test-key');
		t.true(result.success);
		t.is(result.models[0]?.id, 'claude-3-opus-20240229');
		t.is(result.models[0]?.name, 'Claude 3 Opus');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

// OpenAI tests
test.serial('fetchCloudModels: OpenAI - successful fetch returns models', async t => {
	const response = createCloudModelsResponse([
		{id: 'gpt-4'},
		{id: 'gpt-3.5-turbo'},
	]);
	const {mockFetch} = createMockFetch(response);
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchCloudModels('openai', 'sk-test-key');
		t.true(result.success);
		t.is(result.models.length, 2);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchCloudModels: OpenAI - uses correct endpoint and Bearer auth', async t => {
	const {mockFetch, getCapturedUrl, getCapturedHeaders} = createMockFetch(
		createCloudModelsResponse([{id: 'model1'}]),
	);
	globalThis.fetch = mockFetch;

	try {
		await fetchCloudModels('openai', 'sk-test-key');
		t.is(getCapturedUrl(), 'https://api.openai.com/v1/models');
		t.is(getCapturedHeaders()?.Authorization, 'Bearer sk-test-key');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

// Mistral tests
test.serial('fetchCloudModels: Mistral - successful fetch returns models', async t => {
	const response = createCloudModelsResponse([
		{id: 'mistral-large'},
		{id: 'mistral-small'},
	]);
	const {mockFetch} = createMockFetch(response);
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchCloudModels('mistral', 'test-api-key');
		t.true(result.success);
		t.is(result.models.length, 2);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchCloudModels: Mistral - uses correct endpoint and Bearer auth', async t => {
	const {mockFetch, getCapturedUrl, getCapturedHeaders} = createMockFetch(
		createCloudModelsResponse([{id: 'model1'}]),
	);
	globalThis.fetch = mockFetch;

	try {
		await fetchCloudModels('mistral', 'test-api-key');
		t.is(getCapturedUrl(), 'https://api.mistral.ai/v1/models');
		t.is(getCapturedHeaders()?.Authorization, 'Bearer test-api-key');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

// GitHub tests
test.serial('fetchCloudModels: GitHub - successful fetch returns models', async t => {
	const response = createGitHubResponse([
		{id: 'gpt-4o', name: 'GPT-4o'},
		{id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet'},
	]);
	const {mockFetch} = createMockFetch(response);
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchCloudModels('github', 'ghp_test-token');
		t.true(result.success);
		t.is(result.models.length, 2);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchCloudModels: GitHub - uses correct endpoint and headers', async t => {
	const {mockFetch, getCapturedUrl, getCapturedHeaders} = createMockFetch(
		createGitHubResponse([{id: 'model1', name: 'Model 1'}]),
	);
	globalThis.fetch = mockFetch;

	try {
		await fetchCloudModels('github', 'ghp_test-token');
		t.is(getCapturedUrl(), 'https://models.github.ai/catalog/models');
		t.is(getCapturedHeaders()?.Authorization, 'Bearer ghp_test-token');
		t.is(getCapturedHeaders()?.['X-GitHub-Api-Version'], '2022-11-28');
		t.is(getCapturedHeaders()?.Accept, 'application/vnd.github+json');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchCloudModels: GitHub - uses name field for model name', async t => {
	const response = createGitHubResponse([{id: 'gpt-4o', name: 'GPT-4o'}]);
	const {mockFetch} = createMockFetch(response);
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchCloudModels('github', 'ghp_test-token');
		t.true(result.success);
		t.is(result.models[0]?.id, 'gpt-4o');
		t.is(result.models[0]?.name, 'GPT-4o');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

// Input validation tests
test.serial('fetchCloudModels: returns error for empty API key', async t => {
	const result = await fetchCloudModels('openai', '');
	t.false(result.success);
	t.is(result.models.length, 0);
	t.is(result.error, 'API key is required');
});

test.serial('fetchCloudModels: returns error for whitespace-only API key', async t => {
	const result = await fetchCloudModels('openai', '   ');
	t.false(result.success);
	t.is(result.models.length, 0);
	t.is(result.error, 'API key is required');
});

test.serial('fetchCloudModels: returns error for unknown provider', async t => {
	// @ts-expect-error Testing invalid provider type
	const result = await fetchCloudModels('unknown-provider', 'api-key');
	t.false(result.success);
	t.is(result.models.length, 0);
	t.is(result.error, 'Unknown cloud provider: unknown-provider');
});

// HTTP error tests
test.serial('fetchCloudModels: returns specific error for 401 Unauthorized', async t => {
	const {mockFetch} = createMockFetch({}, {ok: false, status: 401, statusText: 'Unauthorized'});
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchCloudModels('openai', 'invalid-key');
		t.false(result.success);
		t.is(result.models.length, 0);
		t.is(result.error, 'Invalid API key');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchCloudModels: returns specific error for 403 Forbidden', async t => {
	const {mockFetch} = createMockFetch({}, {ok: false, status: 403, statusText: 'Forbidden'});
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchCloudModels('openai', 'restricted-key');
		t.false(result.success);
		t.is(result.models.length, 0);
		t.is(result.error, 'API key does not have permission to list models');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchCloudModels: returns generic error for other HTTP errors', async t => {
	const {mockFetch} = createMockFetch({}, {ok: false, status: 500, statusText: 'Internal Server Error'});
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchCloudModels('openai', 'api-key');
		t.false(result.success);
		t.is(result.models.length, 0);
		t.is(result.error, 'API returned 500: Internal Server Error');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

// Response format validation tests
test.serial('fetchCloudModels: returns error for invalid response format (non-GitHub)', async t => {
	const {mockFetch} = createMockFetch({invalid: 'response'}); // Missing data array
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchCloudModels('openai', 'api-key');
		t.false(result.success);
		t.is(result.models.length, 0);
		t.is(result.error, 'Invalid response format from API');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchCloudModels: returns error for invalid GitHub response format', async t => {
	const {mockFetch} = createMockFetch({data: []}); // GitHub expects array, not object
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchCloudModels('github', 'api-key');
		t.false(result.success);
		t.is(result.models.length, 0);
		t.is(result.error, 'Invalid response format from API');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchCloudModels: returns error when no models found', async t => {
	const {mockFetch} = createMockFetch(createCloudModelsResponse([]));
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchCloudModels('openai', 'api-key');
		t.false(result.success);
		t.is(result.models.length, 0);
		t.is(result.error, 'No models found for this API key');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

// Network error tests
test.serial('fetchCloudModels: handles network error', async t => {
	globalThis.fetch = async () => {
		throw new Error('Network error');
	};

	try {
		const result = await fetchCloudModels('openai', 'api-key');
		t.false(result.success);
		t.is(result.models.length, 0);
		t.is(result.error, 'Network error');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchCloudModels: handles timeout (AbortError)', async t => {
	globalThis.fetch = async () => {
		const error = new Error('The operation was aborted');
		error.name = 'AbortError';
		throw error;
	};

	try {
		const result = await fetchCloudModels('openai', 'api-key');
		t.false(result.success);
		t.is(result.models.length, 0);
		t.is(result.error, 'Connection timed out');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('fetchCloudModels: handles unknown error type', async t => {
	globalThis.fetch = async () => {
		throw 'string error'; // Non-Error thrown
	};

	try {
		const result = await fetchCloudModels('openai', 'api-key');
		t.false(result.success);
		t.is(result.models.length, 0);
		t.is(result.error, 'Unknown error occurred');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

// Data validation tests
test.serial('fetchCloudModels: filters out invalid model entries', async t => {
	const response = createCloudModelsResponse([
		{id: 'valid-model'},
		{id: ''}, // Empty id
		{id: '   '}, // Whitespace only
		{} as {id: string}, // Missing id
		{id: 'another-valid'},
	]);
	const {mockFetch} = createMockFetch(response);
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchCloudModels('openai', 'api-key');
		t.true(result.success);
		t.is(result.models.length, 2);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

// Sorting test
test.serial('fetchCloudModels: returns models sorted alphabetically by name', async t => {
	const response = createCloudModelsResponse([
		{id: 'z-model', display_name: 'Zebra Model'},
		{id: 'a-model', display_name: 'Alpha Model'},
		{id: 'm-model', display_name: 'Middle Model'},
	]);
	const {mockFetch} = createMockFetch(response);
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchCloudModels('anthropic', 'api-key');
		t.true(result.success);
		t.is(result.models.length, 3);
		t.is(result.models[0]?.name, 'Alpha Model');
		t.is(result.models[1]?.name, 'Middle Model');
		t.is(result.models[2]?.name, 'Zebra Model');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

// Fallback to id when no name/display_name
test.serial('fetchCloudModels: falls back to id when no name or display_name', async t => {
	const response = createCloudModelsResponse([{id: 'model-id-only'}]);
	const {mockFetch} = createMockFetch(response);
	globalThis.fetch = mockFetch;

	try {
		const result = await fetchCloudModels('openai', 'api-key');
		t.true(result.success);
		t.is(result.models[0]?.id, 'model-id-only');
		t.is(result.models[0]?.name, 'model-id-only');
	} finally {
		globalThis.fetch = originalFetch;
	}
});
