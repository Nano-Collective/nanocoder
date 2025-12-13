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
export const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Correlation Context Monitoring Metrics
 * Tracks usage, performance, and potential issues for production monitoring
 */
const correlationMonitoring = {
	contextsCreated: 0,
	activeContexts: 0,
	errors: 0,
	lastError: null as string | null,
	lastErrorTime: 0,
	startTime: Date.now(),
};

/**
 * Legacy context has been removed in favor of AsyncLocalStorage-only approach
 * This eliminates race conditions in concurrent operations
 * All code should now use withCorrelationContext() or withNewCorrelationContext()
 */

/**
 * Get correlation context monitoring metrics
 * Provides insights into context usage, performance, and health
 */
export function getCorrelationMonitoring(): typeof correlationMonitoring {
	return {...correlationMonitoring};
}

/**
 * Log correlation context monitoring metrics
 * Useful for periodic logging of system health
 */
export function logCorrelationMonitoring(level: 'debug' | 'info' | 'warn' | 'error' = 'info'): void {
	const metrics = getCorrelationMonitoring();
	const uptime = Date.now() - metrics.startTime;
	const uptimeMinutes = Math.floor(uptime / (1000 * 60));
	
	const errorRate = metrics.contextsCreated > 0 
		? (metrics.errors / metrics.contextsCreated * 100).toFixed(2) + '%' 
		: '0%';
	
	const message = `
[Correlation Monitoring] 
- Uptime: ${uptimeMinutes} minutes
- Contexts Created: ${metrics.contextsCreated}
- Active Contexts: ${metrics.activeContexts}
- Errors: ${metrics.errors}
- Error Rate: ${errorRate}
- Last Error: ${metrics.lastError || 'None'}`;
	
	switch (level) {
		case 'debug':
			console.debug(message);
			break;
		case 'info':
			console.info(message);
			break;
		case 'warn':
			console.warn(message);
			break;
		case 'error':
			console.error(message);
			break;
	}
}

/**
 * Reset correlation context monitoring metrics
 * Useful for testing or periodic reporting
 */
export function resetCorrelationMonitoring(): void {
	correlationMonitoring.contextsCreated = 0;
	correlationMonitoring.activeContexts = 0;
	correlationMonitoring.errors = 0;
	correlationMonitoring.lastError = null;
	correlationMonitoring.lastErrorTime = 0;
	correlationMonitoring.startTime = Date.now();
}

/**
 * Perform health check on correlation context system
 * Verifies that the AsyncLocalStorage context system is functioning properly
 */
export function checkCorrelationHealth(): {healthy: boolean, message: string, metrics: typeof correlationMonitoring} {
	try {
		// Test basic context creation and retrieval
		const testContext: CorrelationContext = {
			id: 'health-check-' + generateShortCorrelationId(),
			metadata: {healthCheck: true, timestamp: Date.now()},
		};
		
		let contextWorking = false;
		withCorrelationContext(testContext, () => {
			const current = getCurrentCorrelationContext();
			contextWorking = current?.id === testContext.id;
		});
		
		if (!contextWorking) {
			return {
				healthy: false,
				message: 'Correlation context system failed basic functionality test',
				metrics: getCorrelationMonitoring(),
			};
		}
		
		// Check for excessive errors
		const errorRate = correlationMonitoring.contextsCreated > 0 
			? correlationMonitoring.errors / correlationMonitoring.contextsCreated 
			: 0;
		
		if (errorRate > 0.1) { // More than 10% error rate
			return {
				healthy: false,
				message: `High error rate detected: ${(errorRate * 100).toFixed(1)}%`,
				metrics: getCorrelationMonitoring(),
			};
		}
		
		return {
			healthy: true,
			message: 'Correlation context system is healthy',
			metrics: getCorrelationMonitoring(),
		};
	} catch (error) {
		return {
			healthy: false,
			message: `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
			metrics: getCorrelationMonitoring(),
		};
	}
}

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
 * Now uses AsyncLocalStorage exclusively - no legacy fallback
 */
export function getCurrentCorrelationContext(): CorrelationContext | null {
	const asyncContext = correlationStorage.getStore();
	return asyncContext || null;
}

/**
 * Set the current correlation context (runs function with context)
 * Note: AsyncLocalStorage doesn't support direct setting, use withCorrelationContext instead
 * @deprecated Use withCorrelationContext or withNewCorrelationContext
 */
export function setCorrelationContext(context: CorrelationContext): void {
	// This function is deprecated - AsyncLocalStorage requires running within a context
	console.warn(
		'⚠️  setCorrelationContext is DEPRECATED and will be removed in future versions.' +
		'\nUse withCorrelationContext() or withNewCorrelationContext() instead.' +
		'\nExample: withNewCorrelationContext(async (context) => { ... })'
	);
}

/**
 * Clear the current correlation context
 * Note: AsyncLocalStorage handles cleanup automatically
 * @deprecated Context is automatically cleared when async operation completes
 */
export function clearCorrelationContext(): void {
	// This function is deprecated - Context cleanup is automatic with AsyncLocalStorage
	console.warn(
		'⚠️  clearCorrelationContext is DEPRECATED. ' +
		'Context cleanup is automatic with AsyncLocalStorage.'
	);
}

/**
 * Run a function with a specific correlation context
 */
export function withCorrelationContext<T>(
	context: CorrelationContext,
	fn: () => T,
): T {
	try {
		if (process.env.NANOCODER_CORRELATION_DEBUG === 'true') {
			console.debug(`[Correlation] Context started: ${context.id}`);
		}
		
		correlationMonitoring.activeContexts++;
		const result = correlationStorage.run(context, fn);
		correlationMonitoring.activeContexts--;
		
		if (process.env.NANOCODER_CORRELATION_DEBUG === 'true') {
			console.debug(`[Correlation] Context completed: ${context.id}`);
		}
		
		return result;
	} catch (error) {
		correlationMonitoring.errors++;
		correlationMonitoring.lastError = error instanceof Error ? error.message : String(error);
		correlationMonitoring.lastErrorTime = Date.now();
		correlationMonitoring.activeContexts--;
		
		if (process.env.NANOCODER_CORRELATION_DEBUG === 'true') {
			console.error(`[Correlation] Context error: ${context.id}`, error);
		}
		
		throw error;
	}
}

/**
 * Run a function with a new correlation context
 */
export function withNewCorrelationContext<T>(
	fn: (context: CorrelationContext) => T,
	correlationId?: string,
	metadata?: Record<string, unknown>,
): T {
	const context = correlationId 
		? createCorrelationContextWithId(correlationId, metadata)
		: createCorrelationContext(undefined, metadata);
	
	correlationMonitoring.contextsCreated++;
	
	if (process.env.NANOCODER_CORRELATION_DEBUG === 'true') {
		console.debug(`[Correlation] New context created: ${context.id}`);
	}
	
	try {
		correlationMonitoring.activeContexts++;
		const result = correlationStorage.run(context, () => fn(context));
		correlationMonitoring.activeContexts--;
		
		if (process.env.NANOCODER_CORRELATION_DEBUG === 'true') {
			console.debug(`[Correlation] New context completed: ${context.id}`);
		}
		
		return result;
	} catch (error) {
		correlationMonitoring.errors++;
		correlationMonitoring.lastError = error instanceof Error ? error.message : String(error);
		correlationMonitoring.lastErrorTime = Date.now();
		correlationMonitoring.activeContexts--;
		
		if (process.env.NANOCODER_CORRELATION_DEBUG === 'true') {
			console.error(`[Correlation] New context error: ${context.id}`, error);
		}
		
		throw error;
	}
}

/**
 * Get the correlation ID for the current context
 */
export function getCorrelationId(): string | null {
	const asyncContext = correlationStorage.getStore();
	return asyncContext?.id || null;
}

/**
 * Check if correlation is enabled
 */
export function isCorrelationEnabled(): boolean {
	return process.env.NANOCODER_CORRELATION_ENABLED !== 'false';
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
 * @deprecated Use withNewCorrelationContext with metadata parameter
 */
export function addCorrelationMetadata(key: string, value: unknown): void {
	// This function is deprecated - use withNewCorrelationContext with metadata instead
	console.warn(
		'⚠️  addCorrelationMetadata is DEPRECATED. ' +
		'Use withNewCorrelationContext with metadata parameter instead.'
	);
}

/**
 * Get correlation metadata
 */
export function getCorrelationMetadata(key?: string): unknown {
	const asyncContext = correlationStorage.getStore();
	if (asyncContext?.metadata) {
		return key ? asyncContext.metadata[key] : asyncContext.metadata;
	}
	return key ? undefined : {};
}

/**
 * Format correlation context for logging
 */
export function formatCorrelationForLog(): Record<string, string> {
	const asyncContext = correlationStorage.getStore();
	
	if (asyncContext && isCorrelationEnabled()) {
		const result: Record<string, string> = {
			correlationId: asyncContext.id,
		};

		if (asyncContext.parentId) {
			result.parentCorrelationId = asyncContext.parentId;
		}

		return result;
	}
	
	return {};
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
