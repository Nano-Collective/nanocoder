/**
 * Correlation ID management for tracking requests across components
 */

import {AsyncLocalStorage} from 'async_hooks';
import {randomBytes} from 'crypto';
import type {CorrelationContext, CorrelationHttpRequest, CorrelationHttpResponse} from './types.js';

/**
 * Async local storage for correlation context
 * Provides thread-safe context storage across async operations
 */
const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Legacy global context for backward compatibility with deprecated functions
 * Note: This approach has race conditions in concurrent operations
 */
let legacyContext: CorrelationContext | null = null;

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
 * Create a new correlation context with specific ID
 */
export function createCorrelationContextWithId(
	id: string,
	metadata?: Record<string, unknown>,
): CorrelationContext {
	return {
		id,
		metadata,
	};
}

/**
 * Create a new correlation context with optional parent ID
 */
export function createCorrelationContext(
	parentId?: string,
	metadata?: Record<string, unknown>,
): CorrelationContext {
	return {
		id: generateCorrelationId(),
		parentId,
		metadata,
	};
}

/**
 * Get the current correlation context
 */
export function getCurrentCorrelationContext(): CorrelationContext | null {
	return correlationStorage.getStore() || legacyContext || null;
}

/**
 * Set the current correlation context (runs function with context)
 * Note: AsyncLocalStorage doesn't support direct setting, use withCorrelationContext instead
 * @deprecated Use withCorrelationContext or withNewCorrelationContext
 */
export function setCorrelationContext(context: CorrelationContext): void {
	// This is kept for backward compatibility but should not be used
	// AsyncLocalStorage requires running within a context, not direct assignment
	console.warn('setCorrelationContext is deprecated. Use withCorrelationContext instead.');
	legacyContext = context;
}

/**
 * Clear the current correlation context
 * Note: AsyncLocalStorage handles cleanup automatically
 * @deprecated Context is automatically cleared when async operation completes
 */
export function clearCorrelationContext(): void {
	// This is kept for backward compatibility but does nothing with AsyncLocalStorage
	// Context cleanup is handled automatically by AsyncLocalStorage
	legacyContext = null;
}

/**
 * Run a function with a specific correlation context
 */
export function withCorrelationContext<T>(
	context: CorrelationContext,
	fn: () => T,
): T {
	return correlationStorage.run(context, fn);
}

/**
 * Run a function with a new correlation context
 */
export function withNewCorrelationContext<T>(
	fn: (context: CorrelationContext) => T,
	parentId?: string,
	metadata?: Record<string, unknown>,
): T {
	const context = createCorrelationContext(parentId, metadata);
	return correlationStorage.run(context, () => fn(context));
}

/**
 * Get the correlation ID for the current context
 */
export function getCorrelationId(): string | null {
	const currentContext = correlationStorage.getStore() || legacyContext;
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
		'x-trace-id',
		'x-span-id',
		'correlation-id',
		'request-id',
		'trace-id',
		'span-id',
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
	metadata?: Record<string, unknown>,
): CorrelationContext | null {
	if (!isCorrelationEnabled()) {
		return null;
	}

	const correlationId = extractCorrelationId(headers);
	if (correlationId) {
		return createCorrelationContextWithId(correlationId, metadata);
	}

	return createCorrelationContext(undefined, metadata);
}

/**
 * Add correlation metadata
 * Note: Creates a new context with updated metadata since AsyncLocalStorage is immutable
 */
export function addCorrelationMetadata(key: string, value: unknown): void {
	const currentContext = correlationStorage.getStore();
	if (currentContext) {
		// Note: We cannot directly update AsyncLocalStorage
		// This function is deprecated - use withNewCorrelationContext with metadata instead
		console.warn('addCorrelationMetadata is deprecated. Use withNewCorrelationContext with metadata parameter.');
		return;
	}

	// For backward compatibility with legacy context
	if (legacyContext) {
		legacyContext = {
			...legacyContext,
			metadata: {
				...legacyContext.metadata,
				[key]: value,
			},
		};
	}
}

/**
 * Get correlation metadata
 */
export function getCorrelationMetadata(key?: string): unknown {
	const currentContext = correlationStorage.getStore() || legacyContext;
	if (!currentContext || !currentContext.metadata) {
		return key ? undefined : {};
	}

	return key ? currentContext.metadata[key] : currentContext.metadata;
}

/**
 * Format correlation context for logging
 */
export function formatCorrelationForLog(): Record<string, string> {
	const currentContext = correlationStorage.getStore() || legacyContext;
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
	return (req: CorrelationHttpRequest, res: CorrelationHttpResponse, next: () => void) => {
		// Extract or create correlation ID
		let correlationId = extractCorrelationId(req.headers || {});

		if (!correlationId) {
			correlationId = generateCorrelationId();
		}

		// Create correlation context with the extracted or generated ID
		const context = createCorrelationContextWithId(correlationId, {
			method: req.method,
			url: req.url,
			userAgent: req.headers?.['user-agent'],
		});

		// Run the request handler within the correlation context
		return correlationStorage.run(context, () => {
			// Add correlation ID to response headers
			if (res.setHeader) {
				res.setHeader('X-Correlation-ID', correlationId);
			}

			next();
		});
	};
}

/**
 * Wrap an async function with correlation tracking
 */
export function withCorrelation<T extends (...args: unknown[]) => Promise<unknown>>(
	fn: T,
	getCorrelationIdFromArgs?: (...args: Parameters<T>) => string,
): T {
	return (async (...args: Parameters<T>) => {
		let context: CorrelationContext | null = null;

		// Try to get correlation ID from arguments if provided
		if (getCorrelationIdFromArgs) {
			const correlationId = getCorrelationIdFromArgs(...args);
			if (correlationId) {
				context = createCorrelationContextWithId(correlationId);
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

		// Run function within correlation context
		if (context) {
			return correlationStorage.run(context, async () => {
				return await fn(...args);
			});
		} else {
			return await fn(...args);
		}
	}) as T;
}
