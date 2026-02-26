/**
 * Safe process metrics utilities
 * Provides defensive wrappers around process.memoryUsage() and process.cpuUsage()
 * to handle environments where process is polyfilled to null
 */

import nodeProcess from 'node:process';

/**
 * Safe memory usage getter with runtime checks
 * Returns fallback values if process.memoryUsage() is unavailable or throws
 */
export function getSafeMemory(): NodeJS.MemoryUsage {
	try {
		if (nodeProcess && typeof nodeProcess.memoryUsage === 'function') {
			return nodeProcess.memoryUsage();
		}
	} catch {
		// Ignore any errors during process.memoryUsage()
	}
	return {rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0};
}

/**
 * Safe CPU usage getter with runtime checks
 * Returns fallback values if process.cpuUsage() is unavailable or throws
 */
export function getSafeCpuUsage(): NodeJS.CpuUsage {
	try {
		if (nodeProcess && typeof nodeProcess.cpuUsage === 'function') {
			return nodeProcess.cpuUsage();
		}
	} catch {
		// Ignore any errors during process.cpuUsage()
	}
	return {user: 0, system: 0};
}
