/**
 * Compact, columnar index of the models.dev database.
 *
 * The full models.dev payload is ~10 MB once parsed (230 providers, ~8.9k
 * models, most of it fields we never read). Lookups only need a model's id,
 * name, limits, pricing and a couple of capability flags, so we keep exactly
 * that, stored as one array per field (struct-of-arrays) rather than one object
 * per model. Per-object overhead dominates at this size, so the columnar layout
 * retains a fraction of the memory and parses faster from the on-disk cache.
 *
 * Models keep the order they have in the database (provider order, then model
 * order), because lookups break score ties by first match.
 */

import type {
	ModelInfo,
	ModelsDevDatabase,
	ModelsIndex,
} from './models-types.js';

/** How a model's `modalities.input` is recorded in `ModelsIndex.image`. */
const IMAGE_UNKNOWN = 0; // no modalities.input listed
const IMAGE_NO = 1; // modalities.input listed without image
const IMAGE_YES = 2; // modalities.input includes image

const COLUMNS = [
	'id',
	'name',
	'context',
	'output',
	'tool',
	'image',
	'costInput',
	'costOutput',
	'cacheRead',
	'cacheWrite',
] as const;

/**
 * Project the raw models.dev database into the compact index.
 * Malformed provider and model entries are skipped.
 */
export function buildModelsIndex(db: ModelsDevDatabase): ModelsIndex {
	const index: ModelsIndex = {
		id: [],
		name: [],
		context: [],
		output: [],
		tool: [],
		image: [],
		costInput: [],
		costOutput: [],
		cacheRead: [],
		cacheWrite: [],
	};

	for (const provider of Object.values(db)) {
		if (!provider || typeof provider !== 'object' || !provider.models) {
			continue;
		}
		for (const model of Object.values(provider.models)) {
			if (!model || typeof model !== 'object') {
				continue;
			}
			const input = model.modalities?.input;

			index.id.push(model.id ?? '');
			index.name.push(model.name ?? '');
			index.context.push(model.limit?.context ?? null);
			index.output.push(model.limit?.output ?? null);
			index.tool.push(model.tool_call ?? false);
			index.image.push(
				input
					? input.includes('image')
						? IMAGE_YES
						: IMAGE_NO
					: IMAGE_UNKNOWN,
			);
			index.costInput.push(model.cost?.input ?? 0);
			index.costOutput.push(model.cost?.output ?? 0);
			// Kept as null rather than 0 when models.dev omits them: pricing falls
			// back to the input rate, and a 0 would price cache hits as free.
			index.cacheRead.push(model.cost?.cache_read ?? null);
			index.cacheWrite.push(model.cost?.cache_write ?? null);
		}
	}

	return index;
}

/**
 * Whether a value read back from the cache has the shape of a ModelsIndex:
 * every column present, an array, and all the same length.
 */
export function isModelsIndex(value: unknown): value is ModelsIndex {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const record = value as Record<string, unknown>;
	let length: number | undefined;
	for (const column of COLUMNS) {
		const values = record[column];
		if (!Array.isArray(values)) {
			return false;
		}
		length ??= values.length;
		if (values.length !== length) {
			return false;
		}
	}
	return true;
}

function toModelInfo(index: ModelsIndex, i: number): ModelInfo {
	const cacheRead = index.cacheRead[i];
	const cacheWrite = index.cacheWrite[i];
	return {
		id: index.id[i],
		name: index.name[i],
		contextLimit: index.context[i],
		outputLimit: index.output[i],
		supportsToolCalls: index.tool[i],
		cost: {
			input: index.costInput[i],
			output: index.costOutput[i],
			...(cacheRead !== null ? {cache_read: cacheRead} : {}),
			...(cacheWrite !== null ? {cache_write: cacheWrite} : {}),
		},
	};
}

/**
 * Find a model by exact ID across all providers. When several providers list
 * it, the one with the highest context limit wins (first listed on ties).
 */
export function findIndexedModelById(
	index: ModelsIndex,
	modelId: string,
): ModelInfo | null {
	let best = -1;

	for (let i = 0; i < index.id.length; i++) {
		if (index.id[i] !== modelId) {
			continue;
		}
		const context = index.context[i];
		if (
			best === -1 ||
			(context !== null &&
				(index.context[best] === null || context > (index.context[best] ?? 0)))
		) {
			best = i;
		}
	}

	return best === -1 ? null : toModelInfo(index, best);
}

/**
 * Find a model by partial name match, for local models whose id may not match
 * exactly. An exact (case-insensitive) id match wins outright. Otherwise the
 * highest score wins, first listed on ties:
 *   3 id starts with the term, 2 name starts with it, 1 id or name contains it.
 */
export function findIndexedModelByName(
	index: ModelsIndex,
	modelName: string,
): ModelInfo | null {
	// Empty string matches everything with .includes(), so return null early
	if (!modelName) {
		return null;
	}

	const needle = modelName.toLowerCase();
	let best = -1;
	let bestScore = 0;

	for (let i = 0; i < index.id.length; i++) {
		const idLower = index.id[i].toLowerCase();

		if (idLower === needle) {
			return toModelInfo(index, i);
		}

		let score = 0;
		if (idLower.startsWith(needle)) {
			score = 3;
		} else {
			const nameLower = index.name[i].toLowerCase();
			if (nameLower.startsWith(needle)) {
				score = 2;
			} else if (idLower.includes(needle) || nameLower.includes(needle)) {
				score = 1;
			}
		}

		if (score > bestScore) {
			bestScore = score;
			best = i;
		}
	}

	return best === -1 ? null : toModelInfo(index, best);
}

/**
 * Whether the index lists image input for this exact model id. Providers can
 * disagree, so any listing with image input wins. null when the model has no
 * listing at all (most local models), so callers can still try.
 */
export function indexedModelAcceptsImages(
	index: ModelsIndex,
	modelId: string,
): boolean | null {
	let listed = false;

	for (let i = 0; i < index.id.length; i++) {
		if (index.id[i] !== modelId) {
			continue;
		}
		if (index.image[i] === IMAGE_YES) {
			return true;
		}
		listed ||= index.image[i] !== IMAGE_UNKNOWN;
	}

	return listed ? false : null;
}
