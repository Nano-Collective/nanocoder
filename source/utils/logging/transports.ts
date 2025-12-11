/**
 * Transport configuration for different output destinations
 */

import {join} from 'path';
import {getDefaultLogDirectory} from './config.js';
import type {TransportConfig} from './types.js';

// Type definition for Pino transport target
type TransportTarget = {
	target: string;
	options?: Record<string, unknown>;
	level?: string;
};

/**
 * Create a development transport with pretty printing
 */
export function createDevelopmentTransport(): TransportTarget {
	return {
		target: 'pino-pretty',
		level: 'debug',
		options: {
			colorize: true,
			translateTime: 'HH:MM:ss Z',
			ignore: 'pid,hostname',
			levelFirst: true,
			messageFormat: '{levelLabel} - {msg}',
			customPrettifiers: {
				time: (timestamp: number) => {
					return new Date(timestamp).toLocaleTimeString('en-US', {
						hour12: false,
						timeZone: 'UTC',
					});
				},
			},
			singleLine: false,
		},
	};
}

/**
 * Create a production transport with file rotation
 */
export function createProductionTransport(
	logDir: string = getDefaultLogDirectory(),
): TransportTarget {
	return {
		target: 'pino-roll',
		level: 'info',
		options: {
			file: join(logDir, 'nanocoder-%Y-%m-%d.log'),
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
 * Create a test transport that outputs to /dev/null
 */
export function createTestTransport(): TransportTarget {
	return {
		target: 'pino/file',
		level: 'silent',
		options: {
			destination: '/dev/null',
		},
	};
}

/**
 * Create a custom transport for specific needs
 */
export function createCustomTransport(
	config: TransportConfig,
): TransportTarget {
	return {
		target: config.target,
		level: (config.options as {level?: string})?.level || 'info',
		options: {
			...config.options,
			// Ensure minimum buffer size for performance
			minLength: config.options.minLength || 4096,
			// Set maximum buffer size to prevent memory issues
			maxLength: config.options.maxLength || 1048576,
		},
	};
}

/**
 * Create a multi-transport configuration
 */
export function createMultiTransport(): TransportTarget[] {
	const transports: TransportTarget[] = [];
	const env = process.env.NODE_ENV || 'development';

	// Always include console output for development
	if (env !== 'production') {
		transports.push(createDevelopmentTransport());
	}

	// Add file output for production or when explicitly enabled
	if (env === 'production' || process.env.LOG_TO_FILE === 'true') {
		transports.push(createProductionTransport());
	}

	return transports;
}

/**
 * Create a transport with buffering for high-performance scenarios
 */
export function createBufferedTransport(
	baseTransport: TransportTarget,
	bufferSize: number = 65536,
): TransportTarget {
	return {
		...baseTransport,
		options: {
			...baseTransport.options,
			// Use sonic-boom for high-performance buffering
			bufferSize,
			// Enable async writing
			sync: false,
		},
	};
}

/**
 * Create a transport for error-specific logging
 */
export function createErrorTransport(
	logDir: string = getDefaultLogDirectory(),
): TransportTarget {
	return {
		target: 'pino-roll',
		level: 'error',
		options: {
			file: join(logDir, 'nanocoder-error-%Y-%m-%d.log'),
			frequency: 'daily',
			size: '50m', // Smaller files for errors
			dateFormat: 'yyyy-MM-dd',
			extension: '.log',
			mkdir: true,
			compress: true,
			sync: true, // Sync writes for errors to ensure they're logged
			limit: {
				count: 90, // Keep more error logs
				removeOtherLogFiles: true,
			},
			minLength: 1024,
			maxLength: 1048576,
		},
	};
}

/**
 * Create a transport for audit logging
 */
export function createAuditTransport(
	logDir: string = getDefaultLogDirectory(),
): TransportTarget {
	return {
		target: 'pino-roll',
		level: 'info',
		options: {
			file: join(logDir, 'nanocoder-audit-%Y-%m-%d.log'),
			frequency: 'daily',
			size: '200m',
			dateFormat: 'yyyy-MM-dd',
			extension: '.log',
			mkdir: true,
			compress: true,
			sync: true, // Sync writes for audit logs
			limit: {
				count: 365, // Keep 1 year of audit logs
				removeOtherLogFiles: false,
			},
			minLength: 1024,
			maxLength: 10485760, // 10MB for audit logs
		},
	};
}

/**
 * Get transport configuration based on environment variables
 */
export function getTransportFromEnvironment():
	| TransportTarget
	| TransportTarget[] {
	// Support multiple transports via comma separation
	const transportTypes = (process.env.LOG_TRANSPORTS || 'default')
		.split(',')
		.map(t => t.trim());
	const transports: TransportTarget[] = [];

	for (const transportType of transportTypes) {
		switch (transportType) {
			case 'development':
			case 'dev':
				transports.push(createDevelopmentTransport());
				break;

			case 'production':
			case 'prod':
				transports.push(createProductionTransport());
				break;

			case 'test':
				transports.push(createTestTransport());
				break;

			case 'error':
				transports.push(createErrorTransport());
				break;

			case 'audit':
				transports.push(createAuditTransport());
				break;

			case 'default':
			default:
				// Use default behavior
				{
					const defaultTransports = createMultiTransport();
					transports.push(...defaultTransports);
				}
				break;
		}
	}

	// Return single transport if only one, otherwise return array
	return transports.length === 1 ? transports[0] : transports;
}

/**
 * Validate transport configuration
 */
export function validateTransport(transport: TransportTarget): boolean {
	if (!transport.target) {
		console.error('[ERROR] Transport target is required');
		return false;
	}

	// Validate target is a string or function
	if (
		typeof transport.target !== 'string' &&
		typeof transport.target !== 'function'
	) {
		console.error('[ERROR] Transport target must be a string or function');
		return false;
	}

	// Validate options if present
	if (transport.options && typeof transport.options !== 'object') {
		console.error('[ERROR] Transport options must be an object');
		return false;
	}

	return true;
}

/**
 * Create transport with error handling and fallback
 */
export function createSafeTransport(
	primaryTransport: TransportTarget,
	fallbackTransport?: TransportTarget,
): TransportTarget {
	try {
		if (!validateTransport(primaryTransport)) {
			throw new Error('Invalid primary transport configuration');
		}

		return primaryTransport;
	} catch (error) {
		console.error('[ERROR] Failed to create primary transport:', error);

		if (fallbackTransport) {
			console.warn('[WARN] Falling back to secondary transport');
			if (validateTransport(fallbackTransport)) {
				return fallbackTransport;
			}
		}

		// Ultimate fallback to console
		console.warn('[WARN] Falling back to console transport');
		return createDevelopmentTransport();
	}
}
