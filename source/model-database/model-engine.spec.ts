import test from 'ava';
import {ModelMatchingEngine} from './model-engine';
import {modelDatabase} from './model-database';
import {ModelEntry} from '@/types/index';

console.log(`\nmodel-engine.spec.ts`);

// Create mock models for testing
function createMockModels(): ModelEntry[] {
	return [
		{
			id: 'openai/gpt-4',
			name: 'GPT-4',
			author: 'Openai',
			size: '128K',
			local: false,
			api: true,
			contextLength: 128000,
			created: 1700000000,
			quality: {cost: 5},
			costType: 'paid',
			costDetails: '$30.00/M in, $60.00/M out',
			hasToolSupport: true,
		},
		{
			id: 'anthropic/claude-3-opus',
			name: 'Claude 3 Opus',
			author: 'Anthropic',
			size: '200K',
			local: false,
			api: true,
			contextLength: 200000,
			created: 1710000000,
			quality: {cost: 3},
			costType: 'paid',
			costDetails: '$15.00/M in, $75.00/M out',
			hasToolSupport: true,
		},
		{
			id: 'meta-llama/llama-3.1-70b',
			name: 'Llama 3.1 70B',
			author: 'Meta-llama',
			size: '128K',
			local: true,
			api: true,
			contextLength: 128000,
			created: 1715000000,
			quality: {cost: 9},
			costType: 'free',
			costDetails: 'Free (open weights)',
			hasToolSupport: true,
		},
		{
			id: 'mistralai/mistral-large',
			name: 'Mistral Large',
			author: 'Mistralai',
			size: '128K',
			local: true,
			api: true,
			contextLength: 128000,
			created: 1712000000,
			quality: {cost: 8},
			costType: 'free',
			costDetails: 'Free (open weights)',
			hasToolSupport: true,
		},
		{
			id: 'qwen/qwen-72b',
			name: 'Qwen 72B',
			author: 'Qwen',
			size: '32K',
			local: true,
			api: true,
			contextLength: 32000,
			created: 1708000000,
			quality: {cost: 10},
			costType: 'free',
			costDetails: 'Free (open weights)',
			hasToolSupport: false,
		},
	];
}

// Helper to create a fresh instance for each test
function createFreshInstance(): ModelMatchingEngine {
	const instance = new (ModelMatchingEngine as any)();
	return instance;
}

test.serial('getInstance returns singleton instance', t => {
	const instance1 = ModelMatchingEngine.getInstance();
	const instance2 = ModelMatchingEngine.getInstance();
	t.is(instance1, instance2);
});

test.serial('getModels returns categorized results', t => {
	const engine = createFreshInstance();
	const mockModels = createMockModels();

	// Mock the database
	const originalGetAllModels = modelDatabase.getAllModels;
	modelDatabase.getAllModels = () => mockModels;

	try {
		const results = engine.getModels();

		t.true(Array.isArray(results.allModels));
		t.true(Array.isArray(results.openModels));
		t.true(Array.isArray(results.proprietaryModels));
		t.true(Array.isArray(results.latestModels));
	} finally {
		modelDatabase.getAllModels = originalGetAllModels;
	}
});

test.serial('getModels separates open and proprietary models', t => {
	const engine = createFreshInstance();
	const mockModels = createMockModels();

	const originalGetAllModels = modelDatabase.getAllModels;
	modelDatabase.getAllModels = () => mockModels;

	try {
		const results = engine.getModels();

		// Open models (local: true)
		t.is(results.openModels.length, 3);
		t.true(results.openModels.every(m => m.local === true));

		// Proprietary models (local: false)
		t.is(results.proprietaryModels.length, 2);
		t.true(results.proprietaryModels.every(m => m.local === false));
	} finally {
		modelDatabase.getAllModels = originalGetAllModels;
	}
});

test.serial('getModels sorts open models by created date (newest first)', t => {
	const engine = createFreshInstance();
	const mockModels = createMockModels();

	const originalGetAllModels = modelDatabase.getAllModels;
	modelDatabase.getAllModels = () => mockModels;

	try {
		const results = engine.getModels();

		// Verify sorted by created descending
		for (let i = 1; i < results.openModels.length; i++) {
			t.true(
				results.openModels[i - 1].created >= results.openModels[i].created,
				`Open models should be sorted by created date descending`,
			);
		}

		// First should be Llama 3.1 (created: 1715000000)
		t.is(results.openModels[0]?.id, 'meta-llama/llama-3.1-70b');
	} finally {
		modelDatabase.getAllModels = originalGetAllModels;
	}
});

test.serial(
	'getModels sorts proprietary models by created date (newest first)',
	t => {
		const engine = createFreshInstance();
		const mockModels = createMockModels();

		const originalGetAllModels = modelDatabase.getAllModels;
		modelDatabase.getAllModels = () => mockModels;

		try {
			const results = engine.getModels();

			// Verify sorted by created descending
			for (let i = 1; i < results.proprietaryModels.length; i++) {
				t.true(
					results.proprietaryModels[i - 1].created >=
						results.proprietaryModels[i].created,
					`Proprietary models should be sorted by created date descending`,
				);
			}

			// First should be Claude 3 Opus (created: 1710000000)
			t.is(results.proprietaryModels[0]?.id, 'anthropic/claude-3-opus');
		} finally {
			modelDatabase.getAllModels = originalGetAllModels;
		}
	},
);

test.serial('getModels returns latest models limited to 50', t => {
	const engine = createFreshInstance();

	// Create more than 50 models
	const manyModels: ModelEntry[] = [];
	for (let i = 0; i < 60; i++) {
		manyModels.push({
			id: `test/model-${i}`,
			name: `Model ${i}`,
			author: 'Test',
			size: '128K',
			local: i % 2 === 0,
			api: true,
			contextLength: 128000,
			created: 1700000000 + i * 1000,
			quality: {cost: 5},
			costType: 'paid',
			costDetails: '$1.00/M in, $2.00/M out',
			hasToolSupport: true,
		});
	}

	const originalGetAllModels = modelDatabase.getAllModels;
	modelDatabase.getAllModels = () => manyModels;

	try {
		const results = engine.getModels();

		t.is(results.latestModels.length, 50);
		t.is(results.allModels.length, 60);
	} finally {
		modelDatabase.getAllModels = originalGetAllModels;
	}
});

test.serial('getModels sorts latest models by created date', t => {
	const engine = createFreshInstance();
	const mockModels = createMockModels();

	const originalGetAllModels = modelDatabase.getAllModels;
	modelDatabase.getAllModels = () => mockModels;

	try {
		const results = engine.getModels();

		// Verify sorted by created descending
		for (let i = 1; i < results.latestModels.length; i++) {
			t.true(
				results.latestModels[i - 1].created >= results.latestModels[i].created,
				`Latest models should be sorted by created date descending`,
			);
		}
	} finally {
		modelDatabase.getAllModels = originalGetAllModels;
	}
});

test.serial('getModels returns all models in allModels array', t => {
	const engine = createFreshInstance();
	const mockModels = createMockModels();

	const originalGetAllModels = modelDatabase.getAllModels;
	modelDatabase.getAllModels = () => mockModels;

	try {
		const results = engine.getModels();

		t.is(results.allModels.length, mockModels.length);
		t.deepEqual(results.allModels, mockModels);
	} finally {
		modelDatabase.getAllModels = originalGetAllModels;
	}
});

test.serial('getModelsAsync returns categorized results', async t => {
	const engine = createFreshInstance();
	const mockModels = createMockModels();

	const originalGetAllModelsAsync = modelDatabase.getAllModelsAsync;
	modelDatabase.getAllModelsAsync = async () => mockModels;

	try {
		const results = await engine.getModelsAsync();

		t.true(Array.isArray(results.allModels));
		t.true(Array.isArray(results.openModels));
		t.true(Array.isArray(results.proprietaryModels));
		t.true(Array.isArray(results.latestModels));
	} finally {
		modelDatabase.getAllModelsAsync = originalGetAllModelsAsync;
	}
});

test.serial('getModelsAsync separates open and proprietary models', async t => {
	const engine = createFreshInstance();
	const mockModels = createMockModels();

	const originalGetAllModelsAsync = modelDatabase.getAllModelsAsync;
	modelDatabase.getAllModelsAsync = async () => mockModels;

	try {
		const results = await engine.getModelsAsync();

		// Open models (local: true)
		t.is(results.openModels.length, 3);
		t.true(results.openModels.every(m => m.local === true));

		// Proprietary models (local: false)
		t.is(results.proprietaryModels.length, 2);
		t.true(results.proprietaryModels.every(m => m.local === false));
	} finally {
		modelDatabase.getAllModelsAsync = originalGetAllModelsAsync;
	}
});

test.serial('getModels handles empty model list', t => {
	const engine = createFreshInstance();

	const originalGetAllModels = modelDatabase.getAllModels;
	modelDatabase.getAllModels = () => [];

	try {
		const results = engine.getModels();

		t.deepEqual(results.allModels, []);
		t.deepEqual(results.openModels, []);
		t.deepEqual(results.proprietaryModels, []);
		t.deepEqual(results.latestModels, []);
	} finally {
		modelDatabase.getAllModels = originalGetAllModels;
	}
});

test.serial('getModels handles only open models', t => {
	const engine = createFreshInstance();
	const openOnlyModels: ModelEntry[] = [
		{
			id: 'meta-llama/llama-3.1-70b',
			name: 'Llama 3.1 70B',
			author: 'Meta-llama',
			size: '128K',
			local: true,
			api: true,
			contextLength: 128000,
			created: 1715000000,
			quality: {cost: 9},
			costType: 'free',
			costDetails: 'Free (open weights)',
			hasToolSupport: true,
		},
	];

	const originalGetAllModels = modelDatabase.getAllModels;
	modelDatabase.getAllModels = () => openOnlyModels;

	try {
		const results = engine.getModels();

		t.is(results.openModels.length, 1);
		t.is(results.proprietaryModels.length, 0);
		t.is(results.latestModels.length, 1);
	} finally {
		modelDatabase.getAllModels = originalGetAllModels;
	}
});

test.serial('getModels handles only proprietary models', t => {
	const engine = createFreshInstance();
	const proprietaryOnlyModels: ModelEntry[] = [
		{
			id: 'openai/gpt-4',
			name: 'GPT-4',
			author: 'Openai',
			size: '128K',
			local: false,
			api: true,
			contextLength: 128000,
			created: 1700000000,
			quality: {cost: 5},
			costType: 'paid',
			costDetails: '$30.00/M in, $60.00/M out',
			hasToolSupport: true,
		},
	];

	const originalGetAllModels = modelDatabase.getAllModels;
	modelDatabase.getAllModels = () => proprietaryOnlyModels;

	try {
		const results = engine.getModels();

		t.is(results.openModels.length, 0);
		t.is(results.proprietaryModels.length, 1);
		t.is(results.latestModels.length, 1);
	} finally {
		modelDatabase.getAllModels = originalGetAllModels;
	}
});

test.serial('getModelsAsync handles errors from database', async t => {
	const engine = createFreshInstance();

	const originalGetAllModelsAsync = modelDatabase.getAllModelsAsync;
	modelDatabase.getAllModelsAsync = async () => {
		throw new Error('Database error');
	};

	try {
		await t.throwsAsync(() => engine.getModelsAsync(), {
			message: 'Database error',
		});
	} finally {
		modelDatabase.getAllModelsAsync = originalGetAllModelsAsync;
	}
});

test.serial('latestModels contains models from both categories', t => {
	const engine = createFreshInstance();
	const mockModels = createMockModels();

	const originalGetAllModels = modelDatabase.getAllModels;
	modelDatabase.getAllModels = () => mockModels;

	try {
		const results = engine.getModels();

		// Latest models should contain both open and proprietary
		const hasOpen = results.latestModels.some(m => m.local === true);
		const hasProprietary = results.latestModels.some(m => m.local === false);

		t.true(hasOpen, 'Latest models should contain open models');
		t.true(hasProprietary, 'Latest models should contain proprietary models');
	} finally {
		modelDatabase.getAllModels = originalGetAllModels;
	}
});

test.serial('processModels does not mutate original array', t => {
	const engine = createFreshInstance();
	const mockModels = createMockModels();
	const originalLength = mockModels.length;
	const originalFirstId = mockModels[0]?.id;

	const originalGetAllModels = modelDatabase.getAllModels;
	modelDatabase.getAllModels = () => mockModels;

	try {
		engine.getModels();

		// Original array should be unchanged
		t.is(mockModels.length, originalLength);
		t.is(mockModels[0]?.id, originalFirstId);
	} finally {
		modelDatabase.getAllModels = originalGetAllModels;
	}
});
