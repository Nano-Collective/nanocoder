/**
 * Console API facade for backward compatibility
 * Provides drop-in replacement for console methods that routes through structured logging
 *
 * This allows gradual migration from console.log to structured logging
 * without breaking existing code patterns
 */

import {
	generateCorrelationId,
	getCorrelationId,
	withNewCorrelationContext,
	getLogger,
} from '@/utils/logging';
import {createErrorInfo} from '@/utils/error-formatter';

// Get logger instance directly to avoid circular dependencies
const logger = getLogger();

/**
 * Console replacement that routes to structured logging
 * Maintains the same API as global console but adds structured logging benefits
 */
export const StructuredConsole = {
	/**
	 * Replacement for console.log - routes to logger.info
	 * Accepts any number of arguments and formats them appropriately
	 */
	log: (...args: any[]) => {
		const correlationId = generateCorrelationId();

		withNewCorrelationContext((context) => {
			if (args.length === 0) {
				logger.info('Empty console.log call', {
					correlationId: context.id,
					source: 'console-facade',
				});
				return;
			}

			if (args.length === 1) {
				const arg = args[0];
				if (typeof arg === 'string') {
					logger.info(arg, {correlationId: context.id, source: 'console-facade'});
				} else if (typeof arg === 'object' && arg !== null) {
					logger.info('Object logged via console.log', {
						object: arg,
						correlationId: context.id,
						source: 'console-facade',
					});
				} else {
					logger.info(String(arg), {correlationId: context.id, source: 'console-facade'});
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

			const logData: Record<string, any> = {
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

			logger.info(message || 'console.log called', logData);
		});
	},

	/**
	 * Replacement for console.error - routes to logger.error with error analysis
	 */
	error: (...args: any[]) => {
		const correlationId = generateCorrelationId();

		withNewCorrelationContext((context) => {
			if (args.length === 0) {
				logger.error('Empty console.error call', {
					correlationId: context.id,
					source: 'console-facade',
				});
				return;
			}

			// Special handling for Error objects
			if (args.length === 1 && args[0] instanceof Error) {
				const errorInfo = createErrorInfo(args[0], undefined, correlationId);
				logger.error('Error logged via console.error', {
					errorInfo,
					correlationId: context.id,
					source: 'console-facade',
				});
				return;
			}

			// Multiple arguments or non-Error objects
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

			const logData: Record<string, any> = {
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

			// Check for error-like objects that aren't Error instances
			const errorLikeObjects = objects.filter(
				obj =>
					obj &&
					typeof obj === 'object' &&
					('message' in obj || 'error' in obj || 'err' in obj),
			);

			if (errorLikeObjects.length > 0) {
				logData.errorLikeObjects = errorLikeObjects;
			}

			logger.error(message || 'console.error called', logData);
		});
	},

	/**
	 * Replacement for console.warn - routes to logger.warn
	 */
	warn: (...args: any[]) => {
		const correlationId = generateCorrelationId();

		withNewCorrelationContext((context) => {
			if (args.length === 0) {
				logger.warn('Empty console.warn call', {
					correlationId: context.id,
					source: 'console-facade',
				});
				return;
			}

			if (args.length === 1) {
				const arg = args[0];
				if (typeof arg === 'string') {
					logger.warn(arg, {correlationId: context.id, source: 'console-facade'});
				} else if (typeof arg === 'object' && arg !== null) {
					logger.warn('Object logged via console.warn', {
						object: arg,
						correlationId: context.id,
						source: 'console-facade',
					});
				} else {
					logger.warn(String(arg), {correlationId: context.id, source: 'console-facade'});
				}
				return;
			}

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

			const logData: Record<string, any> = {
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

			logger.warn(message || 'console.warn called', logData);
		});
	},

	/**
	 * Replacement for console.info - routes to logger.info
	 */
	info: (...args: any[]) => {
		const correlationId = generateCorrelationId();

		withNewCorrelationContext((context) => {
			if (args.length === 0) {
				logger.info('Empty console.info call', {
					correlationId: context.id,
					source: 'console-facade',
				});
				return;
			}

			if (args.length === 1) {
				const arg = args[0];
				if (typeof arg === 'string') {
					logger.info(arg, {correlationId: context.id, source: 'console-facade'});
				} else if (typeof arg === 'object' && arg !== null) {
					logger.info('Object logged via console.info', {
						object: arg,
						correlationId: context.id,
						source: 'console-facade',
					});
				} else {
					logger.info(String(arg), {correlationId: context.id, source: 'console-facade'});
				}
				return;
			}

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

			const logData: Record<string, any> = {
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

			logger.info(message || 'console.info called', logData);
		});
	},

	/**
	 * Replacement for console.debug - routes to logger.debug
	 */
	debug: (...args: any[]) => {
		const correlationId = generateCorrelationId();

		withNewCorrelationContext((context) => {
			if (args.length === 0) {
				logger.debug('Empty console.debug call', {
					correlationId: context.id,
					source: 'console-facade',
				});
				return;
			}

			if (args.length === 1) {
				const arg = args[0];
				if (typeof arg === 'string') {
					logger.debug(arg, {correlationId: context.id, source: 'console-facade'});
				} else if (typeof arg === 'object' && arg !== null) {
					logger.debug('Object logged via console.debug', {
						object: arg,
						correlationId: context.id,
						source: 'console-facade',
					});
				} else {
					logger.debug(String(arg), {correlationId: context.id, source: 'console-facade'});
				}
				return;
			}

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

			const logData: Record<string, any> = {
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

			logger.debug(message || 'console.debug called', logData);
		});
	},
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
	deactivate(): void {
		if (!this.isActive) {
			return;
		}

		console.log = this.originalConsole.log;
		console.error = this.originalConsole.error;
		console.warn = this.originalConsole.warn;
		console.info = this.originalConsole.info;
		console.debug = this.originalConsole.debug;

		this.isActive = false;
	}

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
	target: any,
	propertyName: string,
	descriptor: PropertyDescriptor,
) {
	const originalMethod = descriptor.value;

	descriptor.value = function (...args: any[]) {
		return globalConsoleInterceptor.withStructuredConsole(() => {
			return originalMethod.apply(this, args);
		});
	};

	return descriptor;
}

/**
 * Convenience function to create a module-scoped console
 * Useful for gradual migration of individual modules
 */
export function createModuleConsole(moduleName: string) {
	return {
		log: (...args: any[]) => {
			logger.info(
				`[${moduleName}] ${args.filter(a => typeof a === 'string').join(' ')}`,
				{
					moduleName,
					allArgs: args,
					correlationId: generateCorrelationId(),
					source: 'module-console',
				},
			);
		},
		error: (...args: any[]) => {
			logger.error(
				`[${moduleName}] ${args.filter(a => typeof a === 'string').join(' ')}`,
				{
					moduleName,
					allArgs: args,
					correlationId: generateCorrelationId(),
					source: 'module-console',
				},
			);
		},
		warn: (...args: any[]) => {
			logger.warn(
				`[${moduleName}] ${args.filter(a => typeof a === 'string').join(' ')}`,
				{
					moduleName,
					allArgs: args,
					correlationId: generateCorrelationId(),
					source: 'module-console',
				},
			);
		},
		info: (...args: any[]) => {
			logger.info(
				`[${moduleName}] ${args.filter(a => typeof a === 'string').join(' ')}`,
				{
					moduleName,
					allArgs: args,
					correlationId: generateCorrelationId(),
					source: 'module-console',
				},
			);
		},
		debug: (...args: any[]) => {
			logger.debug(
				`[${moduleName}] ${args.filter(a => typeof a === 'string').join(' ')}`,
				{
					moduleName,
					allArgs: args,
					correlationId: generateCorrelationId(),
					source: 'module-console',
				},
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

			console[method] = (...args: any[]) => {
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
