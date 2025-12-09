/**
 * Pino logger implementation with full feature support
 */

import pino, {type Logger as PinoLogger, type DestinationStream} from 'pino';
import {hostname} from 'os';
import {readFileSync, mkdirSync, existsSync, createWriteStream} from 'fs';
import {dirname} from 'path';
import {createConfig} from './config.js';
import {createFormatters} from './formatters.js';
import {redactLogEntry, createRedactionRules} from './redaction.js';
import {
	getCurrentCorrelationContext,
	formatCorrelationForLog,
	isCorrelationEnabled,
} from './correlation.js';
import type {Logger, LoggerConfig} from './types.js';

/**
 * Create a Pino logger with full configuration
 */
export function createPinoLogger(config?: Partial<LoggerConfig>): Logger {
	const finalConfig = createConfig(config);
	const isProduction = process.env.NODE_ENV === 'production';
	const isTest = process.env.NODE_ENV === 'test';

	// Skip logging entirely in test mode unless explicitly enabled
	if (isTest && finalConfig.level !== 'debug') {
		finalConfig.level = 'silent';
	}

	// Create redaction rules
	const redactionRules = createRedactionRules(
		finalConfig.redact,
		true, // Enable email redaction
		true, // Enable user ID redaction
	);

	// Base Pino configuration
	const pinoConfig: pino.LoggerOptions = {
		level: finalConfig.level,
		redact: {
			paths: finalConfig.redact,
			censor: '[REDACTED]',
		},
		// Use formatters only for level, avoiding type conflicts
		formatters: {
			level: (label: string, number: number) => ({ level: label.toUpperCase() }),
		},
		// Custom timestamp function
		timestamp: isProduction
			? pino.stdTimeFunctions.isoTime
			: pino.stdTimeFunctions.epochTime,
		// Base context
		base: {
			pid: process.pid,
			hostname:
				process.env.HOSTNAME || process.env.HOST || hostname(),
			service: 'nanocoder',
			version: process.env.npm_package_version || '1.18.0',
		},
	};

	// Create destination stream
	let destination: DestinationStream | undefined;

	if (finalConfig.destination) {
		if (typeof finalConfig.destination === 'string') {
			// File destination

			// Ensure directory exists
			const dir = dirname(finalConfig.destination);
			if (!existsSync(dir)) {
				mkdirSync(dir, {recursive: true});
			}

			destination = createWriteStream(finalConfig.destination, {flags: 'a'});
		} else if (typeof finalConfig.destination === 'number') {
			// File descriptor
			destination = finalConfig.destination;
		}
	}

	// Create the Pino logger instance
	let pinoLogger: PinoLogger;

	if (destination) {
		pinoLogger = pino(pinoConfig, destination);
	} else {
		pinoLogger = pino(pinoConfig);
	}

	// Create enhanced logger with correlation and redaction
	const enhancedLogger: Logger = {
		// Logging methods - supporting both (msg, ...args) and (obj, msg?) signatures
		fatal: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				// Called as fatal(object, ?message)
				const obj = args[0];
				const msg = args[1];
				logWithContext(pinoLogger, 'fatal', msg || '', [obj], redactionRules);
			} else {
				// Called as fatal(msg, ...args)
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(pinoLogger, 'fatal', msg, restArgs, redactionRules);
			}
		}) as any,
		error: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				// Called as error(object, ?message)
				const obj = args[0];
				const msg = args[1];
				logWithContext(pinoLogger, 'error', msg || '', [obj], redactionRules);
			} else {
				// Called as error(msg, ...args)
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(pinoLogger, 'error', msg, restArgs, redactionRules);
			}
		}) as any,
		warn: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				// Called as warn(object, ?message)
				const obj = args[0];
				const msg = args[1];
				logWithContext(pinoLogger, 'warn', msg || '', [obj], redactionRules);
			} else {
				// Called as warn(msg, ...args)
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(pinoLogger, 'warn', msg, restArgs, redactionRules);
			}
		}) as any,
		info: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				// Called as info(object, ?message)
				const obj = args[0];
				const msg = args[1];
				logWithContext(pinoLogger, 'info', msg || '', [obj], redactionRules);
			} else {
				// Called as info(msg, ...args)
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(pinoLogger, 'info', msg, restArgs, redactionRules);
			}
		}) as any,
		http: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				// Called as http(object, ?message)
				const obj = args[0];
				const msg = args[1];
				logWithContext(pinoLogger, 'http', msg || '', [obj], redactionRules);
			} else {
				// Called as http(msg, ...args)
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(pinoLogger, 'http', msg, restArgs, redactionRules);
			}
		}) as any,
		debug: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				// Called as debug(object, ?message)
				const obj = args[0];
				const msg = args[1];
				logWithContext(pinoLogger, 'debug', msg || '', [obj], redactionRules);
			} else {
				// Called as debug(msg, ...args)
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(pinoLogger, 'debug', msg, restArgs, redactionRules);
			}
		}) as any,
		trace: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				// Called as trace(object, ?message)
				const obj = args[0];
				const msg = args[1];
				logWithContext(pinoLogger, 'trace', msg || '', [obj], redactionRules);
			} else {
				// Called as trace(msg, ...args)
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(pinoLogger, 'trace', msg, restArgs, redactionRules);
			}
		}) as any,

		// Child logger creation
		child: (bindings: Record<string, any>) => {
			return createEnhancedChild(pinoLogger, bindings, redactionRules);
		},

		// Utility methods
		isLevelEnabled: (level: string) => {
			return pinoLogger.isLevelEnabled(level);
		},

		flush: async () => {
			if ('flush' in pinoLogger) {
				await (pinoLogger as any).flush();
			}
		},

		end: async () => {
			if ('end' in pinoLogger) {
				await (pinoLogger as any).end();
			}
		},
	};

	return enhancedLogger;
}

/**
 * Enhanced child logger with correlation and redaction
 */
function createEnhancedChild(
	parent: PinoLogger,
	bindings: Record<string, any>,
	redactionRules: any,
): Logger {
	const child = parent.child(bindings);

	return {
		fatal: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				// Called as fatal(object, ?message)
				const obj = args[0];
				const msg = args[1];
				logWithContext(child, 'fatal', msg || '', [obj], redactionRules);
			} else {
				// Called as fatal(msg, ...args)
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(child, 'fatal', msg, restArgs, redactionRules);
			}
		}) as any,
		error: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				// Called as error(object, ?message)
				const obj = args[0];
				const msg = args[1];
				logWithContext(child, 'error', msg || '', [obj], redactionRules);
			} else {
				// Called as error(msg, ...args)
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(child, 'error', msg, restArgs, redactionRules);
			}
		}) as any,
		warn: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				// Called as warn(object, ?message)
				const obj = args[0];
				const msg = args[1];
				logWithContext(child, 'warn', msg || '', [obj], redactionRules);
			} else {
				// Called as warn(msg, ...args)
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(child, 'warn', msg, restArgs, redactionRules);
			}
		}) as any,
		info: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				// Called as info(object, ?message)
				const obj = args[0];
				const msg = args[1];
				logWithContext(child, 'info', msg || '', [obj], redactionRules);
			} else {
				// Called as info(msg, ...args)
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(child, 'info', msg, restArgs, redactionRules);
			}
		}) as any,
		http: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				// Called as http(object, ?message)
				const obj = args[0];
				const msg = args[1];
				logWithContext(child, 'http', msg || '', [obj], redactionRules);
			} else {
				// Called as http(msg, ...args)
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(child, 'http', msg, restArgs, redactionRules);
			}
		}) as any,
		debug: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				// Called as debug(object, ?message)
				const obj = args[0];
				const msg = args[1];
				logWithContext(child, 'debug', msg || '', [obj], redactionRules);
			} else {
				// Called as debug(msg, ...args)
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(child, 'debug', msg, restArgs, redactionRules);
			}
		}) as any,
		trace: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				// Called as trace(object, ?message)
				const obj = args[0];
				const msg = args[1];
				logWithContext(child, 'trace', msg || '', [obj], redactionRules);
			} else {
				// Called as trace(msg, ...args)
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(child, 'trace', msg, restArgs, redactionRules);
			}
		}) as any,

		child: (moreBindings: Record<string, any>) => {
			return createEnhancedChild(child, moreBindings, redactionRules);
		},

		isLevelEnabled: (level: string) => {
			return child.isLevelEnabled(level);
		},

		flush: async () => {
			if ('flush' in child) {
				await (child as any).flush();
			}
		},

		end: async () => {
			if ('end' in child) {
				await (child as any).end();
			}
		},
	};
}

/**
 * Log message with correlation context and redaction
 */
function logWithContext(
	logger: PinoLogger,
	level: string,
	msg: string,
	args: any[],
	redactionRules: any = createRedactionRules(),
): void {
	// Prepare log data
	let logData: Record<string, any> = {msg};

	// Add correlation context if enabled
	if (isCorrelationEnabled()) {
		const correlationContext = getCurrentCorrelationContext();
		if (correlationContext) {
			logData = {
				...logData,
				...formatCorrelationForLog(),
			};

			// Add correlation metadata if available
			const metadata = correlationContext.metadata;
			if (metadata) {
				logData = {...logData, correlation: metadata};
			}
		}
	}

	// Handle additional arguments
	if (args.length > 0) {
		if (args.length === 1 && typeof args[0] === 'object') {
			// Merge object with log data
			logData = {...logData, ...args[0]};
		} else {
			// Add args as extra field
			logData.extra = args;
		}
	}

	// Apply redaction
	logData = redactLogEntry(logData, redactionRules);

	// Log with Pino
	(logger as any)[level](logData);
}

/**
 * Create a logger with transport configuration
 */
export function createLoggerWithTransport(
	config?: Partial<LoggerConfig>,
	transport?: any,
): Logger {
	const finalConfig = createConfig(config);
	const pinoConfig = {
		level: finalConfig.level,
		redact: {
			paths: finalConfig.redact,
			censor: '[REDACTED]',
		},
		// Use formatters only for level, avoiding type conflicts
		formatters: {
			level: (label: string, number: number) => ({ level: label.toUpperCase() }),
		},
		transport,
		// Suppress exit on error in production
		onFatal: (err: Error) => {
			if (process.env.NODE_ENV === 'production') {
				console.error('[FATAL]', err);
			} else {
				throw err;
			}
		},
	};

	const pinoLogger = pino(pinoConfig);
	const redactionRules = createRedactionRules(
		finalConfig.redact,
		true, // Enable email redaction
		true, // Enable user ID redaction
	);

	return createEnhancedChild(pinoLogger, {}, redactionRules);
}

/**
 * Get logger statistics
 */
export function getLoggerStats(): {
	level: string;
	silent: boolean;
} {
	const config = createConfig();
	return {
		level: config.level,
		silent: config.level === 'silent',
	};
}
