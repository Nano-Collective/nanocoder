/**
 * Environment-based configuration for Pino logger
 */

import {join} from 'path';
import {platform} from 'os';
import {homedir} from 'os';
import type {LoggerConfig, EnhancedLoggerConfig, LogLevel} from './types.js';

/**
 * Get the default log directory based on platform
 */
export function getDefaultLogDirectory(): string {
	const _env = process.env.NODE_ENV || 'development';

	if (process.env.LOG_DIR) {
		return process.env.LOG_DIR;
	}

	switch (platform()) {
		case 'win32':
			return join(process.env.APPDATA || homedir(), 'nanocoder', 'logs');
		case 'darwin':
			return join(homedir(), 'Library', 'Preferences', 'nanocoder', 'logs');
		default: // linux
			return join(homedir(), '.config', 'nanocoder', 'logs');
	}
}

/**
 * Create development configuration
 */
export function createDevelopmentConfig(): EnhancedLoggerConfig {
	return {
		level: (process.env.LOG_LEVEL as LogLevel) || 'debug',
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
 */
export function createProductionConfig(): EnhancedLoggerConfig {
	const _logDir = getDefaultLogDirectory();

	// Check if file logging is explicitly disabled
	const disableFileLogging = process.env.LOG_DISABLE_FILE === 'true';

	const baseConfig = {
		level: (process.env.LOG_LEVEL as LogLevel) || 'debug', // Changed from 'info' to 'debug'
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
		// when LOG_TO_FILE=true is set
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
 */
export function getEnvironmentConfig(): EnhancedLoggerConfig {
	const env = process.env.NODE_ENV || 'development';

	switch (env) {
		case 'production':
			return createProductionConfig();
		case 'test':
			return createTestConfig();
		default:
			return createDevelopmentConfig();
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
