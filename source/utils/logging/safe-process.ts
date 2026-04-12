/**
 * Defensive wrapper around `process.memoryUsage()` that returns a zero-filled
 * snapshot if the Node `process` global is unavailable or throws (e.g. under
 * some runtime polyfills). Used by performance metric helpers that must not
 * crash the app when observability data can't be collected.
 */

import nodeProcess from 'node:process';

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
