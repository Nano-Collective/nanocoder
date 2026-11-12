/**
 * Main logging interface with facade pattern for backward compatibility
 * Uses dependency injection pattern to avoid circular dependencies.
 *
 * **Keep this barrel slim.** Previously it statically imported the entire
 * health-monitor, log-query, request-tracker, and performance subsystems
 * (~75 modules combined). None of those were used at runtime outside of
 * their own tests, but every `import {getLogger} from '@/utils/logging'`
 * was pulling them all into startup. Consumers that actually need those
 * subsystems should import them from their subpaths directly.
 */

import {getShutdownManager} from '@/utils/shutdown';
import {loggerProvider} from './logger-provider';
import type {Logger, LoggerConfig, LogLevel} from './types';

/**
 * Initialize the logger with configuration
 */
export function initializeLogger(config?: Partial<LoggerConfig>): Logger {
	return loggerProvider.initializeLogger(config);
}

/**
 * Get the current logger instance
 */
export function getLogger(): Logger {
	return loggerProvider.getLogger();
}

/**
 * Get the current configuration
 */
export function getLoggerConfig(): LoggerConfig | null {
	return loggerProvider.getLoggerConfig();
}

/**
 * Create a child logger with additional context
 */
export function createChildLogger(bindings: Record<string, unknown>): Logger {
	return loggerProvider.createChildLogger(bindings);
}

/**
 * Check if a log level is enabled
 */
export function isLevelEnabled(level: LogLevel): boolean {
	return loggerProvider.isLevelEnabled(level);
}

/**
 * Flush any pending logs
 */
export async function flush(): Promise<void> {
	await loggerProvider.flush();
}

/**
 * End the logger and close all streams
 */
export async function end(): Promise<void> {
	await loggerProvider.end();
}

// Register cleanup handlers with ShutdownManager.
//
// The health-monitor shutdown handler used to be registered here too, which
// forced a static import of the entire health-monitor subsystem at startup
// (~75 modules) for something that was never actually used at runtime.
// health-monitor is now internal-only — if it comes back as a feature,
// register its shutdown handler wherever it's instantiated.
const shutdownManager = getShutdownManager();

shutdownManager.register({
	name: 'logger',
	priority: 100,
	handler: async () => {
		await loggerProvider.flush();
		await loggerProvider.end();
	},
});

// Only the correlation helpers that are actually used outside the logging
// subsystem are re-exported from the barrel. Everything else (config utils,
// health-monitor, log-query, request-tracker, performance metrics) is
// available via its own subpath for specialized consumers — but no longer
// dragged into startup by every `getLogger()` caller.
export {
	generateCorrelationId,
	getCorrelationId,
	withNewCorrelationContext,
} from './correlation.js';
export type {Logger, LoggerConfig, LogLevel} from './types.js';
