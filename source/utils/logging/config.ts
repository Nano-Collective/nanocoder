/**
 * Environment-based configuration for Pino logger
 */

import {join} from 'path';
import {platform} from 'os';
import {homedir} from 'os';
import type {LoggerConfig, TransportConfig} from './types.js';

/**
 * Get the default log directory based on platform
 */
export function getDefaultLogDirectory(): string {
	const env = process.env.NODE_ENV || 'development';

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
export function createDevelopmentConfig(): any {
	return {
		level: (process.env.LOG_LEVEL as any) || 'debug',
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
export function createProductionConfig(): any {
	const logDir = getDefaultLogDirectory();

	return {
		level: (process.env.LOG_LEVEL as any) || 'info',
		destination: join(logDir, 'nanocoder.log'),
		pretty: false,
		redact: ['apiKey', 'token', 'password', 'email', 'userId', 'secret'],
		correlation: true,
		serialize: true,
		target: 'pino-roll',
		options: {
			destination: join(logDir, 'nanocoder-%Y-%m-%d.log'),
			frequency: 'daily',
			size: '100m',
			dateFormat: 'yyyy-MM-dd',
			extension: '.log',
			symlink: true,
			mkdir: true,
			compress: true,
			sync: false,
			limit: {
				count: 30,
				removeOtherLogFiles: true,
			},
			minLength: 4096,
			maxLength: 1048576, // 1MB
			periodicFlush: 1000,
		},
	};
}

/**
 * Create test configuration (minimal output)
 */
export function createTestConfig(): any {
	return {
		level: 'silent',
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
export function getEnvironmentConfig(): any {
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
): any {
	const baseConfig = getEnvironmentConfig();

	// Apply overrides with validation
	if (overrides.level) {
		const normalizedLevel = normalizeLogLevel(overrides.level);
		if (!validateLogLevel(normalizedLevel)) {
			console.warn(
				`[WARNING] Invalid log level "${overrides.level}", using default`,
			);
		} else {
			baseConfig.level = normalizedLevel as any;
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
			...(overrides as any)?.options,
		},
	};
}
