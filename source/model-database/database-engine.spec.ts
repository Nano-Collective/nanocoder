import test from 'ava';
import {DatabaseEngine} from './database-engine';
import {modelMatchingEngine} from './model-engine';
import {ModelEntry} from '@/types/index';

console.log(`\ndatabase-engine.spec.ts`);

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
	];
}

// Mock ModelResults type
interface MockModelResults {
	allModels: ModelEntry[];
	openModels: ModelEntry[];
	proprietaryModels: ModelEntry[];
	latestModels: ModelEntry[];
}

function createMockModelResults(models: ModelEntry[]): MockModelResults {
	const openModels = models.filter(m => m.local);
	const proprietaryModels = models.filter(m => !m.local);
	const latestModels = [...models].sort((a, b) => b.created - a.created);

	return {
		allModels: models,
		openModels,
		proprietaryModels,
		latestModels,
	};
}

// Helper to create a fresh instance for each test
function createFreshInstance(): DatabaseEngine {
	const instance = new (DatabaseEngine as any)();
	return instance;
}

test.serial('getInstance returns singleton instance', t => {
	const instance1 = DatabaseEngine.getInstance();
	const instance2 = DatabaseEngine.getInstance();
	t.is(instance1, instance2);
});

test.serial('getDatabases returns database result structure', t => {
	const engine = createFreshInstance();
	const mockModels = createMockModels();
	const mockResults = createMockModelResults(mockModels);

	const originalGetModels = modelMatchingEngine.getModels;
	modelMatchingEngine.getModels = () => mockResults;

	try {
		const result = engine.getDatabases();

		t.true(Array.isArray(result.openModels));
		t.true(Array.isArray(result.proprietaryModels));
		t.true(Array.isArray(result.latestModels));
		t.true(Array.isArray(result.allModels));
	} finally {
		modelMatchingEngine.getModels = originalGetModels;
	}
});

test.serial('getDatabases returns open models correctly', t => {
	const engine = createFreshInstance();
	const mockModels = createMockModels();
	const mockResults = createMockModelResults(mockModels);

	const originalGetModels = modelMatchingEngine.getModels;
	modelMatchingEngine.getModels = () => mockResults;

	try {
		const result = engine.getDatabases();

		t.is(result.openModels.length, 2);
		t.true(result.openModels.every(m => m.local === true));
	} finally {
		modelMatchingEngine.getModels = originalGetModels;
	}
});

test.serial('getDatabases returns proprietary models correctly', t => {
	const engine = createFreshInstance();
	const mockModels = createMockModels();
	const mockResults = createMockModelResults(mockModels);

	const originalGetModels = modelMatchingEngine.getModels;
	modelMatchingEngine.getModels = () => mockResults;

	try {
		const result = engine.getDatabases();

		t.is(result.proprietaryModels.length, 2);
		t.true(result.proprietaryModels.every(m => m.local === false));
	} finally {
		modelMatchingEngine.getModels = originalGetModels;
	}
});

test.serial('getDatabases returns latest models', t => {
	const engine = createFreshInstance();
	const mockModels = createMockModels();
	const mockResults = createMockModelResults(mockModels);

	const originalGetModels = modelMatchingEngine.getModels;
	modelMatchingEngine.getModels = () => mockResults;

	try {
		const result = engine.getDatabases();

		t.is(result.latestModels.length, mockModels.length);
	} finally {
		modelMatchingEngine.getModels = originalGetModels;
	}
});

test.serial('getDatabases returns all models', t => {
	const engine = createFreshInstance();
	const mockModels = createMockModels();
	const mockResults = createMockModelResults(mockModels);

	const originalGetModels = modelMatchingEngine.getModels;
	modelMatchingEngine.getModels = () => mockResults;

	try {
		const result = engine.getDatabases();

		t.is(result.allModels.length, mockModels.length);
	} finally {
		modelMatchingEngine.getModels = originalGetModels;
	}
});

test.serial('getDatabasesAsync returns database result structure', async t => {
	const engine = createFreshInstance();
	const mockModels = createMockModels();
	const mockResults = createMockModelResults(mockModels);

	const originalGetModelsAsync = modelMatchingEngine.getModelsAsync;
	modelMatchingEngine.getModelsAsync = async () => mockResults;

	try {
		const result = await engine.getDatabasesAsync();

		t.true(Array.isArray(result.openModels));
		t.true(Array.isArray(result.proprietaryModels));
		t.true(Array.isArray(result.latestModels));
		t.true(Array.isArray(result.allModels));
	} finally {
		modelMatchingEngine.getModelsAsync = originalGetModelsAsync;
	}
});

test.serial('getDatabasesAsync returns open models correctly', async t => {
	const engine = createFreshInstance();
	const mockModels = createMockModels();
	const mockResults = createMockModelResults(mockModels);

	const originalGetModelsAsync = modelMatchingEngine.getModelsAsync;
	modelMatchingEngine.getModelsAsync = async () => mockResults;

	try {
		const result = await engine.getDatabasesAsync();

		t.is(result.openModels.length, 2);
		t.true(result.openModels.every(m => m.local === true));
	} finally {
		modelMatchingEngine.getModelsAsync = originalGetModelsAsync;
	}
});

test.serial(
	'getDatabasesAsync returns proprietary models correctly',
	async t => {
		const engine = createFreshInstance();
		const mockModels = createMockModels();
		const mockResults = createMockModelResults(mockModels);

		const originalGetModelsAsync = modelMatchingEngine.getModelsAsync;
		modelMatchingEngine.getModelsAsync = async () => mockResults;

		try {
			const result = await engine.getDatabasesAsync();

			t.is(result.proprietaryModels.length, 2);
			t.true(result.proprietaryModels.every(m => m.local === false));
		} finally {
			modelMatchingEngine.getModelsAsync = originalGetModelsAsync;
		}
	},
);

test.serial('getDatabasesAsync returns latest models', async t => {
	const engine = createFreshInstance();
	const mockModels = createMockModels();
	const mockResults = createMockModelResults(mockModels);

	const originalGetModelsAsync = modelMatchingEngine.getModelsAsync;
	modelMatchingEngine.getModelsAsync = async () => mockResults;

	try {
		const result = await engine.getDatabasesAsync();

		t.is(result.latestModels.length, mockModels.length);
	} finally {
		modelMatchingEngine.getModelsAsync = originalGetModelsAsync;
	}
});

test.serial('getDatabasesAsync returns all models', async t => {
	const engine = createFreshInstance();
	const mockModels = createMockModels();
	const mockResults = createMockModelResults(mockModels);

	const originalGetModelsAsync = modelMatchingEngine.getModelsAsync;
	modelMatchingEngine.getModelsAsync = async () => mockResults;

	try {
		const result = await engine.getDatabasesAsync();

		t.is(result.allModels.length, mockModels.length);
	} finally {
		modelMatchingEngine.getModelsAsync = originalGetModelsAsync;
	}
});

test.serial('getDatabases handles empty model list', t => {
	const engine = createFreshInstance();
	const mockResults = createMockModelResults([]);

	const originalGetModels = modelMatchingEngine.getModels;
	modelMatchingEngine.getModels = () => mockResults;

	try {
		const result = engine.getDatabases();

		t.deepEqual(result.openModels, []);
		t.deepEqual(result.proprietaryModels, []);
		t.deepEqual(result.latestModels, []);
		t.deepEqual(result.allModels, []);
	} finally {
		modelMatchingEngine.getModels = originalGetModels;
	}
});

test.serial('getDatabasesAsync handles empty model list', async t => {
	const engine = createFreshInstance();
	const mockResults = createMockModelResults([]);

	const originalGetModelsAsync = modelMatchingEngine.getModelsAsync;
	modelMatchingEngine.getModelsAsync = async () => mockResults;

	try {
		const result = await engine.getDatabasesAsync();

		t.deepEqual(result.openModels, []);
		t.deepEqual(result.proprietaryModels, []);
		t.deepEqual(result.latestModels, []);
		t.deepEqual(result.allModels, []);
	} finally {
		modelMatchingEngine.getModelsAsync = originalGetModelsAsync;
	}
});

test.serial(
	'getDatabasesAsync handles errors from matching engine',
	async t => {
		const engine = createFreshInstance();

		const originalGetModelsAsync = modelMatchingEngine.getModelsAsync;
		modelMatchingEngine.getModelsAsync = async () => {
			throw new Error('Engine error');
		};

		try {
			await t.throwsAsync(() => engine.getDatabasesAsync(), {
				message: 'Engine error',
			});
		} finally {
			modelMatchingEngine.getModelsAsync = originalGetModelsAsync;
		}
	},
);

test.serial('getDatabases passes through all model properties', t => {
	const engine = createFreshInstance();
	const mockModels = createMockModels();
	const mockResults = createMockModelResults(mockModels);

	const originalGetModels = modelMatchingEngine.getModels;
	modelMatchingEngine.getModels = () => mockResults;

	try {
		const result = engine.getDatabases();
		const gpt4 = result.allModels.find(m => m.id === 'openai/gpt-4');

		t.truthy(gpt4);
		t.is(gpt4?.name, 'GPT-4');
		t.is(gpt4?.author, 'Openai');
		t.is(gpt4?.size, '128K');
		t.is(gpt4?.local, false);
		t.is(gpt4?.api, true);
		t.is(gpt4?.contextLength, 128000);
		t.is(gpt4?.quality.cost, 5);
		t.is(gpt4?.costType, 'paid');
		t.is(gpt4?.hasToolSupport, true);
	} finally {
		modelMatchingEngine.getModels = originalGetModels;
	}
});

test.serial(
	'getDatabasesAsync passes through all model properties',
	async t => {
		const engine = createFreshInstance();
		const mockModels = createMockModels();
		const mockResults = createMockModelResults(mockModels);

		const originalGetModelsAsync = modelMatchingEngine.getModelsAsync;
		modelMatchingEngine.getModelsAsync = async () => mockResults;

		try {
			const result = await engine.getDatabasesAsync();
			const llama = result.allModels.find(
				m => m.id === 'meta-llama/llama-3.1-70b',
			);

			t.truthy(llama);
			t.is(llama?.name, 'Llama 3.1 70B');
			t.is(llama?.author, 'Meta-llama');
			t.is(llama?.size, '128K');
			t.is(llama?.local, true);
			t.is(llama?.api, true);
			t.is(llama?.contextLength, 128000);
			t.is(llama?.quality.cost, 9);
			t.is(llama?.costType, 'free');
			t.is(llama?.hasToolSupport, true);
		} finally {
			modelMatchingEngine.getModelsAsync = originalGetModelsAsync;
		}
	},
);

test.serial(
	'getDatabases and getDatabasesAsync return equivalent structures',
	async t => {
		const engine = createFreshInstance();
		const mockModels = createMockModels();
		const mockResults = createMockModelResults(mockModels);

		const originalGetModels = modelMatchingEngine.getModels;
		const originalGetModelsAsync = modelMatchingEngine.getModelsAsync;
		modelMatchingEngine.getModels = () => mockResults;
		modelMatchingEngine.getModelsAsync = async () => mockResults;

		try {
			const syncResult = engine.getDatabases();
			const asyncResult = await engine.getDatabasesAsync();

			t.deepEqual(syncResult.openModels, asyncResult.openModels);
			t.deepEqual(syncResult.proprietaryModels, asyncResult.proprietaryModels);
			t.deepEqual(syncResult.latestModels, asyncResult.latestModels);
			t.deepEqual(syncResult.allModels, asyncResult.allModels);
		} finally {
			modelMatchingEngine.getModels = originalGetModels;
			modelMatchingEngine.getModelsAsync = originalGetModelsAsync;
		}
	},
);

test.serial('getDatabases handles only open models', t => {
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
	const mockResults = createMockModelResults(openOnlyModels);

	const originalGetModels = modelMatchingEngine.getModels;
	modelMatchingEngine.getModels = () => mockResults;

	try {
		const result = engine.getDatabases();

		t.is(result.openModels.length, 1);
		t.is(result.proprietaryModels.length, 0);
	} finally {
		modelMatchingEngine.getModels = originalGetModels;
	}
});

test.serial('getDatabases handles only proprietary models', t => {
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
	const mockResults = createMockModelResults(proprietaryOnlyModels);

	const originalGetModels = modelMatchingEngine.getModels;
	modelMatchingEngine.getModels = () => mockResults;

	try {
		const result = engine.getDatabases();

		t.is(result.openModels.length, 0);
		t.is(result.proprietaryModels.length, 1);
	} finally {
		modelMatchingEngine.getModels = originalGetModels;
	}
});
