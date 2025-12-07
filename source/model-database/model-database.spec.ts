import test from 'ava';
import {ModelDatabase, modelDatabase} from './model-database';
import {clearModelCache} from './model-fetcher';

console.log(`\nmodel-database.spec.ts`);

// Note: These tests work with the actual ModelDatabase class behavior.
// Since we can't mock ES module exports directly, we test the public API
// and use the global fetch mock where needed.

// Helper to create a fresh instance for each test
function createFreshInstance(): ModelDatabase {
	// Create a new instance by bypassing singleton
	const instance = new (ModelDatabase as any)();
	return instance;
}

// Mock models response
function createMockOpenRouterResponse() {
	return {
		data: [
			{
				id: 'openai/gpt-4',
				name: 'GPT-4',
				description: 'Advanced AI model',
				created: 1700000000,
				context_length: 128000,
				architecture: {
					modality: 'text',
					input_modalities: ['text'],
					output_modalities: ['text'],
					tokenizer: 'unknown',
				},
				pricing: {prompt: '0.00003', completion: '0.00006'},
				supported_parameters: ['tools'],
			},
			{
				id: 'meta-llama/llama-3.1-70b',
				name: 'Llama 3.1 70B',
				description: 'Open source model',
				created: 1710000000,
				context_length: 128000,
				architecture: {
					modality: 'text',
					input_modalities: ['text'],
					output_modalities: ['text'],
					tokenizer: 'unknown',
				},
				pricing: {prompt: '0', completion: '0'},
				supported_parameters: ['tools'],
			},
		],
	};
}

test.serial('getInstance returns singleton instance', t => {
	const instance1 = ModelDatabase.getInstance();
	const instance2 = ModelDatabase.getInstance();
	t.is(instance1, instance2);
});

test.serial('getAllModels returns empty array when no cache', t => {
	const db = createFreshInstance();
	// Immediately call getAllModels without any fetch
	const models = db.getAllModels();
	t.deepEqual(models, []);
});

test.serial('clearCache resets cache state', async t => {
	const db = createFreshInstance();

	// First populate the cache
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	try {
		await db.refreshModels();
		t.true(db.getAllModels().length > 0);

		db.clearCache();
		// After clear, sync getAllModels should return empty
		// (but it will trigger a background fetch)
		const modelsAfterClear = db.getAllModels();
		t.is(modelsAfterClear.length, 0);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('getAllModelsAsync fetches and returns models', async t => {
	const db = createFreshInstance();
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	try {
		const models = await db.getAllModelsAsync();
		t.true(Array.isArray(models));
		t.true(models.length > 0);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('refreshModels forces new fetch when cache is cleared', async t => {
	const db = createFreshInstance();
	clearModelCache();

	let fetchCount = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		fetchCount++;
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	try {
		await db.refreshModels();
		t.is(fetchCount, 1);

		// Clear global cache to allow re-fetch
		clearModelCache();

		// Now refresh should fetch again
		await db.refreshModels();
		t.is(fetchCount, 2);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('getAllModels returns cached data after async fetch', async t => {
	const db = createFreshInstance();
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	try {
		// Fetch data
		await db.getAllModelsAsync();

		// Now sync call should return cached data
		const models = db.getAllModels();
		t.true(models.length > 0);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial(
	'concurrent getAllModelsAsync calls share the same promise',
	async t => {
		const db = createFreshInstance();
		clearModelCache();

		let fetchCount = 0;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			fetchCount++;
			// Add small delay to ensure concurrency
			await new Promise(resolve => setTimeout(resolve, 10));
			return {
				ok: true,
				json: async () => createMockOpenRouterResponse(),
			} as Response;
		};

		try {
			// Start multiple concurrent requests
			const [result1, result2, result3] = await Promise.all([
				db.getAllModelsAsync(),
				db.getAllModelsAsync(),
				db.getAllModelsAsync(),
			]);

			// All should succeed
			t.true(result1.length > 0);
			t.true(result2.length > 0);
			t.true(result3.length > 0);

			// Only one fetch should have occurred
			t.is(fetchCount, 1);
		} finally {
			globalThis.fetch = originalFetch;
			clearModelCache();
		}
	},
);

test.serial('getAllModelsAsync uses cache when fresh', async t => {
	const db = createFreshInstance();
	clearModelCache();

	let fetchCount = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		fetchCount++;
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	try {
		// First call fetches
		await db.getAllModelsAsync();
		t.is(fetchCount, 1);

		// Second call should use cache (within 1 hour TTL)
		await db.getAllModelsAsync();
		t.is(fetchCount, 1); // No new fetch
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('refreshModels handles errors', async t => {
	const db = createFreshInstance();
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		throw new Error('Network error');
	};

	try {
		// Errors should propagate from refreshModels
		// The fetcher catches and returns empty array, so refreshModels resolves with []
		const result = await db.refreshModels();
		t.deepEqual(result, []);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('getAllModels triggers background fetch when empty', async t => {
	const db = createFreshInstance();
	clearModelCache();

	let fetchCount = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		fetchCount++;
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	try {
		// Sync call on empty cache returns [] but triggers fetch
		const immediate = db.getAllModels();
		t.deepEqual(immediate, []);

		// Wait for background fetch
		await new Promise(resolve => setTimeout(resolve, 100));

		// Now should have data
		const afterFetch = db.getAllModels();
		t.true(afterFetch.length > 0);
		t.is(fetchCount, 1);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('getAllModels does not trigger multiple fetches', async t => {
	const db = createFreshInstance();
	clearModelCache();

	let fetchCount = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		fetchCount++;
		await new Promise(resolve => setTimeout(resolve, 50));
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	try {
		// Multiple sync calls while fetch is in progress
		db.getAllModels();
		db.getAllModels();
		db.getAllModels();

		// Wait for fetch to complete
		await new Promise(resolve => setTimeout(resolve, 100));

		// Only one fetch should have been triggered
		t.is(fetchCount, 1);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('modelDatabase singleton works correctly', t => {
	// Test the exported singleton instance
	t.truthy(modelDatabase);
	t.true(typeof modelDatabase.getAllModels === 'function');
	t.true(typeof modelDatabase.getAllModelsAsync === 'function');
	t.true(typeof modelDatabase.refreshModels === 'function');
	t.true(typeof modelDatabase.clearCache === 'function');
});

test.serial('models have correct structure after fetch', async t => {
	const db = createFreshInstance();
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () => createMockOpenRouterResponse(),
		} as Response;
	};

	try {
		const models = await db.getAllModelsAsync();
		t.true(models.length > 0);

		const model = models[0];
		t.truthy(model);
		t.true(typeof model.id === 'string');
		t.true(typeof model.name === 'string');
		t.true(typeof model.author === 'string');
		t.true(typeof model.local === 'boolean');
		t.true(typeof model.api === 'boolean');
		t.true(typeof model.contextLength === 'number');
		t.true(typeof model.hasToolSupport === 'boolean');
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});
