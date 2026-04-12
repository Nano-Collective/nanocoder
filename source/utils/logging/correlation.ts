/**
 * Correlation ID management for tracking requests across async boundaries.
 *
 * Only the three functions consumers actually use are exported:
 * `generateCorrelationId`, `getCorrelationId`, and `withNewCorrelationContext`.
 * Everything else (Express-style middleware, HTTP header helpers, monitoring
 * stats, health checks) has been removed — none of it had a runtime caller.
 */

import {AsyncLocalStorage} from 'node:async_hooks';
import {randomBytes} from 'node:crypto';
import type {CorrelationContext} from './types.js';

const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Generate a new correlation ID (32-character hex string).
 */
export function generateCorrelationId(): string {
	return randomBytes(16).toString('hex');
}

/**
 * Get the correlation ID for the current async context, or `null` if there
 * is no active context.
 */
export function getCorrelationId(): string | null {
	const asyncContext = correlationStorage.getStore();
	return asyncContext?.id ?? null;
}

/**
 * Run a function inside a new correlation context. If `correlationId` is
 * supplied, the context adopts that ID; otherwise a fresh one is generated.
 * The context is automatically torn down when `fn` returns or throws.
 */
export function withNewCorrelationContext<T>(
	fn: (context: CorrelationContext) => T,
	correlationId?: string,
	metadata?: Record<string, unknown>,
): T {
	const context: CorrelationContext = {
		id: correlationId ?? generateCorrelationId(),
		metadata,
	};
	return correlationStorage.run(context, () => fn(context));
}
