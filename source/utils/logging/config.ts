/**
 * Environment-based configuration for Pino logger
 */

import {homedir, platform} from 'os';
import {join} from 'path';
import type {EnhancedLoggerConfig, LoggerConfig, LogLevel} from './types.js';

/**
 * Get the default log directory based on platform
 * Follows OS conventions:
 * - macOS: ~/Library/Logs/nanocoder
 * - Linux: ~/.local/state/nanocoder/logs (XDG_STATE_HOME)
 * - Windows: %LOCALAPPDATA%/nanocoder/logs
 */
export function getDefaultLogDirectory(): string {
	if (process.env.NANOCODER_LOG_DIR) {
		return process.env.NANOCODER_LOG_DIR;
	}

	switch (platform()) {
		case 'win32':
			return join(
				process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
				'nanocoder',
				'logs',
			);
		case 'darwin':
			return join(homedir(), 'Library', 'Logs', 'nanocoder');
		default: // linux
			return join(
				process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'),
				'nanocoder',
				'logs',
			);
	}
}

/**
 * Create development configuration
 */
export function createDevelopmentConfig(): EnhancedLoggerConfig {
	return {
		level: (process.env.NANOCODER_LOG_LEVEL as LogLevel) || 'debug',
		destination: String(process.stdout.fd),
		pretty: true,
		redact: ['apiKey', 'token', 'password', 'secret'],
		correlation: true,
		serialize: false,
		target: 'pino-pretty',
		options: {
			translateTime: 'HH:MM:ss Z',
			ignore: 'pid,hostname',
			messageFormat: undefined,
			customPrettifiers: {},
			levelFirst: false,
			singleLine: false,
		},
	};
}

/**
 * Create production configuration
 *
 * In production, we want:
 * - File logging enabled at 'info' level by default (for diagnostics)
 * - Console/UI output silent (to avoid polluting the user interface)
 *
 * The log level here controls what gets written to files.
 * Console output is suppressed by using file-only transport.
 */
export function createProductionConfig(): EnhancedLoggerConfig {
	// Check if file logging is explicitly disabled
	const disableFileLogging = process.env.NANOCODER_LOG_DISABLE_FILE === 'true';

	// File log level defaults to 'info' for useful diagnostics
	// Can be overridden with NANOCODER_LOG_LEVEL env var
	const fileLogLevel =
		(process.env.NANOCODER_LOG_LEVEL as LogLevel) ||
		(disableFileLogging ? 'silent' : 'info');

	const baseConfig = {
		level: fileLogLevel,
		pretty: false,
		redact: ['apiKey', 'token', 'password', 'email', 'userId', 'secret'],
		correlation: true,
		serialize: true,
	};

	// If file logging is disabled, only use stdout (for UI)
	if (disableFileLogging) {
		return {
			...baseConfig,
			destination: String(process.stdout.fd),
			target: 'pino-pretty',
			options: {
				colorize: false, // No colors in production
				translateTime: 'HH:MM:ss Z',
				ignore: 'pid,hostname',
				levelFirst: true,
				messageFormat: '{level} - {msg}',
				singleLine: true, // Compact for UI
			},
		};
	}

	// Otherwise use stdout for UI with optional file logging
	// This ensures UI works while still allowing file persistence when needed
	return {
		...baseConfig,
		// Always output to stdout for UI compatibility
		destination: String(process.stdout.fd),
		target: 'pino-pretty',
		options: {
			colorize: false, // No colors in production
			translateTime: 'HH:MM:ss Z',
			ignore: 'pid,hostname', // Reduce UI clutter
			levelFirst: false,
			messageFormat: '{msg}',
			singleLine: true, // Compact for UI
		},
		// Note: File logging will be handled by the multi-transport system in transports.ts
		// when NANOCODER_LOG_TO_FILE=true is set
	};
}

/**
 * Create test configuration
 */
export function createTestConfig(): EnhancedLoggerConfig {
	return {
		level: (process.env.LOG_LEVEL as LogLevel) || 'debug', // Changed from 'silent' to 'debug'
		pretty: false,
		redact: ['apiKey', 'token', 'password'],
		correlation: false,
		serialize: false,
		target: 'pino/file',
		options: {
			destination: '/dev/null',
		},
	};
}

/**
 * Get configuration based on current environment
 *
 * For CLI tools, we default to production (silent) behavior when NODE_ENV is not set.
 * This gives users a clean experience. Developers working on nanocoder itself should
 * explicitly set NODE_ENV=development to see debug logs.
 */
export function getEnvironmentConfig(): EnhancedLoggerConfig {
	const env = process.env.NODE_ENV;

	switch (env) {
		case 'development':
			return createDevelopmentConfig();
		case 'test':
			return createTestConfig();
		default:
			// Default to production (silent) for normal CLI usage
			return createProductionConfig();
	}
}

/**
 * Validate log level
 */
export function validateLogLevel(level: string): boolean {
	const validLevels = [
		'fatal',
		'error',
		'warn',
		'info',
		'http',
		'debug',
		'trace',
		'silent',
	];
	return validLevels.includes(level.toLowerCase());
}

/**
 * Normalize log level string
 */
export function normalizeLogLevel(level: string): string {
	const normalized = level.toLowerCase().trim();

	// Map common aliases
	const aliases: Record<string, string> = {
		warning: 'warn',
		err: 'error',
		information: 'info',
		http: 'http',
	};

	return aliases[normalized] || normalized;
}

/**
 * Create configuration with overrides
 */
export function createConfig(
	overrides: Partial<LoggerConfig> = {},
): EnhancedLoggerConfig {
	const baseConfig = getEnvironmentConfig();

	// Apply overrides with validation
	if (overrides.level) {
		const normalizedLevel = normalizeLogLevel(overrides.level);
		if (!validateLogLevel(normalizedLevel)) {
			console.warn(
				`[WARNING] Invalid log level "${overrides.level}", using default`,
			);
		} else {
			baseConfig.level = normalizedLevel as LogLevel;
		}
	}

	if (overrides.redact) {
		baseConfig.redact = [
			...new Set([...baseConfig.redact, ...overrides.redact]),
		];
	}

	// Merge other properties
	return {
		...baseConfig,
		...overrides,
		options: {
			...baseConfig.options,
			...(overrides as EnhancedLoggerConfig)?.options,
		},
	};
}
