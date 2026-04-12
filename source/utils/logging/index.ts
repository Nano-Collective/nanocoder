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
