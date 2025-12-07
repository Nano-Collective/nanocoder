import {ModelEntry} from '@/types/index';
import {fetchModels, isModelsCached, clearModelCache} from './model-fetcher';

export class ModelDatabase {
	private static instance: ModelDatabase;
	private cachedModels: ModelEntry[] | null = null;
	private fetchPromise: Promise<ModelEntry[]> | null = null;

	static getInstance(): ModelDatabase {
		if (!ModelDatabase.instance) {
			ModelDatabase.instance = new ModelDatabase();
		}
		return ModelDatabase.instance;
	}

	/**
	 * Get all models - returns cached data if available, empty array otherwise.
	 * Use getAllModelsAsync() for fetching fresh data.
	 */
	getAllModels(): ModelEntry[] {
		if (this.cachedModels) {
			return this.cachedModels;
		}

		// Trigger background fetch if not already in progress
		if (!this.fetchPromise) {
			void this.refreshModelsAsync();
		}

		// Return empty array - caller should use async method for fresh data
		return [];
	}

	/**
	 * Get all models asynchronously - fetches from APIs.
	 */
	async getAllModelsAsync(): Promise<ModelEntry[]> {
		// If we have cached models and they're still fresh, return them
		if (this.cachedModels && isModelsCached()) {
			return this.cachedModels;
		}

		// If fetch is in progress, wait for it
		if (this.fetchPromise) {
			return this.fetchPromise;
		}

		// Start fetch and wait
		return this.refreshModels();
	}

	/**
	 * Force refresh models from APIs
	 */
	async refreshModels(): Promise<ModelEntry[]> {
		this.fetchPromise = fetchModels();
		try {
			this.cachedModels = await this.fetchPromise;
			return this.cachedModels;
		} finally {
			this.fetchPromise = null;
		}
	}

	/**
	 * Internal async refresh that doesn't block
	 */
	private async refreshModelsAsync(): Promise<void> {
		if (this.fetchPromise) return;

		this.fetchPromise = fetchModels();
		try {
			this.cachedModels = await this.fetchPromise;
		} catch {
			// Silently fail - models will be empty
		} finally {
			this.fetchPromise = null;
		}
	}

	/**
	 * Clear cache to force fresh fetch on next call
	 */
	clearCache(): void {
		this.cachedModels = null;
		this.fetchPromise = null;
		clearModelCache();
	}
}

export const modelDatabase = ModelDatabase.getInstance();
