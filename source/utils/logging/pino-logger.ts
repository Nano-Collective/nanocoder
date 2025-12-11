/**
 * Pino logger implementation with environment-specific transport support
 */

import pino, {type Logger as PinoLogger} from 'pino';
import {mkdirSync, existsSync} from 'fs';
import {join} from 'path';
import {createConfig, getDefaultLogDirectory} from './config.js';
import {redactLogEntry, createRedactionRules} from './redaction.js';
import {
	getCurrentCorrelationContext,
	formatCorrelationForLog,
	isCorrelationEnabled,
} from './correlation.js';
import type {
	Logger,
	LoggerConfig,
	LoggingCliConfig,
	EnvironmentTransportConfig,
} from './types.js';

/**
 * Determine transport configuration based on environment and CLI settings
 */
function determineTransportConfig(
	isProduction: boolean,
	isDevelopment: boolean,
	isTest: boolean,
	cliConfig?: LoggingCliConfig,
): EnvironmentTransportConfig {
	const envLogFile = process.env.LOG_TO_FILE === 'true';
	const envLogConsole = process.env.LOG_TO_CONSOLE === 'true';

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

		const logFilePath = join(
			logDir,
			`nanocoder-${new Date().toISOString().split('T')[0]}.log`,
		);

		const transport = pino.transport({
			target: 'pino/file',
			options: {
				destination: logFilePath,
				mkdir: true,
			},
		});

		const pinoLogger = pino(baseConfig, transport);
		const redactionRules = createRedactionRules(
			Array.isArray(baseConfig.redact) ? baseConfig.redact : [],
			true, // Enable email redaction
			true, // Enable user ID redaction
		);

		return createEnhancedLogger(pinoLogger, undefined, redactionRules);
	}

	// Silent fallback (should not reach here with new config)
	return createSilentLogger();
}

/**
 * Create enhanced logger with correlation and redaction support
 */
function createEnhancedLogger(
	pinoLogger: PinoLogger,
	_fileLogger?: PinoLogger,
	redactionRules?: any,
): Logger {
	return {
		fatal: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0];
				const msg = args[1];
				logWithContext(pinoLogger, 'fatal', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(pinoLogger, 'fatal', msg, restArgs, redactionRules);
			}
		}) as any,

		error: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0];
				const msg = args[1];
				logWithContext(pinoLogger, 'error', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(pinoLogger, 'error', msg, restArgs, redactionRules);
			}
		}) as any,

		warn: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0];
				const msg = args[1];
				logWithContext(pinoLogger, 'warn', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(pinoLogger, 'warn', msg, restArgs, redactionRules);
			}
		}) as any,

		info: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0];
				const msg = args[1];
				logWithContext(pinoLogger, 'info', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(pinoLogger, 'info', msg, restArgs, redactionRules);
			}
		}) as any,

		http: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0];
				const msg = args[1];
				logWithContext(pinoLogger, 'http', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(pinoLogger, 'http', msg, restArgs, redactionRules);
			}
		}) as any,

		debug: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0];
				const msg = args[1];
				logWithContext(pinoLogger, 'debug', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(pinoLogger, 'debug', msg, restArgs, redactionRules);
			}
		}) as any,

		trace: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0];
				const msg = args[1];
				logWithContext(pinoLogger, 'trace', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(pinoLogger, 'trace', msg, restArgs, redactionRules);
			}
		}) as any,

		child: (bindings: Record<string, any>) => {
			return createEnhancedChild(pinoLogger, bindings, redactionRules);
		},

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
}

/**
 * Create enhanced child logger with correlation and redaction
 */
function createEnhancedChild(
	parent: PinoLogger,
	bindings: Record<string, any>,
	redactionRules?: any,
): Logger {
	const child = parent.child(bindings);

	return {
		fatal: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0];
				const msg = args[1];
				logWithContext(child, 'fatal', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(child, 'fatal', msg, restArgs, redactionRules);
			}
		}) as any,

		error: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0];
				const msg = args[1];
				logWithContext(child, 'error', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(child, 'error', msg, restArgs, redactionRules);
			}
		}) as any,

		warn: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0];
				const msg = args[1];
				logWithContext(child, 'warn', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(child, 'warn', msg, restArgs, redactionRules);
			}
		}) as any,

		info: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0];
				const msg = args[1];
				logWithContext(child, 'info', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(child, 'info', msg, restArgs, redactionRules);
			}
		}) as any,

		http: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0];
				const msg = args[1];
				logWithContext(child, 'http', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(child, 'http', msg, restArgs, redactionRules);
			}
		}) as any,

		debug: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0];
				const msg = args[1];
				logWithContext(child, 'debug', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0];
				const restArgs = args.slice(1);
				logWithContext(child, 'debug', msg, restArgs, redactionRules);
			}
		}) as any,

		trace: ((...args: any[]) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0];
				const msg = args[1];
				logWithContext(child, 'trace', msg || '', [obj], redactionRules);
			} else {
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
 * Create a silent logger that does nothing
 */
function createSilentLogger(): Logger {
	return {
		fatal: () => {},
		error: () => {},
		warn: () => {},
		info: () => {},
		http: () => {},
		debug: () => {},
		trace: () => {},
		child: () => createSilentLogger(),
		isLevelEnabled: () => false,
		flush: async () => {},
		end: async () => {},
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
	redactionRules?: any,
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
	if (redactionRules) {
		logData = redactLogEntry(logData, redactionRules);
	}

	// Log to the transport
	(logger as any)[level](logData);
}

/**
 * Create a Pino logger with environment-specific transports and CLI configuration
 */
export function createPinoLogger(
	config?: Partial<LoggerConfig>,
	cliConfig?: LoggingCliConfig,
): Logger {
	const finalConfig = createConfig(config);
	const isProduction = process.env.NODE_ENV === 'production';
	const isTest = process.env.NODE_ENV === 'test';
	const isDevelopment = !isProduction && !isTest;

	// Determine transport configuration
	const transportConfig = determineTransportConfig(
		isProduction,
		isDevelopment,
		isTest,
		cliConfig,
	);

	// Create redaction rules
	const redactionRules = createRedactionRules(
		finalConfig.redact,
		isProduction, // Enable email redaction in production
		isProduction, // Enable user ID redaction in production
	);

	// Base Pino configuration with updated fields
	const baseConfig: pino.LoggerOptions = {
		level: finalConfig.level,
		redact: finalConfig.redact,
		formatters: {
			level: (label: string, number: number) => ({level: label.toUpperCase()}),
		},
		timestamp: pino.stdTimeFunctions.isoTime,
		base: {
			pid: process.pid,
			// REMOVED: hostname field
			platform: process.platform, // NEW: platform field
			arch: process.arch, // NEW: architecture field
			service: 'nanocoder',
			version: process.env.npm_package_version || '1.18.0',
			environment: process.env.NODE_ENV || 'development', // NEW: environment field
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
	transport?: any,
): Logger {
	const finalConfig = createConfig(config);
	const pinoConfig = {
		level: finalConfig.level,
		redact: finalConfig.redact,
		formatters: {
			level: (label: string, number: number) => ({level: label.toUpperCase()}),
		},
		transport,
		base: {
			pid: process.pid,
			platform: process.platform,
			arch: process.arch,
			service: 'nanocoder',
			version: process.env.npm_package_version || '1.18.0',
			environment: process.env.NODE_ENV || 'development',
		},
	};

	const pinoLogger = pino(pinoConfig);
	const redactionRules = createRedactionRules(
		finalConfig.redact,
		true, // Enable email redaction
		true, // Enable user ID redaction
	);

	return createEnhancedLogger(pinoLogger, undefined, redactionRules);
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
	const environment = process.env.NODE_ENV || 'development';
	return {
		level: config.level,
		silent: config.level === 'silent',
		environment,
	};
}