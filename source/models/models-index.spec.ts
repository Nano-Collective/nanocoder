import test from 'ava';
import {
	buildModelsIndex,
	findIndexedModelById,
	findIndexedModelByName,
	indexedModelAcceptsImages,
	isModelsIndex,
} from './models-index.js';
import type {
	ModelInfo,
	ModelsDevDatabase,
	ModelsDevModel,
	ModelsDevProvider,
} from './models-types.js';

console.log(`\nmodels-index.spec.ts`);

/**
 * The index replaced code that searched the raw models.dev database. The
 * reference functions below are that original lookup code, kept verbatim, so
 * these tests check the index returns exactly what the database scan did.
 */

type ReferenceInfo = Omit<ModelInfo, 'id' | 'name'> & {
	id: string;
	name: string;
};

function referenceInfo(model: ModelsDevModel): ReferenceInfo {
	return {
		id: model.id,
		name: model.name,
		contextLimit: model.limit?.context ?? null,
		outputLimit: model.limit?.output ?? null,
		supportsToolCalls: model.tool_call ?? false,
		cost: {
			input: model.cost?.input ?? 0,
			output: model.cost?.output ?? 0,
			...(model.cost?.cache_read != null
				? {cache_read: model.cost.cache_read}
				: {}),
			...(model.cost?.cache_write != null
				? {cache_write: model.cost.cache_write}
				: {}),
		},
	};
}

function referenceFindById(
	data: ModelsDevDatabase,
	modelId: string,
): ReferenceInfo | null {
	let bestMatch: ReferenceInfo | null = null;

	for (const [_providerId, provider] of Object.entries(data)) {
		if (!provider || typeof provider !== 'object' || !provider.models) {
			continue;
		}
		const model = provider.models[modelId];
		if (model) {
			const contextLimit = model.limit?.context ?? null;
			if (
				!bestMatch ||
				(contextLimit !== null &&
					(bestMatch.contextLimit === null ||
						contextLimit > bestMatch.contextLimit))
			) {
				bestMatch = referenceInfo(model);
			}
		}
	}

	return bestMatch;
}

function referenceFindByName(
	data: ModelsDevDatabase,
	modelName: string,
): ReferenceInfo | null {
	if (!modelName) {
		return null;
	}

	const lowerName = modelName.toLowerCase();

	let bestMatch: ReferenceInfo | null = null;
	let bestScore = 0;

	for (const [_providerId, provider] of Object.entries(data)) {
		if (!provider || typeof provider !== 'object' || !provider.models) {
			continue;
		}
		for (const [_modelId, model] of Object.entries(provider.models)) {
			if (!model || typeof model !== 'object') {
				continue;
			}

			const modelIdLower = model.id?.toLowerCase() ?? '';
			const modelNameLower = model.name?.toLowerCase() ?? '';

			let score = 0;

			if (modelIdLower === lowerName) {
				return referenceInfo(model);
			}

			if (modelIdLower.startsWith(lowerName)) {
				score = 3;
			} else if (modelNameLower.startsWith(lowerName)) {
				score = 2;
			} else if (
				modelIdLower.includes(lowerName) ||
				modelNameLower.includes(lowerName)
			) {
				score = 1;
			}

			if (score > bestScore) {
				bestScore = score;
				bestMatch = referenceInfo(model);
			}
		}
	}

	return bestMatch;
}

function referenceAcceptsImages(
	data: ModelsDevDatabase,
	modelId: string,
): boolean | null {
	let listed = false;
	for (const provider of Object.values(data ?? {})) {
		const input = provider?.models?.[modelId]?.modalities?.input;
		if (input?.includes('image')) {
			return true;
		}
		listed ||= !!input;
	}
	return listed ? false : null;
}

// ============================================================================
// Fixtures
// ============================================================================

function model(
	id: string,
	name: string,
	overrides: Partial<ModelsDevModel> = {},
): ModelsDevModel {
	return {
		id,
		name,
		release_date: '2025-01-01',
		attachment: false,
		reasoning: false,
		temperature: true,
		tool_call: true,
		cost: {input: 1, output: 2},
		limit: {context: 8192, output: 4096},
		modalities: {input: ['text'], output: ['text']},
		options: {},
		...overrides,
	};
}

function provider(
	id: string,
	models: ModelsDevModel[],
): ModelsDevProvider {
	return {
		id,
		name: id,
		env: [],
		models: Object.fromEntries(models.map(m => [m.id, m])),
	};
}

/** Edge cases: duplicate ids, ties, missing fields and malformed entries. */
function edgeCaseDatabase(): ModelsDevDatabase {
	return {
		alpha: provider('alpha', [
			model('gpt-4o', 'GPT-4o', {
				limit: {context: 128000, output: 16384},
				cost: {input: 2.5, output: 10, cache_read: 1.25},
				modalities: {input: ['text', 'image'], output: ['text']},
			}),
			model('llama3.1', 'Llama 3.1', {limit: {context: 131072, output: 4096}}),
			model('Claude-3-Opus', 'Claude 3 Opus', {
				cost: {input: 15, output: 75, cache_read: 1.5, cache_write: 18.75},
			}),
			model('qwen2.5-coder-7b', 'Qwen2.5 Coder 7B', {tool_call: false}),
			model('same-limit', 'Same Limit', {cost: {input: 1, output: 1}}),
			model('free-model', 'Free Model', {cost: {input: 0, output: 0}}),
			model('no-modalities', 'No Modalities', {modalities: undefined}),
		]),
		beta: provider('beta', [
			// Same id as alpha with a higher limit: the higher limit must win.
			model('gpt-4o', 'GPT-4o (Beta)', {
				limit: {context: 200000, output: 8192},
				cost: {input: 3, output: 12},
				modalities: {input: ['text'], output: ['text']},
			}),
			// Same id and limit as alpha's: the first listed must win.
			model('same-limit', 'Same Limit Beta', {cost: {input: 9, output: 9}}),
			// No limit at all.
			model('mock-null-limit', 'Mock Null Limit', {
				limit: undefined as unknown as ModelsDevModel['limit'],
			}),
			model('llama3.1', 'Llama 3.1 Beta', {
				limit: undefined as unknown as ModelsDevModel['limit'],
			}),
			// Only the write rate is published.
			model('cache-write-only', 'Cache Write Only', {
				cost: {input: 4, output: 8, cache_write: 5},
			}),
		]),
		// Malformed providers and models are skipped.
		broken: null as unknown as ModelsDevProvider,
		empty: {id: 'empty', name: 'Empty', env: []} as unknown as ModelsDevProvider,
		partial: {
			id: 'partial',
			name: 'Partial',
			env: [],
			models: {
				bad: null as unknown as ModelsDevModel,
				'gemma-2-9b': model('gemma-2-9b', 'Gemma 2 9B'),
			},
		},
	};
}

/** Deterministic pseudo-random database at roughly the real models.dev scale. */
function largeDatabase(): ModelsDevDatabase {
	let seed = 7;
	const rnd = () => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
	const pick = <T>(items: T[]): T => items[Math.floor(rnd() * items.length)];
	const families = ['gpt', 'claude', 'llama', 'qwen', 'mistral', 'gemma'];
	const variants = ['instruct', 'chat', 'coder', 'mini', 'pro', 'flash'];
	const sizes = ['1b', '7b', '8b', '14b', '70b', 'a3b'];
	const limits = [8192, 32000, 128000, 200000, null];

	const db: ModelsDevDatabase = {};
	for (let p = 0; p < 60; p++) {
		const models: ModelsDevModel[] = [];
		for (let m = 0; m < 80; m++) {
			// A small id space, so ids repeat across providers like they do on
			// models.dev, and mixed-case ids/names exercise lowercasing.
			const id = `${pick(families)}-${Math.floor(rnd() * 4) + 1}-${pick(sizes)}-${pick(variants)}`;
			const context = pick(limits);
			models.push(
				model(
					rnd() < 0.1 ? id.toUpperCase() : id,
					id.replaceAll('-', ' '),
					{
						limit:
							context === null
								? (undefined as unknown as ModelsDevModel['limit'])
								: {context, output: 4096},
						cost: {
							input: Math.round(rnd() * 1000) / 100,
							output: Math.round(rnd() * 3000) / 100,
							...(rnd() < 0.5 ? {cache_read: Math.round(rnd() * 100) / 100} : {}),
						},
						tool_call: rnd() < 0.8,
						modalities:
							rnd() < 0.2
								? undefined
								: {
										input: rnd() < 0.4 ? ['text', 'image'] : ['text'],
										output: ['text'],
									},
					},
				),
			);
		}
		db[`provider-${p}`] = provider(`provider-${p}`, models);
	}
	return db;
}

function allIds(db: ModelsDevDatabase): string[] {
	const ids = new Set<string>();
	for (const p of Object.values(db)) {
		for (const id of Object.keys(p?.models ?? {})) {
			ids.add(id);
		}
	}
	return [...ids];
}

/** Ids plus the kinds of names users actually type for local models. */
function nameQueries(db: ModelsDevDatabase): string[] {
	const queries = new Set<string>([
		'',
		'zzz-not-a-model',
		'mock-model',
		'qwen2.5-coder:7b',
		'llama3.1:8b',
		'LLAMA3.1',
		'gpt',
		'GPT-4O',
		'gemma 2',
		'coder',
		'7b',
		'free',
	]);
	for (const id of allIds(db)) {
		queries.add(id);
		queries.add(id.toLowerCase());
		queries.add(id.toUpperCase());
		queries.add(id.slice(0, 4));
		queries.add(id.slice(2, 9));
		queries.add(`${id}-extra`);
	}
	return [...queries];
}

// ============================================================================
// Same results as the original database scan
// ============================================================================

for (const [label, build] of [
	['edge-case', edgeCaseDatabase],
	['large', largeDatabase],
] as const) {
	test(`index matches database scan: findById (${label} database)`, t => {
		const db = build();
		const index = buildModelsIndex(db);

		for (const id of [...allIds(db), 'missing-model', 'GPT-4O']) {
			t.deepEqual(
				findIndexedModelById(index, id),
				referenceFindById(db, id),
				`findById ${id}`,
			);
		}
	});

	test(`index matches database scan: findByName (${label} database)`, t => {
		const db = build();
		const index = buildModelsIndex(db);

		for (const query of nameQueries(db)) {
			t.deepEqual(
				findIndexedModelByName(index, query),
				referenceFindByName(db, query),
				`findByName "${query}"`,
			);
		}
	});

	test(`index matches database scan: acceptsImages (${label} database)`, t => {
		const db = build();
		const index = buildModelsIndex(db);

		for (const id of [...allIds(db), 'missing-model']) {
			t.is(
				indexedModelAcceptsImages(index, id),
				referenceAcceptsImages(db, id),
				`acceptsImages ${id}`,
			);
		}
	});
}

test('index survives the cache round-trip (JSON) unchanged', t => {
	const db = largeDatabase();
	const index = buildModelsIndex(db);
	const reloaded = JSON.parse(JSON.stringify(index)) as typeof index;

	t.true(isModelsIndex(reloaded));
	for (const id of allIds(db).slice(0, 50)) {
		t.deepEqual(
			findIndexedModelById(reloaded, id),
			referenceFindById(db, id),
		);
	}
});

// ============================================================================
// Specific behaviours
// ============================================================================

test('findById picks the highest context limit across providers', t => {
	const index = buildModelsIndex(edgeCaseDatabase());

	const found = findIndexedModelById(index, 'gpt-4o');
	t.is(found?.contextLimit, 200000);
	t.is(found?.cost.input, 3);
});

test('findById keeps the first listed model on equal limits', t => {
	const index = buildModelsIndex(edgeCaseDatabase());

	t.is(findIndexedModelById(index, 'same-limit')?.cost.input, 1);
});

test('cache rates stay undefined when models.dev omits them, never 0', t => {
	const index = buildModelsIndex(edgeCaseDatabase());

	const none = findIndexedModelById(index, 'free-model');
	t.false('cache_read' in (none?.cost ?? {}));
	t.false('cache_write' in (none?.cost ?? {}));

	const writeOnly = findIndexedModelById(index, 'cache-write-only');
	t.false('cache_read' in (writeOnly?.cost ?? {}));
	t.is(writeOnly?.cost.cache_write, 5);
});

test('models without a limit report null, not 0', t => {
	const index = buildModelsIndex(edgeCaseDatabase());

	t.is(findIndexedModelById(index, 'mock-null-limit')?.contextLimit, null);
});

test('findByName returns null for an empty name and for no match', t => {
	const index = buildModelsIndex(edgeCaseDatabase());

	t.is(findIndexedModelByName(index, ''), null);
	t.is(findIndexedModelByName(index, 'definitely-not-listed'), null);
});

test('acceptsImages distinguishes text-only models from unlisted ones', t => {
	const index = buildModelsIndex(edgeCaseDatabase());

	t.true(indexedModelAcceptsImages(index, 'gpt-4o'));
	t.false(indexedModelAcceptsImages(index, 'llama3.1'));
	t.is(indexedModelAcceptsImages(index, 'no-modalities'), null);
	t.is(indexedModelAcceptsImages(index, 'not-listed'), null);
});

test('buildModelsIndex skips malformed providers and models', t => {
	const index = buildModelsIndex(edgeCaseDatabase());

	t.true(index.id.includes('gemma-2-9b'));
	t.false(index.id.includes('bad'));
});

// ============================================================================
// Shape validation
// ============================================================================

test('isModelsIndex accepts a built index', t => {
	t.true(isModelsIndex(buildModelsIndex(edgeCaseDatabase())));
	t.true(isModelsIndex(buildModelsIndex({})));
});

test('isModelsIndex rejects the old full-database format and bad shapes', t => {
	t.false(isModelsIndex(null));
	t.false(isModelsIndex({}));
	t.false(isModelsIndex([]));
	// The format older versions cached: providers keyed by id.
	t.false(isModelsIndex(edgeCaseDatabase()));

	const truncated = buildModelsIndex(edgeCaseDatabase());
	truncated.costInput.pop();
	t.false(isModelsIndex(truncated));
});
