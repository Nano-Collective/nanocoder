import {ModelEntry} from '@/types/index';
import {modelMatchingEngine, ModelResults} from '@/model-database/model-engine';

export interface DatabaseResult {
	openModels: ModelEntry[];
	proprietaryModels: ModelEntry[];
	latestModels: ModelEntry[];
	allModels: ModelEntry[];
}

export class DatabaseEngine {
	private static instance: DatabaseEngine;

	static getInstance(): DatabaseEngine {
		if (!DatabaseEngine.instance) {
			DatabaseEngine.instance = new DatabaseEngine();
		}
		return DatabaseEngine.instance;
	}

	/**
	 * Get model lists (sync - uses cached data)
	 */
	getDatabases(): DatabaseResult {
		const results = modelMatchingEngine.getModels();
		return this.processResults(results);
	}

	/**
	 * Get model lists asynchronously - fetches fresh data
	 */
	async getDatabasesAsync(): Promise<DatabaseResult> {
		const results = await modelMatchingEngine.getModelsAsync();
		return this.processResults(results);
	}

	/**
	 * Process model results into database result
	 */
	private processResults(results: ModelResults): DatabaseResult {
		return {
			openModels: results.openModels,
			proprietaryModels: results.proprietaryModels,
			latestModels: results.latestModels,
			allModels: results.allModels,
		};
	}
}

export const databaseEngine = DatabaseEngine.getInstance();
