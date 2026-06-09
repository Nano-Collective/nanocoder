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
 * Convenience methods that match console.log API
 */
export const log = {
	fatal: (msg: string, ...args: unknown[]) => getLogger().fatal(msg, ...args),
	error: (msg: string, ...args: unknown[]) => getLogger().error(msg, ...args),
	warn: (msg: string, ...args: unknown[]) => getLogger().warn(msg, ...args),
	info: (msg: string, ...args: unknown[]) => getLogger().info(msg, ...args),
	http: (msg: string, ...args: unknown[]) => getLogger().http(msg, ...args),
	debug: (msg: string, ...args: unknown[]) => getLogger().debug(msg, ...args),
	trace: (msg: string, ...args: unknown[]) => getLogger().trace(msg, ...args),
};

/**
 * Backward compatibility facade - wraps console during transition
 * This will be gradually replaced with structured logging
 */
export const console = {
	log: (...args: unknown[]) => {
		// For now, use info level for console.log
		log.info(args.join(' '));

		if (process.env.NODE_ENV === 'development') {
			process.stderr.write(
				'\x1b[33m[DEPRECATED]\x1b[0m console.log() is deprecated. Use logger.info() instead.\n',
			);
		}
	},
	error: (...args: unknown[]) => {
		log.error(args.join(' '));
	},
	warn: (...args: unknown[]) => {
		log.warn(args.join(' '));
	},
	info: (...args: unknown[]) => {
		log.info(args.join(' '));
	},
	debug: (...args: unknown[]) => {
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
