/**
 * Request timing and memory usage tracking
 * Provides comprehensive monitoring for HTTP requests, AI calls, and MCP operations
 */

import {randomBytes} from 'node:crypto';
import nodeProcess from 'node:process';

import {MAX_COMPLETED_REQUESTS} from '@/constants';
import {generateCorrelationId, getLogger} from './index.js';
import {
	calculateMemoryDelta,
	formatBytes,
	trackPerformance,
} from './performance.js';

// Safe memory usage getter with runtime checks
const getSafeMemory = () => {
	try {
		if (nodeProcess && typeof nodeProcess.memoryUsage === 'function') {
			return nodeProcess.memoryUsage();
		}
	} catch {
		// Ignore any errors during process.memoryUsage()
	}
	return {rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0};
};

// Get logger instance directly to avoid circular dependencies
const logger = getLogger();

/**
 * Request tracking metadata
 */
export interface RequestMetadata {
	id: string;
	type: 'http' | 'ai' | 'mcp' | 'database' | 'file' | 'custom';
	method?: string;
	url?: string;
	endpoint?: string;
	provider?: string;
	model?: string;
	toolName?: string;
	serverName?: string;
	correlationId: string;
	startTime: number;
	endTime?: number;
	duration?: number;
	memoryStart?: NodeJS.MemoryUsage;
	memoryEnd?: NodeJS.MemoryUsage;
	memoryDelta?: Record<string, number>;
	status?: 'pending' | 'success' | 'error' | 'timeout' | 'cancelled';
	statusCode?: number;
	errorType?: string;
	errorMessage?: string;
	requestSize?: number;
	responseSize?: number;
	retryCount?: number;
	userId?: string;
	sessionId?: string;
	tags?: string[];
	customData?: Record<string, unknown>;
}

/**
 * Request statistics for monitoring and analysis
 */
export interface RequestStats {
	totalRequests: number;
	requestsByType: Record<string, number>;
	requestsByStatus: Record<string, number>;
	averageDuration: number;
	minDuration: number;
	maxDuration: number;
	totalDuration: number;
	averageMemoryDelta: Record<string, number>;
	errorRate: number;
	timeoutRate: number;
	requestsInLastHour: number;
	requestsInLastDay: number;
	busiestHour: number;
	busiestEndpoint?: string;
	slowestEndpoint?: string;
	mostErrorProneEndpoint?: string;
	timestamp: string;
}

/**
 * Request tracker class for monitoring HTTP requests and operations
 */
export class RequestTracker {
	private activeRequests: Map<string, RequestMetadata> = new Map();
	private completedRequests: RequestMetadata[] = [];
	private readonly maxCompletedRequests: number;
	private readonly correlationId: string;

	constructor(maxCompletedRequests: number = MAX_COMPLETED_REQUESTS) {
		this.maxCompletedRequests = maxCompletedRequests;
		this.correlationId = generateCorrelationId();
	}

	/**
	 * Start tracking a new request
	 */
	startRequest(
		metadata: Omit<
			RequestMetadata,
			'id' | 'startTime' | 'status' | 'correlationId'
		>,
	): string {
		const id = this.generateRequestId();
		const request: RequestMetadata = {
			...metadata,
			id,
			startTime: Date.now(),
			status: 'pending',
			correlationId: generateCorrelationId(),
			memoryStart: getSafeMemory(),
		};

		this.activeRequests.set(id, request);

		logger.debug('Request tracking started', {
			requestId: id,
			requestType: metadata.type,
			method: metadata.method,
			endpoint: metadata.url || metadata.endpoint,
			correlationId: request.correlationId,
			source: 'request-tracker',
		});

		return id;
	}

	/**
	 * Complete a request successfully
	 */
	completeRequest(
		requestId: string,
		responseMetadata?: {
			statusCode?: number;
			responseSize?: number;
			customData?: Record<string, unknown>;
		},
	): RequestMetadata | null {
		const request = this.activeRequests.get(requestId);
		if (!request) {
			logger.warn('Attempted to complete unknown request', {
				requestId,
				source: 'request-tracker',
			});
			return null;
		}

		const endTime = Date.now();
		const memoryEnd = getSafeMemory();
		const duration = endTime - request.startTime;
		let memoryDelta: Record<string, number> | undefined;
		if (request.memoryStart) {
			try {
				memoryDelta = calculateMemoryDelta(request.memoryStart, memoryEnd);
			} catch {
				// Ignore memory calculation errors
				memoryDelta = undefined;
			}
		}

		const completedRequest: RequestMetadata = {
			...request,
			endTime,
			duration,
			status: 'success',
			memoryEnd,
			memoryDelta,
			...responseMetadata,
		};

		this.activeRequests.delete(requestId);
		this.addToCompleted(completedRequest);

		// Log successful request completion
		logger.info('Request completed successfully', {
			requestId: completedRequest.id,
			requestType: completedRequest.type,
			method: completedRequest.method,
			endpoint: completedRequest.url || completedRequest.endpoint,
			duration: `${duration}ms`,
			statusCode: completedRequest.statusCode,
			memoryDelta: memoryDelta
				? {
						heapUsed: formatBytes(memoryDelta.heapUsedDelta || 0),
						heapTotal: formatBytes(memoryDelta.heapTotalDelta || 0),
						external: formatBytes(memoryDelta.externalDelta || 0),
						rss: formatBytes(memoryDelta.rssDelta || 0),
					}
				: undefined,
			correlationId: completedRequest.correlationId,
			source: 'request-tracker',
		});

		return completedRequest;
	}

	/**
	 * Mark a request as failed
	 */
	failRequest(
		requestId: string,
		error: Error | string,
		errorMetadata?: {
			errorType?: string;
			statusCode?: number;
			customData?: Record<string, unknown>;
		},
	): RequestMetadata | null {
		const request = this.activeRequests.get(requestId);
		if (!request) {
			logger.warn('Attempted to fail unknown request', {
				requestId,
				source: 'request-tracker',
			});
			return null;
		}

		const endTime = Date.now();
		const memoryEnd = getSafeMemory();
		const duration = endTime - request.startTime;
		let memoryDelta: Record<string, number> | undefined;
		if (request.memoryStart) {
			try {
				memoryDelta = calculateMemoryDelta(request.memoryStart, memoryEnd);
			} catch {
				// Ignore memory calculation errors
				memoryDelta = undefined;
			}
		}

		const errorMessage = error instanceof Error ? error.message : error;
		const errorType =
			error instanceof Error
				? error.constructor.name
				: errorMetadata?.errorType || 'Unknown';

		const completedRequest: RequestMetadata = {
			...request,
			endTime,
			duration,
			status: 'error',
			memoryEnd,
			memoryDelta,
			errorType,
			errorMessage,
			...errorMetadata,
		};

		this.activeRequests.delete(requestId);
		this.addToCompleted(completedRequest);

		// Log request failure
		logger.error('Request failed', {
			requestId: completedRequest.id,
			requestType: completedRequest.type,
			method: completedRequest.method,
			endpoint: completedRequest.url || completedRequest.endpoint,
			duration: `${duration}ms`,
			errorType,
			errorMessage,
			statusCode: completedRequest.statusCode,
			memoryDelta: memoryDelta
				? {
						heapUsed: formatBytes(memoryDelta.heapUsedDelta || 0),
						heapTotal: formatBytes(memoryDelta.heapTotalDelta || 0),
						external: formatBytes(memoryDelta.externalDelta || 0),
						rss: formatBytes(memoryDelta.rssDelta || 0),
					}
				: undefined,
			correlationId: completedRequest.correlationId,
			source: 'request-tracker',
		});

		return completedRequest;
	}

	/**
	 * Mark a request as timed out
	 */
	timeoutRequest(requestId: string, timeoutMs: number): RequestMetadata | null {
		const request = this.activeRequests.get(requestId);
		if (!request) {
			logger.warn('Attempted to timeout unknown request', {
				requestId,
				source: 'request-tracker',
			});
			return null;
		}

		const endTime = Date.now();
		const memoryEnd = getSafeMemory();
		const duration = endTime - request.startTime;
		let memoryDelta: Record<string, number> | undefined;
		if (request.memoryStart) {
			try {
				memoryDelta = calculateMemoryDelta(request.memoryStart, memoryEnd);
			} catch {
				// Ignore memory calculation errors
				memoryDelta = undefined;
			}
		}

		const completedRequest: RequestMetadata = {
			...request,
			endTime,
			duration,
			status: 'timeout',
			memoryEnd,
			memoryDelta,
			errorMessage: `Request timed out after ${timeoutMs}ms (actual duration: ${duration}ms)`,
		};

		this.activeRequests.delete(requestId);
		this.addToCompleted(completedRequest);

		// Log request timeout
		logger.warn('Request timed out', {
			requestId: completedRequest.id,
			requestType: completedRequest.type,
			method: completedRequest.method,
			endpoint: completedRequest.url || completedRequest.endpoint,
			duration: `${duration}ms`,
			timeoutMs: `${timeoutMs}ms`,
			memoryDelta: memoryDelta
				? {
						heapUsed: formatBytes(memoryDelta.heapUsedDelta || 0),
						heapTotal: formatBytes(memoryDelta.heapTotalDelta || 0),
						external: formatBytes(memoryDelta.externalDelta || 0),
						rss: formatBytes(memoryDelta.rssDelta || 0),
					}
				: undefined,
			correlationId: completedRequest.correlationId,
			source: 'request-tracker',
		});

		return completedRequest;
	}

	/**
	 * Cancel a request
	 */
	cancelRequest(requestId: string, reason?: string): RequestMetadata | null {
		const request = this.activeRequests.get(requestId);
		if (!request) {
			logger.warn('Attempted to cancel unknown request', {
				requestId,
				source: 'request-tracker',
			});
			return null;
		}

		const endTime = Date.now();
		const memoryEnd = getSafeMemory();
		const duration = endTime - request.startTime;
		let memoryDelta: Record<string, number> | undefined;
		if (request.memoryStart) {
			try {
				memoryDelta = calculateMemoryDelta(request.memoryStart, memoryEnd);
			} catch {
				// Ignore memory calculation errors
				memoryDelta = undefined;
			}
		}

		const completedRequest: RequestMetadata = {
			...request,
			endTime,
			duration,
			status: 'cancelled',
			memoryEnd,
			memoryDelta,
			errorMessage: reason || 'Request was cancelled',
		};

		this.activeRequests.delete(requestId);
		this.addToCompleted(completedRequest);

		// Log request cancellation
		logger.info('Request cancelled', {
			requestId: completedRequest.id,
			requestType: completedRequest.type,
			method: completedRequest.method,
			endpoint: completedRequest.url || completedRequest.endpoint,
			duration: `${duration}ms`,
			reason,
			memoryDelta: memoryDelta
				? {
						heapUsed: formatBytes(memoryDelta.heapUsedDelta || 0),
						heapTotal: formatBytes(memoryDelta.heapTotalDelta || 0),
						external: formatBytes(memoryDelta.externalDelta || 0),
						rss: formatBytes(memoryDelta.rssDelta || 0),
					}
				: undefined,
			correlationId: completedRequest.correlationId,
			source: 'request-tracker',
		});

		return completedRequest;
	}

	/**
	 * Get request statistics
	 */
	getStats(): RequestStats {
		const now = Date.now();
		const oneHourAgo = now - 60 * 60 * 1000;
		const oneDayAgo = now - 24 * 60 * 60 * 1000;

		const requestsInLastHour = this.completedRequests.filter(
			r => r.endTime !== undefined && r.endTime > oneHourAgo,
		).length;
		const requestsInLastDay = this.completedRequests.filter(
			r => r.endTime !== undefined && r.endTime > oneDayAgo,
		).length;

		const requestsByType: Record<string, number> = {};
		const requestsByStatus: Record<string, number> = {};
		const endpointStats: Record<
			string,
			{count: number; totalDuration: number; errors: number}
		> = {};

		let totalDuration = 0;
		let minDuration = Infinity;
		let maxDuration = 0;
		const memoryDeltaSum = {heapUsed: 0, heapTotal: 0, external: 0, rss: 0};
		let memoryDeltaCount = 0;

		for (const request of this.completedRequests) {
			// Count by type
			requestsByType[request.type] = (requestsByType[request.type] || 0) + 1;

			// Count by status
			const status = request.status || 'unknown';
			requestsByStatus[status] = (requestsByStatus[status] || 0) + 1;

			// Duration statistics
			if (request.duration) {
				totalDuration += request.duration;
				minDuration = Math.min(minDuration, request.duration);
				maxDuration = Math.max(maxDuration, request.duration);
			}

			// Memory statistics
			if (request.memoryDelta) {
				memoryDeltaSum.heapUsed += request.memoryDelta.heapUsedDelta;
				memoryDeltaSum.heapTotal += request.memoryDelta.heapTotalDelta;
				memoryDeltaSum.external += request.memoryDelta.externalDelta;
				memoryDeltaSum.rss += request.memoryDelta.rssDelta;
				memoryDeltaCount++;
			}

			// Endpoint statistics
			const endpoint =
				request.url || request.endpoint || request.toolName || 'unknown';
			if (!endpointStats[endpoint]) {
				endpointStats[endpoint] = {count: 0, totalDuration: 0, errors: 0};
			}
			endpointStats[endpoint].count++;
			if (request.duration) {
				endpointStats[endpoint].totalDuration += request.duration;
			}
			if (request.status === 'error') {
				endpointStats[endpoint].errors++;
			}
		}

		// Calculate average duration and memory delta
		const averageDuration =
			this.completedRequests.length > 0
				? totalDuration / this.completedRequests.length
				: 0;
		const averageMemoryDelta =
			memoryDeltaCount > 0
				? {
						heapUsed: memoryDeltaSum.heapUsed / memoryDeltaCount,
						heapTotal: memoryDeltaSum.heapTotal / memoryDeltaCount,
						external: memoryDeltaSum.external / memoryDeltaCount,
						rss: memoryDeltaSum.rss / memoryDeltaCount,
					}
				: {heapUsed: 0, heapTotal: 0, external: 0, rss: 0};

		// Find busiest, slowest, and most error-prone endpoints
		let busiestEndpoint: string | undefined;
		let slowestEndpoint: string | undefined;
		let mostErrorProneEndpoint: string | undefined;

		let maxRequests = 0;
		let maxAvgDuration = 0;
		let maxErrorRate = 0;

		for (const [endpoint, stats] of Object.entries(endpointStats)) {
			if (stats.count > maxRequests) {
				maxRequests = stats.count;
				busiestEndpoint = endpoint;
			}

			const avgDuration =
				stats.count > 0 ? stats.totalDuration / stats.count : 0;
			if (avgDuration > maxAvgDuration) {
				maxAvgDuration = avgDuration;
				slowestEndpoint = endpoint;
			}

			const errorRate = stats.count > 0 ? stats.errors / stats.count : 0;
			if (errorRate > maxErrorRate) {
				maxErrorRate = errorRate;
				mostErrorProneEndpoint = endpoint;
			}
		}

		const totalRequests = this.completedRequests.length;
		const errorRate = requestsByStatus.error
			? requestsByStatus.error / totalRequests
			: 0;
		const timeoutRate = requestsByStatus.timeout
			? requestsByStatus.timeout / totalRequests
			: 0;

		return {
			totalRequests,
			requestsByType,
			requestsByStatus,
			averageDuration,
			minDuration: minDuration === Infinity ? 0 : minDuration,
			maxDuration,
			totalDuration,
			averageMemoryDelta,
			errorRate,
			timeoutRate,
			requestsInLastHour,
			requestsInLastDay,
			busiestHour: new Date().getHours(),
			busiestEndpoint,
			slowestEndpoint,
			mostErrorProneEndpoint,
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * Get active requests
	 */
	getActiveRequests(): RequestMetadata[] {
		return Array.from(this.activeRequests.values());
	}

	/**
	 * Get recently completed requests
	 */
	getRecentRequests(limit: number = 50): RequestMetadata[] {
		return this.completedRequests
			.sort((a, b) => (b.endTime || 0) - (a.endTime || 0))
			.slice(0, limit);
	}

	/**
	 * Clear all tracking data
	 */
	clear(): void {
		this.activeRequests.clear();
		this.completedRequests = [];
	}

	private generateRequestId(): string {
		return `req_${Date.now()}_${randomBytes(8).toString('hex')}`;
	}

	private addToCompleted(request: RequestMetadata): void {
		this.completedRequests.push(request);

		// Keep only the last N requests
		if (this.completedRequests.length > this.maxCompletedRequests) {
			this.completedRequests = this.completedRequests.slice(
				-this.maxCompletedRequests,
			);
		}
	}
}

/**
 * Global request tracker instance
 */
export const globalRequestTracker = new RequestTracker();

/**
 * Decorator to automatically track function calls as requests
 */
export function trackRequest<T extends (...args: unknown[]) => unknown>(
	fn: T,
	options: {
		type: RequestMetadata['type'];
		method?: string;
		endpoint?: string;
		provider?: string;
		model?: string;
		toolName?: string;
		serverName?: string;
		tags?: string[];
		trackMemory?: boolean;
		trackRequestSize?: boolean;
		thresholds?: {
			duration?: number;
			memory?: number;
		};
	},
): T {
	return trackPerformance(
		async (...args: unknown[]) => {
			const requestId = globalRequestTracker.startRequest({
				type: options.type,
				method: options.method,
				endpoint: options.endpoint,
				provider: options.provider,
				model: options.model,
				tags: options.tags,
			});

			try {
				const result = await fn(...(args as Parameters<T>));

				globalRequestTracker.completeRequest(requestId, {
					customData: {
						arguments: options.trackRequestSize
							? {
									count: args.length,
									types: args.map(arg => typeof arg),
									size: JSON.stringify(args).length,
								}
							: undefined,
					},
				});

				return result;
			} catch (error) {
				globalRequestTracker.failRequest(requestId, error as Error, {
					errorType:
						error instanceof Error ? error.constructor.name : 'Unknown',
				});
				throw error;
			}
		},
		`${options.type}-request-${options.endpoint || 'unknown'}`,
		{
			thresholds: options.thresholds,
			trackMemory: options.trackMemory !== false,
			trackArgs: false,
		},
	) as T;
}

/**
 * HTTP request tracking utilities
 */
export const httpTracker = {
	/**
	 * Track an HTTP GET request
	 */
	get: <T>(
		url: string,
		fn: () => Promise<T>,
		options?: Partial<Parameters<typeof trackRequest>[1]>,
	) =>
		trackRequest(fn, {
			type: 'http',
			method: 'GET',
			endpoint: url,
			...options,
		}),

	/**
	 * Track an HTTP POST request
	 */
	post: <T>(
		url: string,
		fn: () => Promise<T>,
		options?: Partial<Parameters<typeof trackRequest>[1]>,
	) =>
		trackRequest(fn, {
			type: 'http',
			method: 'POST',
			endpoint: url,
			...options,
		}),

	/**
	 * Track an HTTP PUT request
	 */
	put: <T>(
		url: string,
		fn: () => Promise<T>,
		options?: Partial<Parameters<typeof trackRequest>[1]>,
	) =>
		trackRequest(fn, {
			type: 'http',
			method: 'PUT',
			endpoint: url,
			...options,
		}),

	/**
	 * Track an HTTP DELETE request
	 */
	delete: <T>(
		url: string,
		fn: () => Promise<T>,
		options?: Partial<Parameters<typeof trackRequest>[1]>,
	) =>
		trackRequest(fn, {
			type: 'http',
			method: 'DELETE',
			endpoint: url,
			...options,
		}),
};

/**
 * AI request tracking utilities
 */
export const aiTracker = {
	/**
	 * Track an AI chat request
	 */
	chat: <T>(
		provider: string,
		model: string,
		fn: () => Promise<T>,
		options?: Partial<Parameters<typeof trackRequest>[1]>,
	) =>
		trackRequest(fn, {
			type: 'ai',
			provider,
			model,
			endpoint: 'chat',
			...options,
		}),

	/**
	 * Track an AI completion request
	 */
	completion: <T>(
		provider: string,
		model: string,
		fn: () => Promise<T>,
		options?: Partial<Parameters<typeof trackRequest>[1]>,
	) =>
		trackRequest(fn, {
			type: 'ai',
			provider,
			model,
			endpoint: 'completion',
			...options,
		}),

	/**
	 * Track an AI embedding request
	 */
	embedding: <T>(
		provider: string,
		model: string,
		fn: () => Promise<T>,
		options?: Partial<Parameters<typeof trackRequest>[1]>,
	) =>
		trackRequest(fn, {
			type: 'ai',
			provider,
			model,
			endpoint: 'embedding',
			...options,
		}),
};

/**
 * MCP request tracking utilities
 */
export const mcpTracker = {
	/**
	 * Track an MCP tool execution
	 */
	tool: <T>(
		_serverName: string,
		toolName: string,
		fn: () => Promise<T>,
		options?: Partial<Parameters<typeof trackRequest>[1]>,
	) =>
		trackRequest(fn, {
			type: 'mcp',
			toolName,
			endpoint: `tool:${toolName}`,
			...options,
		}),

	/**
	 * Track an MCP server connection
	 */
	connect: <T>(
		_serverName: string,
		fn: () => Promise<T>,
		options?: Partial<Parameters<typeof trackRequest>[1]>,
	) =>
		trackRequest(fn, {
			type: 'mcp',
			endpoint: 'connect',
			...options,
		}),
};

// RequestTracker is only used internally
// export default RequestTracker;
