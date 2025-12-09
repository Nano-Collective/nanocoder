/**
 * Log query interface for searching and analyzing log data
 * Provides powerful filtering, searching, and analytics capabilities
 */

import {
	generateCorrelationId,
	getLogger,
} from './index.js';

// Get logger instance directly to avoid circular dependencies
const logger = getLogger();

/**
 * Log entry structure for querying
 */
export interface LogEntry {
	timestamp: string;
	level: string;
	message: string;
	correlationId?: string;
	source?: string;
	requestId?: string;
	userId?: string;
	sessionId?: string;
	tags?: string[];
	metadata?: Record<string, any>;
	error?: {
		name?: string;
		message?: string;
		stack?: string;
		type?: string;
	};
	performance?: {
		duration?: number;
		memory?: Record<string, any>;
		cpu?: number;
	};
	request?: {
		method?: string;
		url?: string;
		statusCode?: number;
		duration?: number;
		size?: number;
	};
}

/**
 * Query filters for log searching
 */
export interface LogQuery {
	// Time range
	startTime?: Date;
	endTime?: Date;

	// Log level filtering
	levels?: string[];
	excludeLevels?: string[];

	// Message filtering
	messageContains?: string;
	messageRegex?: RegExp;
	messageStartsWith?: string;
	messageEndsWith?: string;

	// Correlation and request filtering
	correlationIds?: string[];
	requestIds?: string[];
	userIds?: string[];
	sessionIds?: string[];

	// Source and component filtering
	sources?: string[];
	excludeSources?: string[];

	// Tag filtering
	tags?: string[];
	excludeTags?: string[];
	hasTags?: boolean;

	// Metadata filtering
	metadataKey?: string;
	metadataValue?: any;
	metadataExists?: string;

	// Performance filtering
	durationMin?: number;
	durationMax?: number;
	memoryThreshold?: number;

	// Error filtering
	hasErrors?: boolean;
	errorTypes?: string[];

	// Request filtering
	requestMethods?: string[];
	requestStatusCodes?: number[];
	requestDurationMin?: number;
	requestDurationMax?: number;

	// Pagination
	limit?: number;
	offset?: number;
	sortBy?: 'timestamp' | 'level' | 'duration' | 'memory';
	sortOrder?: 'asc' | 'desc';
}

/**
 * Query result with metadata
 */
export interface QueryResult {
	entries: LogEntry[];
	totalCount: number;
	filteredCount: number;
	queryTime: number;
	hasMore: boolean;
	facets?: {
		levels: Record<string, number>;
		sources: Record<string, number>;
		tags: Record<string, number>;
		errorTypes: Record<string, number>;
		hours: Record<string, number>;
	};
}

/**
 * Log aggregation options
 */
export interface AggregationOptions {
	groupBy: 'hour' | 'day' | 'level' | 'source' | 'correlationId' | 'errorType';
	aggregations: (
		| 'count'
		| 'avgDuration'
		| 'maxDuration'
		| 'minDuration'
		| 'sumDuration'
		| 'errorRate'
		| 'memoryUsage'
	)[];
	timeRange?: {
		startTime: Date;
		endTime: Date;
	};
}

/**
 * Log aggregation result
 */
export interface AggregationResult {
	groups: Record<
		string,
		{
			count: number;
			avgDuration?: number;
			maxDuration?: number;
			minDuration?: number;
			sumDuration?: number;
			errorRate?: number;
			memoryUsage?: {
				avgHeapUsed: number;
				maxHeapUsed: number;
				minHeapUsed: number;
			};
			samples?: LogEntry[];
		}
	>;
	totalGroups: number;
	queryTime: number;
}

/**
 * In-memory log storage for querying (in production, this would connect to a log database)
 */
class LogStorage {
	private entries: LogEntry[] = [];
	private maxEntries: number;
	private indexes: Map<string, Set<string>> = new Map();

	constructor(maxEntries: number = 10000) {
		this.maxEntries = maxEntries;
	}

	/**
	 * Add a log entry
	 */
	addEntry(entry: LogEntry): void {
		// Add to main storage
		this.entries.push(entry);

		// Maintain max size limit
		if (this.entries.length > this.maxEntries) {
			const removed = this.entries.shift();
			if (removed) {
				this.updateIndexes(removed, false); // Remove from indexes
			}
		}

		// Update indexes
		this.updateIndexes(entry, true);
	}

	/**
	 * Query log entries
	 */
	query(query: LogQuery): QueryResult {
		const startTime = performance.now();

		let filteredEntries = this.entries.filter(entry =>
			this.matchesQuery(entry, query),
		);

		// Apply sorting
		if (query.sortBy) {
			filteredEntries.sort((a, b) => {
				const aValue = this.getSortValue(a, query.sortBy!);
				const bValue = this.getSortValue(b, query.sortBy!);
				const comparison = aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
				return query.sortOrder === 'desc' ? -comparison : comparison;
			});
		}

		// Apply pagination
		const totalCount = filteredEntries.length;
		const offset = query.offset || 0;
		const limit = query.limit || 100;
		const paginatedEntries = filteredEntries.slice(offset, offset + limit);

		const queryTime = performance.now() - startTime;

		// Generate facets
		const filteredCount = filteredEntries.length;
		const facets = this.generateFacets(filteredEntries);

		return {
			entries: paginatedEntries,
			totalCount: this.entries.length,
			filteredCount,
			queryTime,
			hasMore: offset + limit < filteredEntries.length,
			facets,
		};
	}

	/**
	 * Aggregate log entries
	 */
	aggregate(options: AggregationOptions): AggregationResult {
		const startTime = performance.now();

		// Filter by time range if specified
		let entries = this.entries;
		if (options.timeRange?.startTime && options.timeRange?.endTime) {
			entries = entries.filter(entry => {
				const entryTime = new Date(entry.timestamp);
				return (
					entryTime >= options.timeRange!.startTime &&
					entryTime <= options.timeRange!.endTime
				);
			});
		}

		const groups: Record<string, any> = {};

		for (const entry of entries) {
			const groupKey = this.getGroupKey(entry, options.groupBy);

			if (!groups[groupKey]) {
				groups[groupKey] = {
					count: 0,
					durations: [],
					memoryUsages: [],
					errorCount: 0,
					samples: [],
				};
			}

			const group = groups[groupKey];
			group.count++;

			if (entry.performance?.duration) {
				group.durations.push(entry.performance.duration);
			}

			if (entry.performance?.memory) {
				group.memoryUsages.push(entry.performance.memory.heapUsed || 0);
			}

			if (entry.error) {
				group.errorCount++;
			}

			// Keep sample entries for analysis
			if (group.samples.length < 10) {
				group.samples.push(entry);
			}
		}

		// Calculate aggregations
		const result: Record<string, any> = {};

		for (const [groupKey, group] of Object.entries(groups)) {
			const groupResult: any = {count: group.count};

			if (
				options.aggregations.includes('avgDuration') &&
				group.durations.length > 0
			) {
				groupResult.avgDuration =
					group.durations.reduce((sum: number, d: number) => sum + d, 0) /
					group.durations.length;
			}

			if (
				options.aggregations.includes('maxDuration') &&
				group.durations.length > 0
			) {
				groupResult.maxDuration = Math.max(...group.durations);
			}

			if (
				options.aggregations.includes('minDuration') &&
				group.durations.length > 0
			) {
				groupResult.minDuration = Math.min(...group.durations);
			}

			if (options.aggregations.includes('sumDuration')) {
				groupResult.sumDuration = group.durations.reduce(
					(sum: number, d: number) => sum + d,
					0,
				);
			}

			if (options.aggregations.includes('errorRate')) {
				groupResult.errorRate = group.errorCount / group.count;
			}

			if (
				options.aggregations.includes('memoryUsage') &&
				group.memoryUsages.length > 0
			) {
				groupResult.memoryUsage = {
					avgHeapUsed:
						group.memoryUsages.reduce((sum: number, m: number) => sum + m, 0) /
						group.memoryUsages.length,
					maxHeapUsed: Math.max(...group.memoryUsages),
					minHeapUsed: Math.min(...group.memoryUsages),
				};
			}

			if (options.aggregations.includes('count')) {
				groupResult.samples = group.samples;
			}

			result[groupKey] = groupResult;
		}

		const queryTime = performance.now() - startTime;

		return {
			groups: result,
			totalGroups: Object.keys(result).length,
			queryTime,
		};
	}

	/**
	 * Get entry count
	 */
	getEntryCount(): number {
		return this.entries.length;
	}

	/**
	 * Clear all entries
	 */
	clear(): void {
		this.entries = [];
		this.indexes.clear();
	}

	private matchesQuery(entry: LogEntry, query: LogQuery): boolean {
		// Time range filtering
		if (query.startTime && new Date(entry.timestamp) < query.startTime)
			return false;
		if (query.endTime && new Date(entry.timestamp) > query.endTime)
			return false;

		// Level filtering
		if (query.levels && !query.levels.includes(entry.level)) return false;
		if (query.excludeLevels && query.excludeLevels.includes(entry.level))
			return false;

		// Message filtering
		if (query.messageContains && !entry.message.includes(query.messageContains))
			return false;
		if (query.messageRegex && !query.messageRegex.test(entry.message))
			return false;
		if (
			query.messageStartsWith &&
			!entry.message.startsWith(query.messageStartsWith)
		)
			return false;
		if (query.messageEndsWith && !entry.message.endsWith(query.messageEndsWith))
			return false;

		// Correlation and request filtering
		if (query.correlationIds && !entry.correlationId) return false;
		if (
			query.correlationIds &&
			entry.correlationId &&
			!query.correlationIds.includes(entry.correlationId)
		)
			return false;
		if (
			query.requestIds &&
			entry.requestId &&
			!query.requestIds.includes(entry.requestId)
		)
			return false;
		if (query.userIds && entry.userId && !query.userIds.includes(entry.userId))
			return false;
		if (
			query.sessionIds &&
			entry.sessionId &&
			!query.sessionIds.includes(entry.sessionId)
		)
			return false;

		// Source filtering
		if (query.sources && entry.source && !query.sources.includes(entry.source))
			return false;
		if (
			query.excludeSources &&
			entry.source &&
			query.excludeSources.includes(entry.source)
		)
			return false;

		// Tag filtering
		if (query.hasTags && (!entry.tags || entry.tags.length === 0)) return false;
		if (query.tags && entry.tags) {
			const hasAnyTag = query.tags.some(tag => entry.tags!.includes(tag));
			if (!hasAnyTag) return false;
		}
		if (query.excludeTags && entry.tags) {
			const hasExcludedTag = query.excludeTags.some(tag =>
				entry.tags!.includes(tag),
			);
			if (hasExcludedTag) return false;
		}

		// Metadata filtering
		if (
			query.metadataKey &&
			(!entry.metadata || !(query.metadataKey in entry.metadata))
		)
			return false;
		if (query.metadataKey && query.metadataValue !== undefined) {
			if (entry.metadata![query.metadataKey] !== query.metadataValue)
				return false;
		}
		if (
			query.metadataExists &&
			(!entry.metadata || !(query.metadataExists in entry.metadata))
		)
			return false;

		// Performance filtering
		if (
			query.durationMin &&
			entry.performance?.duration &&
			entry.performance.duration < query.durationMin
		)
			return false;
		if (
			query.durationMax &&
			entry.performance?.duration &&
			entry.performance.duration > query.durationMax
		)
			return false;
		if (
			query.memoryThreshold &&
			entry.performance?.memory?.heapUsed &&
			entry.performance.memory.heapUsed > query.memoryThreshold
		)
			return false;

		// Error filtering
		if (query.hasErrors !== undefined) {
			const hasError = !!entry.error;
			if (hasError !== query.hasErrors) return false;
		}
		if (
			query.errorTypes &&
			entry.error &&
			!query.errorTypes.includes(entry.error.type || '')
		)
			return false;

		// Request filtering
		if (
			query.requestMethods &&
			entry.request?.method &&
			!query.requestMethods.includes(entry.request.method)
		)
			return false;
		if (
			query.requestStatusCodes &&
			entry.request?.statusCode &&
			!query.requestStatusCodes.includes(entry.request.statusCode)
		)
			return false;
		if (
			query.requestDurationMin &&
			entry.request?.duration &&
			entry.request.duration < query.requestDurationMin
		)
			return false;
		if (
			query.requestDurationMax &&
			entry.request?.duration &&
			entry.request.duration > query.requestDurationMax
		)
			return false;

		return true;
	}

	private getSortValue(entry: LogEntry, sortBy: string): any {
		switch (sortBy) {
			case 'timestamp':
				return new Date(entry.timestamp).getTime();
			case 'level':
				return this.getLevelPriority(entry.level);
			case 'duration':
				return entry.performance?.duration || 0;
			case 'memory':
				return entry.performance?.memory?.heapUsed || 0;
			default:
				return 0;
		}
	}

	private getLevelPriority(level: string): number {
		const priorities: Record<string, number> = {
			fatal: 0,
			error: 1,
			warn: 2,
			info: 3,
			http: 4,
			debug: 5,
			trace: 6,
		};
		return priorities[level] || 6;
	}

	private getGroupKey(entry: LogEntry, groupBy: string): string {
		switch (groupBy) {
			case 'hour':
				return new Date(entry.timestamp).toISOString().substring(0, 13); // YYYY-MM-DDTHH
			case 'day':
				return new Date(entry.timestamp).toISOString().substring(0, 10); // YYYY-MM-DD
			case 'level':
				return entry.level;
			case 'source':
				return entry.source || 'unknown';
			case 'correlationId':
				return entry.correlationId || 'no-correlation';
			case 'errorType':
				return entry.error?.type || 'no-error';
			default:
				return 'unknown';
		}
	}

	private generateFacets(entries: LogEntry[]) {
		const facets = {
			levels: {} as Record<string, number>,
			sources: {} as Record<string, number>,
			tags: {} as Record<string, number>,
			errorTypes: {} as Record<string, number>,
			hours: {} as Record<string, number>,
		};

		for (const entry of entries) {
			// Level facet
			facets.levels[entry.level] = (facets.levels[entry.level] || 0) + 1;

			// Source facet
			if (entry.source) {
				facets.sources[entry.source] = (facets.sources[entry.source] || 0) + 1;
			}

			// Tags facet
			if (entry.tags) {
				for (const tag of entry.tags) {
					facets.tags[tag] = (facets.tags[tag] || 0) + 1;
				}
			}

			// Error type facet
			if (entry.error?.type) {
				facets.errorTypes[entry.error.type] =
					(facets.errorTypes[entry.error.type] || 0) + 1;
			}

			// Hour facet
			const hour = new Date(entry.timestamp).toISOString().substring(0, 13);
			facets.hours[hour] = (facets.hours[hour] || 0) + 1;
		}

		return facets;
	}

	private updateIndexes(entry: LogEntry, add: boolean): void {
		// Update correlation ID index
		if (entry.correlationId) {
			if (!this.indexes.has('correlationId')) {
				this.indexes.set('correlationId', new Set());
			}
			const index = this.indexes.get('correlationId')!;
			if (add) {
				index.add(entry.correlationId);
			} else {
				index.delete(entry.correlationId);
			}
		}

		// Update source index
		if (entry.source) {
			if (!this.indexes.has('source')) {
				this.indexes.set('source', new Set());
			}
			const index = this.indexes.get('source')!;
			if (add) {
				index.add(entry.source);
			} else {
				index.delete(entry.source);
			}
		}

		// Update level index
		if (!this.indexes.has('level')) {
			this.indexes.set('level', new Set());
		}
		const levelIndex = this.indexes.get('level')!;
		if (add) {
			levelIndex.add(entry.level);
		} else {
			levelIndex.delete(entry.level);
		}
	}
}

/**
 * Global log storage instance
 */
export const globalLogStorage = new LogStorage();

/**
 * Log query builder for fluent query construction
 */
export class LogQueryBuilder {
	private query: LogQuery = {};

	/**
	 * Set time range
	 */
	timeRange(startTime: Date, endTime: Date): this {
		this.query.startTime = startTime;
		this.query.endTime = endTime;
		return this;
	}

	/**
	 * Set log levels
	 */
	levels(...levels: string[]): this {
		this.query.levels = levels;
		return this;
	}

	/**
	 * Exclude log levels
	 */
	excludeLevels(...levels: string[]): this {
		this.query.excludeLevels = levels;
		return this;
	}

	/**
	 * Filter by message content
	 */
	messageContains(text: string): this {
		this.query.messageContains = text;
		return this;
	}

	/**
	 * Filter by message regex
	 */
	messageRegex(regex: RegExp): this {
		this.query.messageRegex = regex;
		return this;
	}

	/**
	 * Filter by correlation IDs
	 */
	correlationIds(...ids: string[]): this {
		this.query.correlationIds = ids;
		return this;
	}

	/**
	 * Filter by sources
	 */
	sources(...sources: string[]): this {
		this.query.sources = sources;
		return this;
	}

	/**
	 * Filter by tags
	 */
	tags(...tags: string[]): this {
		this.query.tags = tags;
		return this;
	}

	/**
	 * Require tags
	 */
	hasTags(): this {
		this.query.hasTags = true;
		return this;
	}

	/**
	 * Set pagination
	 */
	limit(limit: number): this {
		this.query.limit = limit;
		return this;
	}

	/**
	 * Set offset
	 */
	offset(offset: number): this {
		this.query.offset = offset;
		return this;
	}

	/**
	 * Set sorting
	 */
	sortBy(
		field: 'timestamp' | 'level' | 'duration' | 'memory',
		order: 'asc' | 'desc' = 'desc',
	): this {
		this.query.sortBy = field;
		this.query.sortOrder = order;
		return this;
	}

	/**
	 * Filter by minimum performance duration
	 */
	durationMin(min: number): this {
		this.query.durationMin = min;
		return this;
	}

	/**
	 * Filter by memory usage threshold
	 */
	memoryThreshold(threshold: number): this {
		this.query.memoryThreshold = threshold;
		return this;
	}

	/**
	 * Execute the query
	 */
	execute(): QueryResult {
		return globalLogStorage.query(this.query);
	}

	/**
	 * Get query as JSON
	 */
	toJSON(): LogQuery {
		return {...this.query};
	}
}

/**
 * Create a new log query builder
 */
export function createLogQuery(): LogQueryBuilder {
	return new LogQueryBuilder();
}

/**
 * Quick query functions for common use cases
 */
export const logQueries = {
	/**
	 * Get all error logs
	 */
	errors: (limit?: number) =>
		createLogQuery()
			.levels('error', 'fatal')
			.sortBy('timestamp', 'desc')
			.limit(limit || 100)
			.execute(),

	/**
	 * Get logs by correlation ID
	 */
	byCorrelation: (correlationId: string, limit?: number) =>
		createLogQuery()
			.correlationIds(correlationId)
			.sortBy('timestamp', 'asc')
			.limit(limit || 100)
			.execute(),

	/**
	 * Get logs by source
	 */
	bySource: (source: string, limit?: number) =>
		createLogQuery()
			.sources(source)
			.sortBy('timestamp', 'desc')
			.limit(limit || 100)
			.execute(),

	/**
	 * Get logs with specific tag
	 */
	byTag: (tag: string, limit?: number) =>
		createLogQuery()
			.tags(tag)
			.hasTags()
			.sortBy('timestamp', 'desc')
			.limit(limit || 100)
			.execute(),

	/**
	 * Get slow requests
	 */
	slowRequests: (minDuration: number = 1000, limit?: number) =>
		createLogQuery()
			.messageContains('request')
			.durationMin(minDuration)
			.sortBy('duration', 'desc')
			.limit(limit || 50)
			.execute(),

	/**
	 * Get memory-intensive operations
	 */
	memoryIntensive: (minMemory: number = 50 * 1024 * 1024, limit?: number) =>
		createLogQuery()
			.memoryThreshold(minMemory)
			.sortBy('memory', 'desc')
			.limit(limit || 50)
			.execute(),
};

export default LogStorage;
