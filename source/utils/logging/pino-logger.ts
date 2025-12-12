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
	ConsoleArguments,
	PinoTransportOptions,
} from './types.js';

/**
 * Type for redaction rules
 */
type RedactionRules = {
	patterns: RegExp[];
	customPaths: string[];
	emailRedaction: boolean;
	userIdRedaction: boolean;
	[key: string]: unknown;
};

/**
 * Determine transport configuration based on environment and CLI settings
 */
function determineTransportConfig(
	_isProduction: boolean,
	_isDevelopment: boolean,
	_isTest: boolean,
	_cliConfig?: LoggingCliConfig,
): EnvironmentTransportConfig {
	const _envLogFile = process.env.LOG_TO_FILE === 'true';
	const _envLogConsole = process.env.LOG_TO_CONSOLE === 'true';

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

		const transportOptions: PinoTransportOptions = {
			target: 'pino/file',
			options: {
				destination: logFilePath,
				mkdir: true,
			},
		};

		const transport = pino.transport(transportOptions) as pino.DestinationStream;
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
	redactionRules?: RedactionRules,
): Logger {
	return {
		fatal: ((...args: ConsoleArguments) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0] as Record<string, unknown>;
				const msg = args[1] as string | undefined;
				logWithContext(pinoLogger, 'fatal', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0] as string;
				const restArgs = args.slice(1) as ConsoleArguments;
				logWithContext(pinoLogger, 'fatal', msg, restArgs, redactionRules);
			}
		}),

		error: ((...args: ConsoleArguments) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0] as Record<string, unknown>;
				const msg = args[1] as string | undefined;
				logWithContext(pinoLogger, 'error', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0] as string;
				const restArgs = args.slice(1) as ConsoleArguments;
				logWithContext(pinoLogger, 'error', msg, restArgs, redactionRules);
			}
		}),

		warn: ((...args: ConsoleArguments) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0] as Record<string, unknown>;
				const msg = args[1] as string | undefined;
				logWithContext(pinoLogger, 'warn', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0] as string;
				const restArgs = args.slice(1) as ConsoleArguments;
				logWithContext(pinoLogger, 'warn', msg, restArgs, redactionRules);
			}
		}),

		info: ((...args: ConsoleArguments) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0] as Record<string, unknown>;
				const msg = args[1] as string | undefined;
				logWithContext(pinoLogger, 'info', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0] as string;
				const restArgs = args.slice(1) as ConsoleArguments;
				logWithContext(pinoLogger, 'info', msg, restArgs, redactionRules);
			}
		}),

		http: ((...args: ConsoleArguments) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0] as Record<string, unknown>;
				const msg = args[1] as string | undefined;
				logWithContext(pinoLogger, 'http', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0] as string;
				const restArgs = args.slice(1) as ConsoleArguments;
				logWithContext(pinoLogger, 'http', msg, restArgs, redactionRules);
			}
		}),

		debug: ((...args: ConsoleArguments) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0] as Record<string, unknown>;
				const msg = args[1] as string | undefined;
				logWithContext(pinoLogger, 'debug', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0] as string;
				const restArgs = args.slice(1) as ConsoleArguments;
				logWithContext(pinoLogger, 'debug', msg, restArgs, redactionRules);
			}
		}),

		trace: ((...args: ConsoleArguments) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0] as Record<string, unknown>;
				const msg = args[1] as string | undefined;
				logWithContext(pinoLogger, 'trace', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0] as string;
				const restArgs = args.slice(1) as ConsoleArguments;
				logWithContext(pinoLogger, 'trace', msg, restArgs, redactionRules);
			}
		}),

		child: (bindings: Record<string, unknown>) => {
			return createEnhancedChild(pinoLogger, bindings, redactionRules);
		},

		isLevelEnabled: (level: string) => {
			return pinoLogger.isLevelEnabled(level);
		},

		flush: async (): Promise<void> => {
			if ('flush' in pinoLogger) {
				const flushMethod = (pinoLogger as PinoLogger & { flush?: (() => void) | (() => Promise<void>) }).flush;
				if (flushMethod) {
					const result = flushMethod();
					if (result instanceof Promise) {
						await result;
					}
				}
			}
		},

		end: async (): Promise<void> => {
			if ('end' in pinoLogger) {
				const endMethod = (pinoLogger as PinoLogger & { end?: (() => void) | (() => Promise<void>) }).end;
				if (endMethod) {
					const result = endMethod();
					if (result instanceof Promise) {
						await result;
					}
				}
			}
		},
	};
}

/**
 * Create enhanced child logger with correlation and redaction
 */
function createEnhancedChild(
	parent: PinoLogger,
	bindings: Record<string, unknown>,
	redactionRules?: RedactionRules,
): Logger {
	const child = parent.child(bindings);

	return {
		fatal: ((...args: ConsoleArguments) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0] as Record<string, unknown>;
				const msg = args[1] as string | undefined;
				logWithContext(child, 'fatal', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0] as string;
				const restArgs = args.slice(1) as ConsoleArguments;
				logWithContext(child, 'fatal', msg, restArgs, redactionRules);
			}
		}),

		error: ((...args: ConsoleArguments) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0] as Record<string, unknown>;
				const msg = args[1] as string | undefined;
				logWithContext(child, 'error', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0] as string;
				const restArgs = args.slice(1) as ConsoleArguments;
				logWithContext(child, 'error', msg, restArgs, redactionRules);
			}
		}),

		warn: ((...args: ConsoleArguments) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0] as Record<string, unknown>;
				const msg = args[1] as string | undefined;
				logWithContext(child, 'warn', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0] as string;
				const restArgs = args.slice(1) as ConsoleArguments;
				logWithContext(child, 'warn', msg, restArgs, redactionRules);
			}
		}),

		info: ((...args: ConsoleArguments) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0] as Record<string, unknown>;
				const msg = args[1] as string | undefined;
				logWithContext(child, 'info', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0] as string;
				const restArgs = args.slice(1) as ConsoleArguments;
				logWithContext(child, 'info', msg, restArgs, redactionRules);
			}
		}),

		http: ((...args: ConsoleArguments) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0] as Record<string, unknown>;
				const msg = args[1] as string | undefined;
				logWithContext(child, 'http', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0] as string;
				const restArgs = args.slice(1) as ConsoleArguments;
				logWithContext(child, 'http', msg, restArgs, redactionRules);
			}
		}),

		debug: ((...args: ConsoleArguments) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0] as Record<string, unknown>;
				const msg = args[1] as string | undefined;
				logWithContext(child, 'debug', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0] as string;
				const restArgs = args.slice(1) as ConsoleArguments;
				logWithContext(child, 'debug', msg, restArgs, redactionRules);
			}
		}),

		trace: ((...args: ConsoleArguments) => {
			if (args.length === 0) return;
			if (typeof args[0] === 'object' && args[0] !== null) {
				const obj = args[0] as Record<string, unknown>;
				const msg = args[1] as string | undefined;
				logWithContext(child, 'trace', msg || '', [obj], redactionRules);
			} else {
				const msg = args[0] as string;
				const restArgs = args.slice(1) as ConsoleArguments;
				logWithContext(child, 'trace', msg, restArgs, redactionRules);
			}
		}),

		child: (moreBindings: Record<string, unknown>) => {
			return createEnhancedChild(child, moreBindings, redactionRules);
		},

		isLevelEnabled: (level: string) => {
			return child.isLevelEnabled(level);
		},

		flush: async (): Promise<void> => {
			if ('flush' in child) {
				const flushMethod = (child as PinoLogger & { flush?: (() => void) | (() => Promise<void>) }).flush;
				if (flushMethod) {
					const result = flushMethod();
					if (result instanceof Promise) {
						await result;
					}
				}
			}
		},

		end: async (): Promise<void> => {
			if ('end' in child) {
				const endMethod = (child as PinoLogger & { end?: (() => void) | (() => Promise<void>) }).end;
				if (endMethod) {
					const result = endMethod();
					if (result instanceof Promise) {
						await result;
					}
				}
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
	args: ConsoleArguments,
	redactionRules?: RedactionRules,
): void {
	// Prepare log data
	let logData: Record<string, unknown> = {msg};

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
	switch (level) {
		case 'fatal':
			logger.fatal(logData);
			break;
		case 'error':
			logger.error(logData);
			break;
		case 'warn':
			logger.warn(logData);
			break;
		case 'info':
			logger.info(logData);
			break;
		case 'http':
			if ('http' in logger) {
				(logger as { http?: (data: Record<string, unknown>) => void }).http?.(logData);
			}
			break;
		case 'debug':
			logger.debug(logData);
			break;
		case 'trace':
			logger.trace(logData);
			break;
		default:
			logger.info(logData);
			break;
	}
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
	const _redactionRules = createRedactionRules(
		finalConfig.redact,
		isProduction, // Enable email redaction in production
		isProduction, // Enable user ID redaction in production
	);

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
			// REMOVED: hostname field
			platform: process.platform, // NEW: platform field
			arch: process.arch, // NEW: architecture field
			service: 'nanocoder',
			version: process.env.npm_package_version || '1.18.0',
			environment: process.env.NODE_ENV || 'development', // NEW: environment field
			nodeVersion: process.version, // NEW: Node.js version field
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
		transport: actualTransport,
		base: {
			pid: process.pid,
			platform: process.platform,
			arch: process.arch,
			service: 'nanocoder',
			version: process.env.npm_package_version || '1.18.0',
			environment: process.env.NODE_ENV || 'development',
			nodeVersion: process.version, // NEW: Node.js version field
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
