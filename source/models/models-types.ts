/**
 * Type definitions for models.dev API data structures
 */

export type ModelsDevModel = {
	id: string;
	name: string;
	release_date: string;
	attachment: boolean;
	reasoning: boolean;
	temperature: boolean;
	tool_call: boolean;
	cost: {
		input: number;
		output: number;
		cache_read?: number;
		cache_write?: number;
	};
	limit: {
		context: number;
		output: number;
	};
	modalities?: {
		input: Array<'text' | 'audio' | 'image' | 'video' | 'pdf'>;
		output: Array<'text' | 'audio' | 'image' | 'video' | 'pdf'>;
	};
	experimental?: boolean;
	status?: 'alpha' | 'beta' | 'deprecated';
	options: Record<string, unknown>;
	headers?: Record<string, string>;
	provider?: {npm: string};
};

export type ModelsDevProvider = {
	api?: string;
	name: string;
	env: string[];
	id: string;
	npm?: string;
	models: Record<string, ModelsDevModel>;
};

export type ModelsDevDatabase = Record<string, ModelsDevProvider>;

/**
 * Compact, columnar index of the models.dev database: model `i` is described by
 * element `i` of every column. See models-index.ts.
 */
export interface ModelsIndex {
	id: string[];
	name: string[];
	/** Context window in tokens, null when models.dev has no limit */
	context: Array<number | null>;
	/** Max output tokens, null when models.dev has no limit */
	output: Array<number | null>;
	tool: boolean[];
	/** 0 = no input modalities listed, 1 = listed without image, 2 = image input */
	image: number[];
	/** USD per 1M tokens */
	costInput: number[];
	costOutput: number[];
	/** null when models.dev omits the cache rate */
	cacheRead: Array<number | null>;
	cacheWrite: Array<number | null>;
}

/**
 * Cached models data with metadata
 */
export interface CachedModelsData {
	/** Cache format version; files with another version are ignored and refetched */
	version: number;
	data: ModelsIndex;
	fetchedAt: number;
	expiresAt: number;
}

/**
 * Model lookup result
 */
export interface ModelInfo {
	id: string;
	name: string;
	contextLimit: number | null;
	outputLimit: number | null;
	supportsToolCalls: boolean;
	cost: {
		input: number;
		output: number;
		cache_read?: number;
		cache_write?: number;
	};
}
