/**
 * Main logging interface with facade pattern for backward compatibility
 * Uses dependency injection pattern to avoid circular dependencies
 */

import {getShutdownManager} from '@/utils/shutdown';
import {globalHealthMonitor} from './health-monitor/core/health-monitor';
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
// biome-ignore lint/suspicious/noExplicitAny: Dynamic bindings for logger context
export function createChildLogger(bindings: Record<string, any>): Logger {
	return loggerProvider.createChildLogger(bindings);
}

/**
 * Check if a log level is enabled
 */
export function isLevelEnabled(level: LogLevel): boolean {
	return loggerProvider.isLevelEnabled(level);
}

/**
 * Convenience methods that match console.log API
 */
export const log = {
	// biome-ignore lint/suspicious/noExplicitAny: Variadic arguments for logger methods
	fatal: (msg: string, ...args: any[]) => getLogger().fatal(msg, ...args),
	// biome-ignore lint/suspicious/noExplicitAny: Variadic arguments for logger methods
	error: (msg: string, ...args: any[]) => getLogger().error(msg, ...args),
	// biome-ignore lint/suspicious/noExplicitAny: Variadic arguments for logger methods
	warn: (msg: string, ...args: any[]) => getLogger().warn(msg, ...args),
	// biome-ignore lint/suspicious/noExplicitAny: Variadic arguments for logger methods
	info: (msg: string, ...args: any[]) => getLogger().info(msg, ...args),
	// biome-ignore lint/suspicious/noExplicitAny: Variadic arguments for logger methods
	http: (msg: string, ...args: any[]) => getLogger().http(msg, ...args),
	// biome-ignore lint/suspicious/noExplicitAny: Variadic arguments for logger methods
	debug: (msg: string, ...args: any[]) => getLogger().debug(msg, ...args),
	// biome-ignore lint/suspicious/noExplicitAny: Variadic arguments for logger methods
	trace: (msg: string, ...args: any[]) => getLogger().trace(msg, ...args),
};

/**
 * Backward compatibility facade - wraps console during transition
 * This will be gradually replaced with structured logging
 */
export const console = {
	// biome-ignore lint/suspicious/noExplicitAny: Variadic arguments for console compatibility
	log: (...args: any[]) => {
		// For now, use info level for console.log
		log.info(args.join(' '));

		// TODO: Add deprecation warning in development mode
		if (process.env.NODE_ENV === 'development') {
			process.stderr.write(
				'\x1b[33m[DEPRECATED]\x1b[0m console.log() is deprecated. Use logger.info() instead.\n',
			);
		}
	},
	// biome-ignore lint/suspicious/noExplicitAny: Variadic arguments for console compatibility
	error: (...args: any[]) => {
		log.error(args.join(' '));
	},
	// biome-ignore lint/suspicious/noExplicitAny: Variadic arguments for console compatibility
	warn: (...args: any[]) => {
		log.warn(args.join(' '));
	},
	// biome-ignore lint/suspicious/noExplicitAny: Variadic arguments for console compatibility
	info: (...args: any[]) => {
		log.info(args.join(' '));
	},
	// biome-ignore lint/suspicious/noExplicitAny: Variadic arguments for console compatibility
	debug: (...args: any[]) => {
		log.debug(args.join(' '));
	},
};

/**
 * Flush any pending logs
 */
export async function flush(): Promise<void> {
	await loggerProvider.flush();
}

/**
 * Flush logs synchronously (for signal handlers)
 */
function _flushSync(): void {
	loggerProvider.flushSync();
}

/**
 * End the logger and close all streams
 */
export async function end(): Promise<void> {
	await loggerProvider.end();
}

// Register cleanup handlers with ShutdownManager
const shutdownManager = getShutdownManager();

shutdownManager.register({
	name: 'health-monitor',
	priority: 40,
	handler: async () => {
		globalHealthMonitor.stop();
	},
});

shutdownManager.register({
	name: 'logger',
	priority: 100,
	handler: async () => {
		await loggerProvider.flush();
		await loggerProvider.end();
	},
});

// Export configuration utilities
export {
	/** @internal */
	createConfig,
	/** @internal */
	getDefaultLogDirectory,
	/** @internal */
	getEnvironmentConfig,
	/** @internal */
	normalizeLogLevel,
	/** @internal */
	validateLogLevel,
} from './config.js';
// Export for testing purposes only
// Export correlation utilities
export {
	/** @internal */
	correlationMiddleware,
	/** @internal */
	createCorrelationFromHeaders,
	/** @internal */
	extractCorrelationId,
	/** @internal */
	formatCorrelationForLog,
	generateCorrelationId,
	getCorrelationId,
	withNewCorrelationContext,
} from './correlation.js';

// Export performance utilities
export {
	calculateMemoryDelta,
	endMetrics,
	/** @internal */
	formatBytes,
	formatMemoryUsage,
	/** @internal */
	globalPerformanceMonitor,
	startMetrics,
} from './performance.js';
// Re-export all modules for external use
export type {Logger, LoggerConfig, LogLevel} from './types.js';

// Export transport utilities (used internally only)
// No exports from transports.js as they are only used internally

// Console facade exports (only used in tests)
// No exports from console-facade.js as they are only used internally and in tests

// Export request tracking utilities (specific instances used by other modules)
export {healthChecks} from './health-monitor/index.js';
// Export log storage for tests
export {globalLogStorage} from './log-query/index.js';
// Internal exports that knip should ignore
export {
	/** @internal */
	aiTracker,
	globalRequestTracker,
	/** @internal */
	httpTracker,
	/** @internal */
	mcpTracker,
} from './request-tracker.js';

// RequestTracker is only used internally as default export
// No export needed here

// Log query exports (not used in main codebase)
// No exports from log-query.js as they are not used

// Export health monitoring
export {
	type HealthCheck,
	type HealthCheckConfig,
	type HealthCheckResult,
	type SystemMetrics,
} from './health-monitor/index.js';
