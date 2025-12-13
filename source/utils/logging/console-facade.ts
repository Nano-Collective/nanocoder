/**
 * Console API facade for backward compatibility
 * Provides drop-in replacement for console methods that routes through structured logging
 *
 * This allows gradual migration from console.log to structured logging
 * without breaking existing code patterns
 */

import {
	generateCorrelationId,
	withNewCorrelationContext,
	getLogger,
} from '@/utils/logging';
import {createErrorInfo} from '@/utils/error-formatter';
import type {ConsoleArguments, ConsoleLogData} from './types.js';

// Get logger instance directly to avoid circular dependencies
const logger = getLogger();

/**
 * Create a console method with specific logging level and special handling
 * This factory reduces code duplication across different console methods
 */
function createConsoleMethod(
	level: 'info' | 'error' | 'warn' | 'debug',
	options?: {
		specialErrorHandling?: boolean; // For error method with Error objects
		isInfoMethod?: boolean; // For info method that routes to logger.info
	}
) {
	const {specialErrorHandling = false, isInfoMethod = false} = options || {};

	return (...args: ConsoleArguments) => {
		const _correlationId = generateCorrelationId();

		withNewCorrelationContext(context => {
			if (args.length === 0) {
				logger[level](`Empty console.${level} call`, {
					correlationId: context.id,
					source: 'console-facade',
				});
				return;
			}

			// Special handling for Error objects in console.error
			if (specialErrorHandling && args.length === 1 && args[0] instanceof Error) {
				const errorInfo = createErrorInfo(args[0], undefined, _correlationId);
				logger.error('Error logged via console.error', {
					errorInfo,
					correlationId: context.id,
					source: 'console-facade',
				});
				return;
			}

			// Handle single argument case
			if (args.length === 1) {
				const arg = args[0];
				if (typeof arg === 'string') {
					logger[level](arg, {
						correlationId: context.id,
						source: 'console-facade',
					});
				} else if (typeof arg === 'object' && arg !== null) {
					const message = `${level === 'error' ? 'Error' : 'Object'} logged via console.${level}`;
					logger[level](message, {
						object: arg,
						correlationId: context.id,
						source: 'console-facade',
					});
				} else {
					logger[level](String(arg), {
						correlationId: context.id,
						source: 'console-facade',
					});
				}
				return;
			}

			// Multiple arguments - join strings and log objects separately
			const strings = args.filter(arg => typeof arg === 'string');
			const objects = args.filter(
				arg => typeof arg === 'object' && arg !== null,
			);
			const primitives = args.filter(
				arg => typeof arg !== 'string' && typeof arg !== 'object',
			);

			let message = strings.join(' ');
			if (primitives.length > 0) {
				message += ' ' + primitives.map(String).join(' ');
			}

			const logData: ConsoleLogData = {
				correlationId: context.id,
				source: 'console-facade',
				argumentCount: args.length,
				stringArgs: strings.length,
				objectArgs: objects.length,
				primitiveArgs: primitives.length,
			};

			if (objects.length > 0) {
				logData.objects = objects;
			}

			// Check for error-like objects that aren't Error instances (only for error level)
			if (level === 'error') {
				const errorLikeObjects = objects.filter(
					obj =>
						obj &&
						typeof obj === 'object' &&
						('message' in obj || 'error' in obj || 'err' in obj),
				);

				if (errorLikeObjects.length > 0) {
					logData.errorLikeObjects = errorLikeObjects;
				}
			}

			// Use appropriate logger level (info for both log and info methods)
			const loggerLevel = isInfoMethod ? 'info' : level;
			logger[loggerLevel](message || `console.${level} called`, logData);
		});
	};
}

/**
 * Console replacement that routes to structured logging
 * Maintains the same API as global console but adds structured logging benefits
 */
export const StructuredConsole = {
	/**
	 * Replacement for console.log - routes to logger.info
	 * Accepts any number of arguments and formats them appropriately
	 */
	log: createConsoleMethod('info', {isInfoMethod: true}),

	/**
	 * Replacement for console.error - routes to logger.error with error analysis
	 */
	error: createConsoleMethod('error', {specialErrorHandling: true}),

	/**
	 * Replacement for console.warn - routes to logger.warn
	 */
	warn: createConsoleMethod('warn'),

	/**
	 * Replacement for console.info - routes to logger.info
	 */
	info: createConsoleMethod('info', {isInfoMethod: true}),

	/**
	 * Replacement for console.debug - routes to logger.debug
	 */
	debug: createConsoleMethod('debug'),
};

/**
 * Global console replacement hook
 * Can be used to temporarily replace global console for testing or specific modules
 */
export class ConsoleInterceptor {
	private originalConsole: typeof console;
	private isActive: boolean = false;

	constructor() {
		this.originalConsole = {...console};
	}

	/**
	 * Replace global console with structured logging version
	 */
	activate(): void {
		if (this.isActive) {
			return;
		}

		console.log = StructuredConsole.log;
		console.error = StructuredConsole.error;
		console.warn = StructuredConsole.warn;
		console.info = StructuredConsole.info;
		console.debug = StructuredConsole.debug;

		this.isActive = true;
	}

	/**
	 * Restore original global console
	 */

	deactivate = (): void => {
		if (!this.isActive) {
			return;
		}

		// eslint-disable-next-line @typescript-eslint/unbound-method
		console.log = this.originalConsole.log;
		// eslint-disable-next-line @typescript-eslint/unbound-method
		console.error = this.originalConsole.error;
		// eslint-disable-next-line @typescript-eslint/unbound-method
		console.warn = this.originalConsole.warn;
		// eslint-disable-next-line @typescript-eslint/unbound-method
		console.info = this.originalConsole.info;
		// eslint-disable-next-line @typescript-eslint/unbound-method
		console.debug = this.originalConsole.debug;

		this.isActive = false;
	};

	/**
	 * Check if interceptor is active
	 */
	isInterceptorActive(): boolean {
		return this.isActive;
	}

	/**
	 * Execute a function with console temporarily replaced
	 */
	withStructuredConsole<T>(fn: () => T): T {
		this.activate();
		try {
			return fn();
		} finally {
			this.deactivate();
		}
	}
}

/**
 * Global console interceptor instance
 */
export const globalConsoleInterceptor = new ConsoleInterceptor();

/**
 * Decorator to automatically route console calls in a function to structured logging
 */
export function useStructuredConsole(
	target: unknown,
	propertyName: string,
	descriptor: PropertyDescriptor,
): PropertyDescriptor | void {
	const originalMethod = descriptor.value as ((this: unknown, ...args: ConsoleArguments) => unknown) | undefined;

	if (typeof originalMethod === 'function') {
		descriptor.value = function (this: unknown, ...args: ConsoleArguments): unknown {
			return globalConsoleInterceptor.withStructuredConsole(() => {
				return Reflect.apply(originalMethod, this, args);
			});
		};
	}

	return descriptor;
}

/**
 * Convenience function to create a module-scoped console
 * Useful for gradual migration of individual modules
 */
export function createModuleConsole(moduleName: string) {
	return {
		log: (...args: ConsoleArguments) => {
			logger.info(
				`[${moduleName}] ${args.filter(a => typeof a === 'string').join(' ')}`,
				{
					moduleName,
					allArgs: args,
					correlationId: generateCorrelationId(),
					source: 'module-console',
				} as ConsoleLogData,
			);
		},
		error: (...args: ConsoleArguments) => {
			logger.error(
				`[${moduleName}] ${args.filter(a => typeof a === 'string').join(' ')}`,
				{
					moduleName,
					allArgs: args,
					correlationId: generateCorrelationId(),
					source: 'module-console',
				} as ConsoleLogData,
			);
		},
		warn: (...args: ConsoleArguments) => {
			logger.warn(
				`[${moduleName}] ${args.filter(a => typeof a === 'string').join(' ')}`,
				{
					moduleName,
					allArgs: args,
					correlationId: generateCorrelationId(),
					source: 'module-console',
				} as ConsoleLogData,
			);
		},
		info: (...args: ConsoleArguments) => {
			logger.info(
				`[${moduleName}] ${args.filter(a => typeof a === 'string').join(' ')}`,
				{
					moduleName,
					allArgs: args,
					correlationId: generateCorrelationId(),
					source: 'module-console',
				} as ConsoleLogData,
			);
		},
		debug: (...args: ConsoleArguments) => {
			logger.debug(
				`[${moduleName}] ${args.filter(a => typeof a === 'string').join(' ')}`,
				{
					moduleName,
					allArgs: args,
					correlationId: generateCorrelationId(),
					source: 'module-console',
				} as ConsoleLogData,
			);
		},
	};
}

/**
 * Migration helper to identify console usage patterns
 * Returns statistics about console method usage in the current execution
 */
export class ConsoleUsageTracker {
	private usage: Map<string, number> = new Map();

	constructor() {
		// Track console method calls by wrapping them
		const methods = ['log', 'error', 'warn', 'info', 'debug'] as const;

		methods.forEach(method => {
			const original = console[method];
			this.usage.set(method, 0);

			console[method] = (...args: ConsoleArguments) => {
				this.usage.set(method, (this.usage.get(method) || 0) + 1);
				return original.apply(console, args);
			};
		});
	}

	getUsageStats(): Record<string, number> {
		return Object.fromEntries(this.usage);
	}

	reportUsage(): void {
		const stats = this.getUsageStats();
		const total = Object.values(stats).reduce((sum, count) => sum + count, 0);

		logger.info('Console usage statistics', {
			total,
			methodBreakdown: stats,
			source: 'console-usage-tracker',
		});
	}

	restore(): void {
		// This would need to restore the original console methods
		// Implementation depends on how the original methods are stored
		logger.info('Console usage tracker deactivated', {
			source: 'console-usage-tracker',
		});
	}
}

// Export for easy access
export default StructuredConsole;
