/**
 * Correlation ID management for tracking requests across components
 */

import {randomBytes} from 'crypto';
import type {CorrelationContext} from './types.js';

/**
 * Async local storage for correlation context (simple implementation)
 * In a real implementation, you might use AsyncLocalStorage from Node.js
 */
let currentContext: CorrelationContext | null = null;

/**
 * Generate a new correlation ID
 */
export function generateCorrelationId(): string {
	// Generate 16-byte random hex string (32 characters)
	return randomBytes(16).toString('hex');
}

/**
 * Generate a short correlation ID (8 characters) for display
 */
export function generateShortCorrelationId(): string {
	// Generate 4-byte random hex string (8 characters)
	return randomBytes(4).toString('hex');
}

/**
 * Create a new correlation context
 */
export function createCorrelationContext(
	id?: string,
	metadata?: Record<string, any>,
): CorrelationContext {
	return {
		id: id || generateCorrelationId(),
		metadata,
	};
}

/**
 * Get the current correlation context
 */
export function getCurrentCorrelationContext(): CorrelationContext | null {
	return currentContext;
}

/**
 * Set the current correlation context
 */
export function setCorrelationContext(context: CorrelationContext): void {
	currentContext = context;
}

/**
 * Clear the current correlation context
 */
export function clearCorrelationContext(): void {
	currentContext = null;
}

/**
 * Run a function with a specific correlation context
 */
export function withCorrelationContext<T>(
	context: CorrelationContext,
	fn: () => T,
): T {
	const previousContext = currentContext;
	currentContext = context;

	try {
		return fn();
	} finally {
		currentContext = previousContext;
	}
}

/**
 * Run a function with a new correlation context
 */
export function withNewCorrelationContext<T>(
	fn: (context: CorrelationContext) => T,
	correlationId?: string,
	metadata?: Record<string, any>,
): T {
	const context = createCorrelationContext(correlationId, metadata);
	return withCorrelationContext(context, () => fn(context));
}

/**
 * Get the correlation ID for the current context
 */
export function getCorrelationId(): string | null {
	return currentContext?.id || null;
}

/**
 * Check if correlation is enabled
 */
export function isCorrelationEnabled(): boolean {
	return process.env.CORRELATION_ENABLED !== 'false';
}

/**
 * Get correlation header for HTTP requests
 */
export function getCorrelationHeader():
	| {'X-Correlation-ID': string}
	| Record<string, never> {
	const correlationId = getCorrelationId();
	if (!correlationId || !isCorrelationEnabled()) {
		return {};
	}

	return {
		'X-Correlation-ID': correlationId,
	};
}

/**
 * Extract correlation ID from HTTP headers
 */
export function extractCorrelationId(
	headers: Record<string, string>,
): string | null {
	// Try various header names
	const possibleHeaders = [
		'x-correlation-id',
		'x-request-id',
		'correlation-id',
		'request-id',
	];

	for (const header of possibleHeaders) {
		const value = headers[header] || headers[header.toUpperCase()];
		if (value && typeof value === 'string') {
			return value;
		}
	}

	return null;
}

/**
 * Create a correlation context from HTTP headers
 */
export function createCorrelationFromHeaders(
	headers: Record<string, string>,
	metadata?: Record<string, any>,
): CorrelationContext | null {
	if (!isCorrelationEnabled()) {
		return null;
	}

	const parentId = extractCorrelationId(headers);
	return createCorrelationContext(parentId || undefined, metadata);
}

/**
 * Add correlation metadata
 */
export function addCorrelationMetadata(key: string, value: any): void {
	if (currentContext) {
		currentContext.metadata = {
			...currentContext.metadata,
			[key]: value,
		};
	}
}

/**
 * Get correlation metadata
 */
export function getCorrelationMetadata(key?: string): any {
	if (!currentContext || !currentContext.metadata) {
		return key ? undefined : {};
	}

	return key ? currentContext.metadata[key] : currentContext.metadata;
}

/**
 * Format correlation context for logging
 */
export function formatCorrelationForLog(): Record<string, string> {
	if (!currentContext || !isCorrelationEnabled()) {
		return {};
	}

	const result: Record<string, string> = {
		correlationId: currentContext.id,
	};

	if (currentContext.parentId) {
		result.parentCorrelationId = currentContext.parentId;
	}

	return result;
}

/**
 * Correlation middleware for Express-like frameworks
 */
export function correlationMiddleware() {
	return (req: any, res: any, next: any) => {
		// Extract or create correlation ID
		let correlationId = extractCorrelationId(req.headers);

		if (!correlationId) {
			correlationId = generateCorrelationId();
		}

		// Set correlation context
		const context = createCorrelationContext(undefined, {
			method: req.method,
			url: req.url,
			userAgent: req.headers['user-agent'],
		});

		setCorrelationContext(context);

		// Add correlation ID to response headers
		res.setHeader('X-Correlation-ID', correlationId);

		next();
	};
}

/**
 * Wrap an async function with correlation tracking
 */
export function withCorrelation<T extends (...args: any[]) => Promise<any>>(
	fn: T,
	getCorrelationIdFromArgs?: (...args: Parameters<T>) => string,
): T {
	return (async (...args: Parameters<T>) => {
		let context: CorrelationContext | null = null;

		// Try to get correlation ID from arguments if provided
		if (getCorrelationIdFromArgs) {
			const correlationId = getCorrelationIdFromArgs(...args);
			if (correlationId) {
				context = createCorrelationContext(correlationId);
			}
		}

		// If no context from args, try current context or create new
		if (!context) {
			const current = getCurrentCorrelationContext();
			if (current) {
				context = createCorrelationContext(current.id);
			} else if (isCorrelationEnabled()) {
				context = createCorrelationContext();
			}
		}

		// Set context and run function
		if (context) {
			return withCorrelationContext(context, async () => {
				return await fn(...args);
			});
		} else {
			return await fn(...args);
		}
	}) as T;
}
