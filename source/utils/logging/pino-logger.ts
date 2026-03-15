/**
 * Pino logger implementation with environment-specific transport support
 */

import {existsSync, mkdirSync} from 'fs';
import {join} from 'path';
import pino, {type Logger as PinoLogger} from 'pino';
import {createConfig, getDefaultLogDirectory} from './config.js';
import {createLogMethods} from './log-method-factory.js';
import {createRedactionRules, redactLogEntry} from './redaction.js';
import type {
	EnvironmentTransportConfig,
	Logger,
	LoggerConfig,
	LogLevel,
	PiiRedactionRules,
	PinoTransportOptions,
} from './types.js';

/**
 * Type guard to check if a value is a Promise
 * Handles void returns properly by checking for specific Promise characteristics
 */
function _isPromise<T>(value: T | Promise<T> | void): value is Promise<T> {
	return (
		value !== null &&
		value !== undefined &&
		typeof value === 'object' &&
		'then' in value
	);
}

/**
 * Determine transport configuration based on environment and CLI settings
 * Currently returns a fixed configuration for all environments (file logging only)
 */
function determineTransportConfig(): EnvironmentTransportConfig {
	// All environments: file only, no console - simplified approach
	return {
		enableFile: true, // Always enable file logging
		enableConsole: false, // Never use console transport
	};
}

/**
 * Create unified logger using file transport for all environments
 */
function createEnvironmentLogger(
	baseConfig: pino.LoggerOptions,
	transportConfig: EnvironmentTransportConfig,
): Logger {
	const logDir = getDefaultLogDirectory();

	// Create single file transport logger for all environments
	if (transportConfig.enableFile && !transportConfig.enableConsole) {
		// Ensure directory exists
		if (!existsSync(logDir)) {
			mkdirSync(logDir, {recursive: true});
		}

		// Use Intl.DateTimeFormat for local timezone-aware date formatting
		const now = new Date();
		const localDate = new Intl.DateTimeFormat('en-CA', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		})
			.format(now)
			.replace(/\//g, '-');

		const logFilePath = join(logDir, `nanocoder-${localDate}.log`);

		// Use pino.destination() instead of pino.transport() for synchronous flush support
		const destination = pino.destination({
			dest: logFilePath,
			sync: false, // Async writes for performance
			mkdir: true,
		});

		const pinoLogger = pino(baseConfig, destination);
		const redactionRules = createRedactionRules(
			Array.isArray(baseConfig.redact) ? baseConfig.redact : [],
			true, // Enable email redaction
			true, // Enable user ID redaction
		);

		return createEnhancedLogger(pinoLogger, destination, redactionRules);
	}

	// This should never be reached with current configuration
	// If we get here, it means determineTransportConfig returned an invalid config
	throw new Error(
		'Invalid transport configuration: enableFile must be true and enableConsole must be false',
	);
}

/**
 * Create enhanced logger with correlation and redaction support
 */
function createEnhancedLogger(
	pinoLogger: PinoLogger,
	destination?: pino.DestinationStream,
	redactionRules?: PiiRedactionRules,
): Logger {
	// Create a transformer for Pino logger with redaction rules
	const createPinoTransformer = (_level: string) => {
		return (args: unknown[], _msg?: string) => {
			// Apply redaction to object arguments
			if (
				args.length > 0 &&
				typeof args[0] === 'object' &&
				args[0] !== null &&
				redactionRules
			) {
				args[0] = redactLogEntry(
					args[0] as Record<string, unknown>,
					redactionRules,
				);
			}
			return args;
		};
	};

	// Use the factory to create all log methods
	const logMethods = createLogMethods(pinoLogger, {
		transformArgs: createPinoTransformer(''),
	});

	return {
		...logMethods,

		child: (bindings: Record<string, unknown>) => {
			return createEnhancedChild(pinoLogger, bindings, redactionRules);
		},

		isLevelEnabled: (level: LogLevel) => {
			return pinoLogger.isLevelEnabled(level);
		},

		flush: async (): Promise<void> => {
			if (destination && 'flush' in destination) {
				const flushMethod = destination.flush as (() => void) | undefined;
				if (flushMethod && typeof flushMethod === 'function') {
					flushMethod();
				}
			}
		},

		flushSync: (): void => {
			if (destination && 'flushSync' in destination) {
				const flushSyncMethod = destination.flushSync as
					| (() => void)
					| undefined;
				if (flushSyncMethod && typeof flushSyncMethod === 'function') {
					flushSyncMethod();
				}
			}
		},

		end: async (): Promise<void> => {
			if (destination && 'end' in destination) {
				const endMethod = destination.end as (() => void) | undefined;
				if (endMethod && typeof endMethod === 'function') {
					try {
						(destination as {end: () => void}).end();
					} catch (error: unknown) {
						// Ignore errors when ending an already-closed or invalid stream
						// This can happen when end() is called multiple times or the destination
						// is in an invalid state (e.g., during test cleanup)
						const errorMsg =
							error instanceof Error ? error.message : String(error);
						// Only log unexpected errors, not "destroyed" property access errors
						if (!errorMsg.includes('destroyed')) {
							console.warn(
								`[Logger] Warning: Error ending destination stream: ${errorMsg}`,
							);
						}
					}
				}
			}
		},

		// Store destination for direct access if needed
		_destination: destination,
	};
}

/**
 * Create enhanced child logger with correlation and redaction
 */
function createEnhancedChild(
	parent: PinoLogger,
	bindings: Record<string, unknown>,
	redactionRules?: PiiRedactionRules,
): Logger {
	const child = parent.child(bindings);

	// Create a transformer for Pino logger with redaction rules
	const createPinoTransformer = (_level: string) => {
		return (args: unknown[], _msg?: string) => {
			// Apply redaction to object arguments
			if (
				args.length > 0 &&
				typeof args[0] === 'object' &&
				args[0] !== null &&
				redactionRules
			) {
				args[0] = redactLogEntry(
					args[0] as Record<string, unknown>,
					redactionRules,
				);
			}
			return args;
		};
	};

	// Use the factory to create all log methods
	const logMethods = createLogMethods(child, {
		transformArgs: createPinoTransformer(''),
	});

	return {
		...logMethods,

		child: (moreBindings: Record<string, unknown>) => {
			return createEnhancedChild(child, moreBindings, redactionRules);
		},

		isLevelEnabled: (level: LogLevel) => {
			return child.isLevelEnabled(level);
		},

		flush: async (): Promise<void> => {
			// Child loggers don't have direct access to destination
			// Flush is a no-op for children
		},

		flushSync: (): void => {
			// Child loggers don't have direct access to destination
			// FlushSync is a no-op for children
		},

		end: async (): Promise<void> => {
			// Child loggers don't have direct access to destination
			// End is a no-op for children
		},
	};
}

/**
 * Create a Pino logger with environment-specific transports and CLI configuration
 */
export function createPinoLogger(config?: Partial<LoggerConfig>): Logger {
	const finalConfig = createConfig(config);

	// Determine transport configuration
	const transportConfig = determineTransportConfig();

	// Base Pino configuration with updated fields
	const baseConfig: pino.LoggerOptions = {
		level: finalConfig.level,
		redact: finalConfig.redact,
		formatters: {
			level: (label: string, _number: number) => ({level: label.toUpperCase()}),
		},
		timestamp: pino.stdTimeFunctions.isoTime,
		base: {
			pid: process.pid,
			platform: process.platform,
			arch: process.arch,
			service: 'nanocoder',
			version: process.env.npm_package_version || 'unknown',
			environment: process.env.NODE_ENV || 'production',
			nodeVersion: process.version,
		},
	};

	// Create environment-specific logger using transports
	const logger = createEnvironmentLogger(baseConfig, transportConfig);
	return logger;
}

/**
 * Create a logger with custom transport configuration (for advanced usage)
 */
export function createLoggerWithTransport(
	config?: Partial<LoggerConfig>,
	transport?: pino.DestinationStream | PinoTransportOptions,
): Logger {
	const finalConfig = createConfig(config);

	// Handle transport parameter
	let actualTransport: pino.DestinationStream | undefined;
	if (transport) {
		if (typeof transport === 'object' && 'target' in transport) {
			actualTransport = pino.transport(transport) as pino.DestinationStream;
		} else {
			actualTransport = transport;
		}
	}

	const pinoConfig: pino.LoggerOptions = {
		level: finalConfig.level,
		redact: finalConfig.redact,
		formatters: {
			level: (label: string, _number: number) => ({level: label.toUpperCase()}),
		},
		base: {
			pid: process.pid,
			platform: process.platform,
			arch: process.arch,
			service: 'nanocoder',
			version: process.env.npm_package_version || 'unknown',
			environment: process.env.NODE_ENV || 'production',
			nodeVersion: process.version,
		},
	};

	const pinoLogger = actualTransport
		? pino(pinoConfig, actualTransport)
		: pino(pinoConfig);
	const redactionRules = createRedactionRules(
		finalConfig.redact,
		true, // Enable email redaction
		true, // Enable user ID redaction
	);

	return createEnhancedLogger(pinoLogger, actualTransport, redactionRules);
}

/**
 * Get logger statistics
 */
export function getLoggerStats(): {
	level: string;
	silent: boolean;
	environment: string;
} {
	const config = createConfig();
	const environment = process.env.NODE_ENV || 'production';
	return {
		level: config.level,
		silent: config.level === 'silent',
		environment,
	};
}
