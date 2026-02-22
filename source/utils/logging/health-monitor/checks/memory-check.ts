/**
 * Memory health check
 */

import nodeProcess from 'node:process';

import type {HealthCheck, HealthCheckConfig} from '../types.js';

/**
 * Safe memory usage getter with runtime checks
 */
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

/**
 * Check memory usage
 */
export function checkMemory(config: HealthCheckConfig): HealthCheck {
	const startTime = performance.now();
	const memory = getSafeMemory();
	const heapUsagePercent = memory.heapUsed / memory.heapTotal;
	const externalMB = memory.external / 1024 / 1024;

	const thresholds = config.thresholds.memory;
	let status: 'pass' | 'fail' | 'warn' = 'pass';
	let message = 'Memory usage is healthy';
	const details = {
		heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
		heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024),
		heapUsagePercent: Math.round(heapUsagePercent * 100),
		externalMB: Math.round(externalMB),
		rssMB: Math.round(memory.rss / 1024 / 1024),
	};

	if (
		heapUsagePercent > thresholds.heapUsageCritical ||
		externalMB > thresholds.externalCritical
	) {
		status = 'fail';
		message = 'Memory usage is critically high';
	} else if (
		heapUsagePercent > thresholds.heapUsageWarning ||
		externalMB > thresholds.externalWarning
	) {
		status = 'warn';
		message = 'Memory usage is elevated';
	}

	return {
		name: 'memory-usage',
		status,
		score: calculateScore(
			status,
			heapUsagePercent,
			thresholds.heapUsageWarning,
			thresholds.heapUsageCritical,
		),
		duration: performance.now() - startTime,
		message,
		details,
		threshold: {
			warning: thresholds.heapUsageWarning,
			critical: thresholds.heapUsageCritical,
		},
	};
}

/**
 * Calculate score based on status and value
 */
function calculateScore(
	status: 'pass' | 'fail' | 'warn',
	value: number,
	warningThreshold: number,
	criticalThreshold: number,
): number {
	if (status === 'fail') return 0;
	if (status === 'pass') return 100;
	if (status === 'warn') {
		// Calculate score based on how far from critical threshold
		const range = criticalThreshold - warningThreshold;
		const distance = criticalThreshold - value;
		return Math.max(50, Math.min(80, 50 + (distance / range) * 30));
	}
	return 50; // default for unknown status
}
