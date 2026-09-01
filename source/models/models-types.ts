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
 * Cached models data with metadata
 */
export interface CachedModelsData {
	data: ModelsDevDatabase;
	fetchedAt: number;
	expiresAt: number;
}

/**
 * Model lookup result
 */
export interface ModelInfo {
	id: string;
	name: string;
	provider: string;
	contextLimit: number;
	outputLimit: number;
	supportsToolCalls: boolean;
	cost: {
		input: number;
		output: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
}
