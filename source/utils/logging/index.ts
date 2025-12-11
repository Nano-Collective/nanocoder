/**
 * Main logging interface with facade pattern for backward compatibility
 * Uses dependency injection pattern to avoid circular dependencies
 */

import type {Logger, LoggerConfig, LogLevel} from './types.js';
import {loggerProvider} from './logger-provider.js';

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
	fatal: (msg: string, ...args: any[]) => getLogger().fatal(msg, ...args),
	error: (msg: string, ...args: any[]) => getLogger().error(msg, ...args),
	warn: (msg: string, ...args: any[]) => getLogger().warn(msg, ...args),
	info: (msg: string, ...args: any[]) => getLogger().info(msg, ...args),
	http: (msg: string, ...args: any[]) => getLogger().http(msg, ...args),
	debug: (msg: string, ...args: any[]) => getLogger().debug(msg, ...args),
	trace: (msg: string, ...args: any[]) => getLogger().trace(msg, ...args),
};

/**
 * Backward compatibility facade - wraps console during transition
 * This will be gradually replaced with structured logging
 */
export const console = {
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
	error: (...args: any[]) => {
		log.error(args.join(' '));
	},
	warn: (...args: any[]) => {
		log.warn(args.join(' '));
	},
	info: (...args: any[]) => {
		log.info(args.join(' '));
	},
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
 * End the logger and close all streams
 */
export async function end(): Promise<void> {
	await loggerProvider.end();
}

// Setup graceful shutdown handlers
process.on('SIGTERM', async () => {
	log.info('\n[LOGGER] Received SIGTERM, flushing logs...');
	await flush();
	await end();
	log.info('[LOGGER] Graceful shutdown completed');
});

process.on('SIGINT', async () => {
	log.info('\n[LOGGER] Received SIGINT, flushing logs...');
	await flush();
	await end();
	log.info('[LOGGER] Graceful shutdown completed');
});

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', async err => {
	const logger = getLogger();
	logger.fatal({err}, 'Uncaught exception');
	await flush();
	process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
	const logger = getLogger();
	logger.fatal({reason, promise}, 'Unhandled promise rejection');
	await flush();
	process.exit(1);
});

// Re-export all modules for external use
export type {Logger, LoggerConfig, LogLevel} from './types.js';

// Export correlation utilities
export {
	generateCorrelationId,
	generateShortCorrelationId,
	createCorrelationContext,
	getCurrentCorrelationContext,
	setCorrelationContext,
	clearCorrelationContext,
	withCorrelationContext,
	withNewCorrelationContext,
	getCorrelationId,
	isCorrelationEnabled,
	getCorrelationHeader,
	extractCorrelationId,
	createCorrelationFromHeaders,
	addCorrelationMetadata,
	getCorrelationMetadata,
	formatCorrelationForLog,
	correlationMiddleware,
	withCorrelation,
} from './correlation.js';

// Export performance utilities
export {
	startMetrics,
	endMetrics,
	calculateMemoryDelta,
	formatMemoryUsage,
	formatBytes,
	getCpuUsage,
	calculateCpuUsage,
	trackPerformance,
	measureTime,
	checkMemoryThresholds,
	PerformanceMonitor,
	globalPerformanceMonitor,
} from './performance.js';

// Export configuration utilities
export {
	getDefaultLogDirectory,
	createDevelopmentConfig,
	createProductionConfig,
	createTestConfig,
	getEnvironmentConfig,
	validateLogLevel,
	normalizeLogLevel,
	createConfig,
} from './config.js';

// Export transport utilities
export {
	createDevelopmentTransport,
	createProductionTransport,
	createTestTransport,
	createCustomTransport,
	createMultiTransport,
	createBufferedTransport,
	createErrorTransport,
	createAuditTransport,
	getTransportFromEnvironment,
	validateTransport,
	createSafeTransport,
} from './transports.js';

// Export console facade for backward compatibility
export {
	StructuredConsole,
	ConsoleInterceptor,
	globalConsoleInterceptor,
	useStructuredConsole,
	createModuleConsole,
	ConsoleUsageTracker,
} from './console-facade.js';

// Export request tracking utilities
export {
	RequestTracker,
	RequestMetadata,
	RequestStats,
	globalRequestTracker,
	trackRequest,
	httpTracker,
	aiTracker,
	mcpTracker,
} from './request-tracker.js';

// Export log query interface
export {
	// LogStorage,  // This is a default export
	// LogEntry,  // Already exported from types.ts
	LogQuery,
	QueryResult,
	AggregationOptions,
	AggregationResult,
	LogQueryBuilder,
	globalLogStorage,
	createLogQuery,
	logQueries,
} from './log-query.js';

// Import default export separately
import LogStorage from './log-query.js';
export { LogStorage };


// Export health monitoring
export {
	HealthMonitor,
	globalHealthMonitor,
	healthChecks,
	initializeHealthMonitoring,
	healthCheckMiddleware,
	type HealthCheckResult,
	type HealthCheck,
	type SystemMetrics,
	type HealthCheckConfig,
} from './health-monitor.js';
