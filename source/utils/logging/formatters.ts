/**
 * Output formatters for JSON and pretty logging
 */

import type {LogEntry} from './types.js';

/**
 * Format log level as uppercase string
 */
export function formatLevel(label: string, _number: number): {level: string} {
	return {
		level: label.toUpperCase(),
	};
}

/**
 * Custom timestamp formatter
 */
export function formatTimestamp(time: number): {time: string} {
	const date = new Date(time);
	return {
		time: date.toISOString(),
	};
}

/**
 * Format timestamp for development (human readable)
 */
export function formatTimestampDev(time: number): {time: string} {
	const date = new Date(time);
	return {
		time:
			date.toLocaleTimeString('en-US', {
				hour12: false,
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				timeZone: 'UTC',
			}) + ' Z',
	};
}

/**
 * Sanitize error objects for JSON serialization
 */
// biome-ignore lint/suspicious/noExplicitAny: Dynamic return type for serialized errors
export function serializeError(err: Error): Record<string, any> {
	if (err instanceof Error) {
		return {
			name: err.name,
			message: err.message,
			stack:
				process.env.NODE_ENV === 'production'
					? err.stack?.split('\n').slice(0, 3).join('\n') // Limit stack traces in production
					: err.stack,
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic error properties
			code: (err as any).code,
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic error properties
			statusCode: (err as any).statusCode,
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic error properties
			status: (err as any).status,
		};
	}
	return err;
}

/**
 * Format log entry for production JSON output
 */
export function formatProductionLog(log: LogEntry): LogEntry {
	const formatted: LogEntry = {
		level: log.level,
		time: log.time,
		pid: log.pid,
		hostname: log.hostname,
		msg: log.msg,
	};

	// Add correlation ID if present
	if (log.correlationId) {
		formatted.correlationId = log.correlationId;
	}

	// Add any additional properties, but handle special cases
	Object.keys(log).forEach(key => {
		if (
			['level', 'time', 'pid', 'hostname', 'msg', 'correlationId'].includes(key)
		) {
			return;
		}

		const value = log[key];

		// Handle Error objects
		if (value instanceof Error) {
			formatted[key] = serializeError(value);
		}
		// Handle circular references
		else if (typeof value === 'object' && value !== null) {
			try {
				// Quick check for circular references
				JSON.stringify(value);
				formatted[key] = value;
			} catch {
				formatted[key] = '[Circular Reference]';
			}
		} else {
			formatted[key] = value;
		}
	});

	return formatted;
}

/**
 * Format log entry for development pretty output
 */
export function formatDevelopmentLog(log: LogEntry): LogEntry {
	const formatted: LogEntry = {
		...formatProductionLog(log),
		// Add development-specific formatting
		prettyTime: formatTimestampDev(Date.now()).time,
	};

	return formatted;
}

/**
 * Create Pino formatters configuration
 */
export function createFormatters(isProduction: boolean = false) {
	return {
		level: formatLevel,
		log: isProduction ? formatProductionLog : formatDevelopmentLog,
		time: isProduction ? formatTimestamp : formatTimestampDev,
	};
}

/**
 * Message formatter for custom log messages
 */
export function formatMessage(
	template: string,
	// biome-ignore lint/suspicious/noExplicitAny: Dynamic bindings for template
	bindings: Record<string, any>,
	level: string,
): string {
	// Simple template replacement for {key} patterns
	return template.replace(/\{(\w+)\}/g, (match, key) => {
		if (key === 'level') return level.toUpperCase();
		if (key === 'levelLabel') return level;
		return bindings[key] || match;
	});
}

/**
 * Color mapping for different log levels (development only)
 */
export const levelColors: Record<string, string> = {
	fatal: '\x1b[41m', // Red background
	error: '\x1b[31m', // Red text
	warn: '\x1b[33m', // Yellow text
	info: '\x1b[36m', // Cyan text
	http: '\x1b[35m', // Magenta text
	debug: '\x1b[90m', // Gray text
	trace: '\x1b[37m', // White text
	reset: '\x1b[0m', // Reset
};

/**
 * Get color for log level
 */
export function getLevelColor(level: string): string {
	return levelColors[level.toLowerCase()] || levelColors.info;
}

/**
 * Create pretty print formatter for development
 */
export function createPrettyFormatter() {
	return {
		translateTime: 'SYS:standard',
		ignore: 'pid,hostname,time',
		messageFormat: '{levelLabel} - {msg}',
		customPrettifiers: {
			time: (timestamp: number) => {
				return new Date(timestamp).toLocaleTimeString();
			},
			level: (label: string) => {
				const color = getLevelColor(label);
				const reset = levelColors.reset;
				return `${color}${label.toUpperCase()}${reset}`;
			},
			hostname: () => {
				return process.env.NODE_ENV || 'development';
			},
		},
		colorize: true,
		levelFirst: true,
	};
}
