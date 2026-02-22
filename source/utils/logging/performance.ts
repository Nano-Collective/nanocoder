/**
 * Enhanced performance metrics collection for logging
 * Provides comprehensive monitoring and analysis capabilities
 */

import {randomBytes} from 'node:crypto';
import {loadavg} from 'node:os';
import nodeProcess from 'node:process';

import {generateCorrelationId} from './index.js';
import type {Logger, PerformanceMetrics} from './types.js';

// Safe memory usage getter with runtime checks
const getSafeMemory = (): NodeJS.MemoryUsage => {
	try {
		if (nodeProcess && typeof nodeProcess.memoryUsage === 'function') {
			return nodeProcess.memoryUsage();
		}
	} catch {
		// Ignore any errors during process.memoryUsage()
	}
	return {rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0};
};

// Safe CPU usage getter with runtime checks
const getSafeCpuUsage = (): NodeJS.CpuUsage => {
	try {
		if (nodeProcess && typeof nodeProcess.cpuUsage === 'function') {
			return nodeProcess.cpuUsage();
		}
	} catch {
		// Ignore any errors during process.cpuUsage()
	}
	return {user: 0, system: 0};
};

// Create correlation context function
function createCorrelationContext() {
	const id = generateCorrelationId();
	return {
		id,
		getId: () => id,
	};
}

import {correlationStorage} from './correlation.js';

// Private CPU usage functions (used internally)
function getCpuUsage(): NodeJS.CpuUsage {
	return getSafeCpuUsage();
}

function calculateCpuUsage(
	startUsage: NodeJS.CpuUsage,
	endUsage: NodeJS.CpuUsage,
	timeDelta: number,
): number {
	const userDelta = endUsage.user - startUsage.user;
	const systemDelta = endUsage.system - startUsage.system;
	const totalDelta = userDelta + systemDelta;

	// Convert to percentage (microseconds to seconds)
	return (totalDelta / (timeDelta * 1000)) * 100;
}

// Lazy logger initialization to avoid circular dependency
let _logger: Logger | null = null;
function getLogger(): Logger {
	if (!_logger) {
		// Use dynamic import to avoid circular dependency
		const loggingModule = import('./index.js');
		// For now, create a simple fallback logger
		_logger = {
			fatal: () => {},
			error: () => {},
			warn: () => {},
			info: () => {},
			http: () => {},
			debug: () => {},
			trace: () => {},
			child: () => _logger as Logger,
			isLevelEnabled: () => false,
			flush: async () => {},
			flushSync: () => {},
			end: async () => {},
		};
		void loggingModule.then(module => {
			_logger = module.getLogger();
		});
	}
	return _logger;
}

// Create a logger proxy that maintains the same API
const logger: Logger = new Proxy({} as Logger, {
	get(_target, prop): unknown {
		const loggerInstance = getLogger();
		if (
			loggerInstance &&
			typeof loggerInstance === 'object' &&
			prop in loggerInstance
		) {
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic property access
			const value = (loggerInstance as any)[prop];
			return typeof value === 'function' ? value.bind(loggerInstance) : value;
		}
		// Return fallback methods that match Logger interface
		const fallbacks: Record<string, unknown> = {
			fatal: (_msg: string, ..._args: unknown[]) => {},
			error: (_msg: string, ..._args: unknown[]) => {},
			warn: (_msg: string, ..._args: unknown[]) => {},
			info: (_msg: string, ..._args: unknown[]) => {},
			http: (_msg: string, ..._args: unknown[]) => {},
			debug: (_msg: string, ..._args: unknown[]) => {},
			trace: (_msg: string, ..._args: unknown[]) => {},
			child: () => logger,
			isLevelEnabled: () => false,
			flush: async () => {},
			end: async () => {},
		};
		return fallbacks[prop as string] || (() => {});
	},
});

/**
 * Start a performance measurement
 */
export function startMetrics(): PerformanceMetrics {
	return {
		startTime: performance.now(),
		memoryUsage: getSafeMemory(),
	};
}

/**
 * End a performance measurement and calculate duration
 */
export function endMetrics(
	metrics: PerformanceMetrics,
): PerformanceMetrics & {duration: number} {
	const endTime = performance.now();
	const duration = endTime - metrics.startTime;

	return {
		...metrics,
		duration,
		memoryUsage: getSafeMemory(),
	};
}

/**
 * Calculate memory usage delta
 */
export function calculateMemoryDelta(
	initial: NodeJS.MemoryUsage,
	final: NodeJS.MemoryUsage,
): Record<string, number> {
	return {
		heapUsedDelta: final.heapUsed - initial.heapUsed,
		heapTotalDelta: final.heapTotal - initial.heapTotal,
		externalDelta: final.external - initial.external,
		rssDelta: final.rss - initial.rss,
	};
}

/**
 * Format memory usage for logging
 */
export function formatMemoryUsage(
	memory: NodeJS.MemoryUsage,
): Record<string, string> {
	return {
		heapUsed: formatBytes(memory.heapUsed),
		heapTotal: formatBytes(memory.heapTotal),
		external: formatBytes(memory.external),
		rss: formatBytes(memory.rss),
	};
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';

	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Performance tracking decorator with structured logging integration
 */
export function trackPerformance<T extends (...args: unknown[]) => unknown>(
	fn: T,
	name: string,
	options?: {
		logLevel?: 'debug' | 'info' | 'warn' | 'error';
		trackMemory?: boolean;
		trackCpu?: boolean;
		trackArgs?: boolean;
		thresholds?: {
			duration?: number; // ms
			memory?: number; // MB
			cpu?: number; // percentage
		};
	},
): T {
	const {
		logLevel = 'debug',
		trackMemory = true,
		trackCpu = true,
		trackArgs = false,
		thresholds = {},
	} = options || {};

	return (async (...args: Parameters<T>) => {
		const metrics = startMetrics();
		const cpuStart = getSafeCpuUsage();

		// Create new correlation context for this performance tracking
		const context = createCorrelationContext();

		// Use AsyncLocalStorage.run() directly for proper async context handling
		return correlationStorage.run(context, async () => {
			try {
				const result = await fn(...args);

				const end = endMetrics(metrics);
				const cpuEnd = getSafeCpuUsage();
				const memoryDelta = calculateMemoryDelta(
					metrics.memoryUsage || getSafeMemory(),
					end.memoryUsage || getSafeMemory(),
				);

				// Calculate CPU usage percentage
				const userDelta = cpuEnd.user - cpuStart.user;
				const systemDelta = cpuEnd.system - cpuStart.system;
				const totalDelta = userDelta + systemDelta;
				const cpuPercent = (totalDelta / (end.duration * 1000)) * 100;

				// Prepare performance data
				const perfData: Record<string, unknown> = {
					functionName: name,
					duration: `${end.duration.toFixed(2)}ms`,
					durationMs: end.duration,
					correlationId: context.id,
					source: 'performance-tracker',
				};

				if (trackMemory) {
					perfData.memoryDelta = memoryDelta;
					perfData.memoryDeltaFormatted = {
						heapUsed: formatBytes(memoryDelta.heapUsedDelta),
						heapTotal: formatBytes(memoryDelta.heapTotalDelta),
						external: formatBytes(memoryDelta.externalDelta),
						rss: formatBytes(memoryDelta.rssDelta),
					};
					perfData.currentMemory = formatMemoryUsage(
						end.memoryUsage || getSafeMemory(),
					);
				}

				if (trackCpu) {
					perfData.cpuPercent = `${cpuPercent.toFixed(2)}%`;
					perfData.cpuUsageRaw = cpuPercent;
				}

				if (trackArgs) {
					perfData.argCount = args.length;
					perfData.argTypes = args.map(arg => typeof arg);
				}

				// Check thresholds and set appropriate log level
				let finalLogLevel = logLevel;
				const warnings: string[] = [];

				if (thresholds.duration && end.duration > thresholds.duration) {
					warnings.push(
						`Duration threshold exceeded: ${end.duration.toFixed(2)}ms > ${
							thresholds.duration
						}ms`,
					);
					finalLogLevel = 'warn';
				}

				if (
					thresholds.memory &&
					memoryDelta.heapUsedDelta > thresholds.memory * 1024 * 1024
				) {
					warnings.push(
						`Memory threshold exceeded: ${formatBytes(
							memoryDelta.heapUsedDelta,
						)} > ${formatBytes(thresholds.memory * 1024 * 1024)}`,
					);
					finalLogLevel = 'warn';
				}

				if (thresholds.cpu && cpuPercent > thresholds.cpu) {
					warnings.push(
						`CPU threshold exceeded: ${cpuPercent.toFixed(2)}% > ${
							thresholds.cpu
						}%`,
					);
					finalLogLevel = 'warn';
				}

				if (warnings.length > 0) {
					perfData.thresholdWarnings = warnings;
				}

				// Log performance metrics with structured logging
				logger[finalLogLevel](`Performance: ${name}`, perfData);

				return result;
			} catch (error) {
				const end = endMetrics(metrics);
				const memoryDelta = calculateMemoryDelta(
					metrics.memoryUsage || getSafeMemory(),
					end.memoryUsage || getSafeMemory(),
				);
				const cpuEnd = getCpuUsage();
				const cpuPercent = calculateCpuUsage(cpuStart, cpuEnd, end.duration);

				// Log error performance metrics
				logger.error(`Performance Error: ${name}`, {
					functionName: name,
					duration: `${end.duration.toFixed(2)}ms`,
					durationMs: end.duration,
					error: error instanceof Error ? error.message : error,
					errorType:
						error instanceof Error ? error.constructor.name : typeof error,
					memoryDelta: trackMemory ? memoryDelta : undefined,
					cpuPercent: trackCpu ? `${cpuPercent.toFixed(2)}%` : undefined,
					argCount: trackArgs ? args.length : undefined,
					correlationId: context.id,
					source: 'performance-tracker-error',
				});

				throw error;
			}
		});
	}) as T;
}

/**
 * Enhanced function execution time measurement with structured logging
 */
export async function measureTime<T>(
	fn: () => Promise<T>,
	label?: string,
	options?: {
		logPerformance?: boolean;
		trackMemory?: boolean;
		trackCpu?: boolean;
		thresholds?: {
			duration?: number;
			memory?: number;
		};
	},
): Promise<{
	result: T;
	duration: number;
	memoryDelta?: Record<string, number>;
	cpuUsage?: number;
}> {
	const {
		logPerformance = true,
		trackMemory = true,
		trackCpu = false,
		thresholds = {},
	} = options || {};

	const start = performance.now();
	const memoryStart = getSafeMemory();
	const cpuStart = trackCpu ? getSafeCpuUsage() : undefined;

	// Create new correlation context for this measurement
	const context = createCorrelationContext();

	// Use AsyncLocalStorage.run() directly for proper async context handling
	return correlationStorage.run(context, async () => {
		try {
			const result = await fn();
			const duration = performance.now() - start;
			const memoryEnd = getSafeMemory();
			const cpuEnd = trackCpu ? getSafeCpuUsage() : undefined;

			let memoryDelta: Record<string, number> | undefined;
			let cpuUsage: number | undefined;

			if (trackMemory) {
				memoryDelta = calculateMemoryDelta(memoryStart, memoryEnd);
			}

			if (trackCpu && cpuStart && cpuEnd) {
				// Calculate CPU usage percentage
				const userDelta = cpuEnd.user - cpuStart.user;
				const systemDelta = cpuEnd.system - cpuStart.system;
				const totalDelta = userDelta + systemDelta;
				cpuUsage = (totalDelta / (duration * 1000)) * 100;
			}

			if (logPerformance) {
				const perfData: Record<string, unknown> = {
					label: label || 'Anonymous function',
					duration: `${duration.toFixed(2)}ms`,
					durationMs: duration,
					correlationId: context.id,
					source: 'measure-time',
				};

				if (memoryDelta) {
					perfData.memoryDelta = memoryDelta;
					perfData.memoryDeltaFormatted = {
						heapUsed: formatBytes(memoryDelta.heapUsedDelta),
						heapTotal: formatBytes(memoryDelta.heapTotalDelta),
						external: formatBytes(memoryDelta.externalDelta),
						rss: formatBytes(memoryDelta.rssDelta),
					};
				}

				if (cpuUsage !== undefined) {
					perfData.cpuUsage = `${cpuUsage.toFixed(2)}%`;
					perfData.cpuUsageRaw = cpuUsage;
				}

				// Check thresholds and adjust log level
				let logLevel: 'debug' | 'info' | 'warn' = 'debug';
				const warnings: string[] = [];

				if (thresholds.duration && duration > thresholds.duration) {
					warnings.push(
						`Duration threshold exceeded: ${duration.toFixed(2)}ms > ${
							thresholds.duration
						}ms`,
					);
					logLevel = 'warn';
				}

				if (
					thresholds.memory &&
					memoryDelta &&
					memoryDelta.heapUsedDelta > thresholds.memory * 1024 * 1024
				) {
					warnings.push(
						`Memory threshold exceeded: ${formatBytes(
							memoryDelta.heapUsedDelta,
						)} > ${formatBytes(thresholds.memory * 1024 * 1024)}`,
					);
					logLevel = 'warn';
				}

				if (warnings.length > 0) {
					perfData.thresholdWarnings = warnings;
				}

				logger[logLevel](`Measured function execution`, perfData);
			}

			return {result, duration, memoryDelta, cpuUsage};
		} catch (error) {
			const duration = performance.now() - start;

			logger.error(`Function execution measurement failed`, {
				label: label || 'Anonymous function',
				duration: `${duration.toFixed(2)}ms`,
				durationMs: duration,
				error: error instanceof Error ? error.message : error,
				errorType:
					error instanceof Error ? error.constructor.name : typeof error,
				correlationId: context.id,
				source: 'measure-time-error',
			});

			throw error;
		}
	});
}

/**
 * Enhanced memory threshold checking with structured logging
 */
export function checkMemoryThresholds(
	memory: NodeJS.MemoryUsage,
	options?: {
		heapUsagePercentThreshold?: number;
		heapUsageAbsoluteThreshold?: number;
		logLevel?: 'warn' | 'error';
		correlationId?: string;
	},
): {
	isHealthy: boolean;
	warnings: string[];
	metrics: {
		heapUsedMB: number;
		heapTotalMB: number;
		heapUsagePercent: number;
		externalMB: number;
		rssMB: number;
	};
} {
	const {
		heapUsagePercentThreshold = 0.8,
		heapUsageAbsoluteThreshold = 512,
		logLevel = 'warn',
		correlationId = generateCorrelationId(),
	} = options || {};

	const heapUsedMB = memory.heapUsed / 1024 / 1024;
	const heapTotalMB = memory.heapTotal / 1024 / 1024;
	const externalMB = memory.external / 1024 / 1024;
	const rssMB = memory.rss / 1024 / 1024;
	const heapUsagePercent = heapUsedMB / heapTotalMB;

	const warnings: string[] = [];
	let isHealthy = true;

	// Check heap usage percentage
	if (heapUsagePercent > heapUsagePercentThreshold) {
		warnings.push(
			`High heap usage percentage: ${(heapUsagePercent * 100).toFixed(1)}% > ${(
				heapUsagePercentThreshold * 100
			).toFixed(1)}%`,
		);
		isHealthy = false;
	}

	// Check absolute heap usage
	if (heapUsedMB > heapUsageAbsoluteThreshold) {
		warnings.push(
			`High absolute heap usage: ${heapUsedMB.toFixed(
				2,
			)}MB > ${heapUsageAbsoluteThreshold}MB`,
		);
		isHealthy = false;
	}

	// Check external memory usage
	if (externalMB > 256) {
		warnings.push(`High external memory usage: ${externalMB.toFixed(2)}MB`);
		isHealthy = false;
	}

	// Check RSS (Resident Set Size)
	if (rssMB > 1024) {
		warnings.push(`High RSS usage: ${rssMB.toFixed(2)}MB`);
		isHealthy = false;
	}

	const metrics = {
		heapUsedMB,
		heapTotalMB,
		heapUsagePercent,
		externalMB,
		rssMB,
	};

	// Log with structured logging
	if (!isHealthy) {
		logger[logLevel]('Memory threshold warnings detected', {
			metrics,
			warnings,
			thresholds: {
				heapUsagePercent: `${(heapUsagePercentThreshold * 100).toFixed(1)}%`,
				heapUsageAbsolute: `${heapUsageAbsoluteThreshold}MB`,
				external: '256MB',
				rss: '1024MB',
			},
			correlationId,
			source: 'memory-threshold-check',
		});
	} else {
		logger.debug('Memory usage is healthy', {
			metrics,
			correlationId,
			source: 'memory-threshold-check',
		});
	}

	return {isHealthy, warnings, metrics};
}

/**
 * System performance snapshot
 */
export interface SystemPerformanceSnapshot {
	timestamp: string;
	memory: NodeJS.MemoryUsage;
	memoryFormatted: Record<string, string>;
	cpu: NodeJS.CpuUsage;
	uptime: number;
	uptimeFormatted: string;
	loadAverage: number[];
	platform: string;
	arch: string;
	nodeVersion: string;
	pid: number;
	correlationId: string;
}

/**
 * Take a comprehensive system performance snapshot
 */
export function takePerformanceSnapshot(options?: {
	correlationId?: string;
	includeCpu?: boolean;
}): SystemPerformanceSnapshot {
	const correlationId = options?.correlationId || generateCorrelationId();
	const includeCpu = options?.includeCpu !== false;

	const snapshot: SystemPerformanceSnapshot = {
		timestamp: new Date().toISOString(),
		memory: getSafeMemory(),
		memoryFormatted: formatMemoryUsage(getSafeMemory()),
		cpu: includeCpu ? getSafeCpuUsage() : {user: 0, system: 0},
		uptime: process.uptime(),
		uptimeFormatted: formatUptime(process.uptime()),
		loadAverage: loadavg(),
		platform: process.platform,
		arch: process.arch,
		nodeVersion: process.version,
		pid: process.pid,
		correlationId,
	};

	logger.debug('Performance snapshot taken', {
		timestamp: snapshot.timestamp,
		memoryFormatted: snapshot.memoryFormatted,
		uptimeFormatted: snapshot.uptimeFormatted,
		loadAverage: snapshot.loadAverage,
		correlationId,
		source: 'performance-snapshot',
	});

	return snapshot;
}

/**
 * Format uptime to human readable string
 */
function formatUptime(seconds: number): string {
	const days = Math.floor(seconds / (24 * 3600));
	const hours = Math.floor((seconds % (24 * 3600)) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = Math.floor(seconds % 60);

	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

	return parts.join(' ');
}

/**
 * Performance monitor class for ongoing tracking (used internally)
 */
class PerformanceMonitor {
	private measurements: Map<string, (PerformanceMetrics & {id?: string})[]> =
		new Map();
	private readonly maxMeasurements: number;

	constructor(maxMeasurements: number = 100) {
		this.maxMeasurements = maxMeasurements;
	}

	/**
	 * Start measuring an operation
	 */
	start(operation: string): string {
		const id = `${operation}_${Date.now()}_${randomBytes(8).toString('hex')}`;
		const metrics = startMetrics();

		if (!this.measurements.has(operation)) {
			this.measurements.set(operation, []);
		}

		const operationMeasurements = this.measurements.get(operation);
		if (!operationMeasurements) {
			this.measurements.set(operation, []);
			return this.start(operation); // Retry with empty array
		}
		operationMeasurements.push({...metrics, id});

		// Keep only the last N measurements
		if (operationMeasurements.length > this.maxMeasurements) {
			operationMeasurements.shift();
		}

		return id;
	}

	/**
	 * End measuring an operation
	 */
	end(
		operation: string,
		id: string,
	): (PerformanceMetrics & {duration: number}) | null {
		const operationMeasurements = this.measurements.get(operation);
		if (!operationMeasurements) return null;

		const index = operationMeasurements.findIndex(
			m => 'id' in m && (m as {id?: string}).id === id,
		);
		if (index === -1) return null;

		const metrics = operationMeasurements[index];
		const end = endMetrics(metrics);

		// Update the measurement
		operationMeasurements[index] = end;

		return end;
	}

	/**
	 * Get statistics for an operation
	 */
	getStats(operation: string): {
		count: number;
		avgDuration: number;
		minDuration: number;
		maxDuration: number;
		totalDuration: number;
	} | null {
		const operationMeasurements = this.measurements.get(operation);
		if (!operationMeasurements || operationMeasurements.length === 0) {
			return null;
		}

		const durations = operationMeasurements
			.filter(
				(m): m is PerformanceMetrics & {duration: number} => 'duration' in m,
			)
			.map(m => m.duration);

		if (durations.length === 0) return null;

		return {
			count: durations.length,
			avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
			minDuration: Math.min(...durations),
			maxDuration: Math.max(...durations),
			totalDuration: durations.reduce((a, b) => a + b, 0),
		};
	}

	/**
	 * Get all operation statistics
	 */
	getAllStats(): Record<string, ReturnType<typeof this.getStats>> {
		const stats: Record<string, ReturnType<typeof this.getStats>> = {};

		for (const operation of this.measurements.keys()) {
			stats[operation] = this.getStats(operation);
		}

		return stats;
	}

	/**
	 * Clear all measurements
	 */
	clear(): void {
		this.measurements.clear();
	}

	/**
	 * Clear measurements for a specific operation
	 */
	clearOperation(operation: string): void {
		this.measurements.delete(operation);
	}
}

/**
 * Global performance monitor instance
 */
export const globalPerformanceMonitor = new PerformanceMonitor();
