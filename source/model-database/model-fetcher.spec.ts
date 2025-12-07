import test from 'ava';
import {fetchModels, clearModelCache, isModelsCached} from './model-fetcher';

console.log(`\nmodel-fetcher.spec.ts`);

// Helper to create mock OpenRouter API response
function createMockOpenRouterResponse(
	models: Array<{
		id: string;
		name: string;
		description?: string;
		created?: number;
		context_length?: number;
		pricing?: {prompt: string; completion: string};
		supported_parameters?: string[];
		architecture?: {
			input_modalities?: string[];
			output_modalities?: string[];
		};
	}>,
) {
	return {
		data: models.map(m => ({
			id: m.id,
			name: m.name,
			description: m.description || '',
			created: m.created || Math.floor(Date.now() / 1000),
			context_length: m.context_length || 128000,
			architecture: {
				modality: 'text',
				input_modalities: m.architecture?.input_modalities || ['text'],
				output_modalities: m.architecture?.output_modalities || ['text'],
				tokenizer: 'unknown',
			},
			pricing: m.pricing || {prompt: '0.000001', completion: '0.000002'},
			supported_parameters: m.supported_parameters || ['tools'],
		})),
	};
}

// Tests for cache management
test.serial('clearModelCache resets the cache', async t => {
	// Clear any existing cache
	clearModelCache();
	t.false(isModelsCached());
});

test.serial('isModelsCached returns false when cache is empty', t => {
	clearModelCache();
	t.false(isModelsCached());
});

test.serial('fetchModels returns array', async t => {
	clearModelCache();

	// Mock fetch for this test
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () =>
				createMockOpenRouterResponse([
					{
						id: 'openai/gpt-4',
						name: 'GPT-4',
						supported_parameters: ['tools'],
					},
				]),
		} as Response;
	};

	try {
		const models = await fetchModels();
		t.true(Array.isArray(models));
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('fetchModels filters out non-coding models', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () =>
				createMockOpenRouterResponse([
					{
						id: 'openai/gpt-4',
						name: 'GPT-4',
						supported_parameters: ['tools'],
					},
					{
						id: 'openai/dall-e-3',
						name: 'DALL-E 3',
						description: 'Image generation model',
						supported_parameters: [],
						architecture: {
							input_modalities: ['text'],
							output_modalities: ['image'],
						},
					},
					{
						id: 'some/embedding-model',
						name: 'Embedding Model',
						supported_parameters: [],
					},
				]),
		} as Response;
	};

	try {
		const models = await fetchModels();
		// Should include GPT-4 but not DALL-E or embedding model
		const modelIds = models.map(m => m.id);
		t.true(modelIds.includes('openai/gpt-4'));
		t.false(modelIds.includes('openai/dall-e-3'));
		t.false(modelIds.includes('some/embedding-model'));
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('fetchModels identifies open weight models correctly', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () =>
				createMockOpenRouterResponse([
					{
						id: 'meta-llama/llama-3.1-70b',
						name: 'Llama 3.1 70B',
						supported_parameters: ['tools'],
					},
					{
						id: 'openai/gpt-4',
						name: 'GPT-4',
						supported_parameters: ['tools'],
					},
					{
						id: 'mistralai/mistral-large',
						name: 'Mistral Large',
						supported_parameters: ['tools'],
					},
					{
						id: 'qwen/qwen-72b',
						name: 'Qwen 72B',
						supported_parameters: ['tools'],
					},
					{
						id: 'deepseek/deepseek-coder',
						name: 'DeepSeek Coder',
						supported_parameters: ['tools'],
					},
				]),
		} as Response;
	};

	try {
		const models = await fetchModels();

		const llama = models.find(m => m.id === 'meta-llama/llama-3.1-70b');
		const gpt4 = models.find(m => m.id === 'openai/gpt-4');
		const mistral = models.find(m => m.id === 'mistralai/mistral-large');
		const qwen = models.find(m => m.id === 'qwen/qwen-72b');
		const deepseek = models.find(m => m.id === 'deepseek/deepseek-coder');

		// Open weight models
		t.true(llama?.local, 'Llama should be marked as local/open');
		t.true(mistral?.local, 'Mistral should be marked as local/open');
		t.true(qwen?.local, 'Qwen should be marked as local/open');
		t.true(deepseek?.local, 'DeepSeek should be marked as local/open');

		// Proprietary models
		t.false(gpt4?.local, 'GPT-4 should not be marked as local/open');
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('fetchModels extracts author correctly', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () =>
				createMockOpenRouterResponse([
					{
						id: 'anthropic/claude-3-opus',
						name: 'Claude 3 Opus',
						supported_parameters: ['tools'],
					},
					{
						id: 'google/gemini-pro',
						name: 'Gemini Pro',
						supported_parameters: ['tools'],
					},
				]),
		} as Response;
	};

	try {
		const models = await fetchModels();

		const claude = models.find(m => m.id === 'anthropic/claude-3-opus');
		const gemini = models.find(m => m.id === 'google/gemini-pro');

		t.is(claude?.author, 'Anthropic');
		t.is(gemini?.author, 'Google');
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('fetchModels calculates cost score correctly', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () =>
				createMockOpenRouterResponse([
					{
						id: 'free/model',
						name: 'Free Model',
						pricing: {prompt: '0', completion: '0'},
						supported_parameters: ['tools'],
					},
					{
						id: 'expensive/model',
						name: 'Expensive Model',
						pricing: {prompt: '0.00006', completion: '0.00012'}, // $60/$120 per million
						supported_parameters: ['tools'],
					},
				]),
		} as Response;
	};

	try {
		const models = await fetchModels();

		const freeModel = models.find(m => m.id === 'free/model');
		const expensiveModel = models.find(m => m.id === 'expensive/model');

		t.is(freeModel?.quality.cost, 10, 'Free model should have cost score 10');
		t.true(
			(expensiveModel?.quality.cost ?? 10) < 5,
			'Expensive model should have low cost score',
		);
		t.is(freeModel?.costType, 'free');
		t.is(expensiveModel?.costType, 'paid');
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('fetchModels formats context length correctly', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () =>
				createMockOpenRouterResponse([
					{
						id: 'small/model',
						name: 'Small Context',
						context_length: 4096,
						supported_parameters: ['tools'],
					},
					{
						id: 'medium/model',
						name: 'Medium Context',
						context_length: 128000,
						supported_parameters: ['tools'],
					},
					{
						id: 'large/model',
						name: 'Large Context',
						context_length: 1000000,
						supported_parameters: ['tools'],
					},
				]),
		} as Response;
	};

	try {
		const models = await fetchModels();

		const small = models.find(m => m.id === 'small/model');
		const medium = models.find(m => m.id === 'medium/model');
		const large = models.find(m => m.id === 'large/model');

		t.is(small?.size, '4K');
		t.is(medium?.size, '128K');
		t.is(large?.size, '1.0M');
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('fetchModels detects tool support', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () =>
				createMockOpenRouterResponse([
					{
						id: 'with-tools/model',
						name: 'With Tools',
						supported_parameters: ['tools', 'temperature'],
					},
					{
						id: 'without-tools/gpt',
						name: 'Without Tools GPT', // include 'gpt' to pass coding filter
						supported_parameters: ['temperature'],
					},
				]),
		} as Response;
	};

	try {
		const models = await fetchModels();

		const withTools = models.find(m => m.id === 'with-tools/model');
		const withoutTools = models.find(m => m.id === 'without-tools/gpt');

		t.true(withTools?.hasToolSupport);
		t.false(withoutTools?.hasToolSupport);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('fetchModels returns cached data on subsequent calls', async t => {
	clearModelCache();

	let fetchCount = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		fetchCount++;
		return {
			ok: true,
			json: async () =>
				createMockOpenRouterResponse([
					{
						id: 'test/model',
						name: 'Test Model',
						supported_parameters: ['tools'],
					},
				]),
		} as Response;
	};

	try {
		// First call
		await fetchModels();
		t.is(fetchCount, 1);
		t.true(isModelsCached());

		// Second call should use cache
		await fetchModels();
		t.is(fetchCount, 1); // Should not increment
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('fetchModels handles API errors gracefully', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: false,
			status: 500,
		} as Response;
	};

	try {
		const models = await fetchModels();
		t.deepEqual(models, []);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('fetchModels handles network errors gracefully', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		throw new Error('Network error');
	};

	try {
		const models = await fetchModels();
		t.deepEqual(models, []);
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial('fetchModels sorts by created date', async t => {
	clearModelCache();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		return {
			ok: true,
			json: async () =>
				createMockOpenRouterResponse([
					{
						id: 'old/model',
						name: 'Old Model',
						created: 1000000,
						supported_parameters: ['tools'],
					},
					{
						id: 'new/model',
						name: 'New Model',
						created: 2000000,
						supported_parameters: ['tools'],
					},
					{
						id: 'middle/model',
						name: 'Middle Model',
						created: 1500000,
						supported_parameters: ['tools'],
					},
				]),
		} as Response;
	};

	try {
		const models = await fetchModels();

		t.is(models[0]?.id, 'new/model');
		t.is(models[1]?.id, 'middle/model');
		t.is(models[2]?.id, 'old/model');
	} finally {
		globalThis.fetch = originalFetch;
		clearModelCache();
	}
});

test.serial(
	'fetchModels includes coding-capable models by pattern',
	async t => {
		clearModelCache();

		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			return {
				ok: true,
				json: async () =>
					createMockOpenRouterResponse([
						{
							id: 'anthropic/claude-3',
							name: 'Claude 3',
							supported_parameters: [],
						},
						{
							id: 'openai/gpt-4',
							name: 'GPT-4',
							supported_parameters: [],
						},
						{
							id: 'google/gemini-pro',
							name: 'Gemini Pro',
							supported_parameters: [],
						},
						{
							id: 'some/codestral',
							name: 'Codestral',
							supported_parameters: [],
						},
					]),
			} as Response;
		};

		try {
			const models = await fetchModels();
			const modelIds = models.map(m => m.id);

			t.true(modelIds.includes('anthropic/claude-3'));
			t.true(modelIds.includes('openai/gpt-4'));
			t.true(modelIds.includes('google/gemini-pro'));
			t.true(modelIds.includes('some/codestral'));
		} finally {
			globalThis.fetch = originalFetch;
			clearModelCache();
		}
	},
);

test.serial(
	'fetchModels formats cost details correctly for paid models',
	async t => {
		clearModelCache();

		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			return {
				ok: true,
				json: async () =>
					createMockOpenRouterResponse([
						{
							id: 'test/model',
							name: 'Test Model',
							pricing: {prompt: '0.000001', completion: '0.000002'},
							supported_parameters: ['tools'],
						},
					]),
			} as Response;
		};

		try {
			const models = await fetchModels();
			const model = models.find(m => m.id === 'test/model');

			t.true(model?.costDetails.includes('$'));
			t.true(model?.costDetails.includes('/M'));
		} finally {
			globalThis.fetch = originalFetch;
			clearModelCache();
		}
	},
);

test.serial(
	'fetchModels formats cost details correctly for free models',
	async t => {
		clearModelCache();

		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			return {
				ok: true,
				json: async () =>
					createMockOpenRouterResponse([
						{
							id: 'meta-llama/llama-free',
							name: 'Llama Free',
							pricing: {prompt: '0', completion: '0'},
							supported_parameters: ['tools'],
						},
					]),
			} as Response;
		};

		try {
			const models = await fetchModels();
			const model = models.find(m => m.id === 'meta-llama/llama-free');

			t.true(model?.costDetails.includes('Free'));
		} finally {
			globalThis.fetch = originalFetch;
			clearModelCache();
		}
	},
);
