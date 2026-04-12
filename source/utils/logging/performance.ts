/**
 * Minimal performance metrics helpers.
 *
 * Only the four utilities that have active runtime callers are kept:
 * `startMetrics`, `endMetrics`, `calculateMemoryDelta`, `formatMemoryUsage`.
 * Everything else (trackPerformance decorator, measureTime, threshold
 * checks, PerformanceMonitor class, global singleton, takePerformanceSnapshot)
 * has been deleted — none of it had a runtime caller. If we ever need
 * richer performance tracking, reach for an external library rather than
 * rebuilding the old subsystem.
 */

import {getSafeMemory} from './safe-process.js';
import type {PerformanceMetrics} from './types.js';

/**
 * Start a performance measurement. Pair with `endMetrics` to compute a
 * duration + memory delta for a block of work.
 */
export function startMetrics(): PerformanceMetrics {
	return {
		startTime: performance.now(),
		memoryUsage: getSafeMemory(),
	};
}

/**
 * End a performance measurement previously started with `startMetrics`.
 */
export function endMetrics(
	metrics: PerformanceMetrics,
): PerformanceMetrics & {duration: number} {
	const endTime = performance.now();
	return {
		...metrics,
		duration: endTime - metrics.startTime,
		memoryUsage: getSafeMemory(),
	};
}

/**
 * Compute the delta between two memory snapshots.
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
 * Format a memory usage snapshot into human-readable strings suitable for
 * structured log fields.
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
 * Format a byte count as a human-readable string (internal helper).
 */
function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}
