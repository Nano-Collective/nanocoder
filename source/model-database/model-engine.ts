import {ModelEntry} from '@/types/index';
import {modelDatabase} from '@/model-database/model-database';

export interface ModelResults {
	allModels: ModelEntry[];
	openModels: ModelEntry[];
	proprietaryModels: ModelEntry[];
	latestModels: ModelEntry[];
}

export class ModelMatchingEngine {
	private static instance: ModelMatchingEngine;

	static getInstance(): ModelMatchingEngine {
		if (!ModelMatchingEngine.instance) {
			ModelMatchingEngine.instance = new ModelMatchingEngine();
		}
		return ModelMatchingEngine.instance;
	}

	/**
	 * Get all models - sync version (from cache)
	 */
	getModels(): ModelResults {
		const allModels = modelDatabase.getAllModels();
		return this.processModels(allModels);
	}

	/**
	 * Get all models - async version for fresh data
	 */
	async getModelsAsync(): Promise<ModelResults> {
		const allModels = await modelDatabase.getAllModelsAsync();
		return this.processModels(allModels);
	}

	/**
	 * Process models into categorized lists
	 */
	private processModels(allModels: ModelEntry[]): ModelResults {
		// Open models (open weights) - sorted by newest
		const openModels = allModels
			.filter(m => m.local)
			.sort((a, b) => b.created - a.created);

		// Proprietary models - sorted by newest
		const proprietaryModels = allModels
			.filter(m => !m.local)
			.sort((a, b) => b.created - a.created);

		// Latest models (all, sorted by newest) - top 50
		const latestModels = [...allModels]
			.sort((a, b) => b.created - a.created)
			.slice(0, 50);

		return {
			allModels,
			openModels,
			proprietaryModels,
			latestModels,
		};
	}
}

export const modelMatchingEngine = ModelMatchingEngine.getInstance();
