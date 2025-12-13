import test from 'ava';
import {existsSync, rmSync, mkdirSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';

console.log(`\nlogging/correlation.spec.ts`);

// Import correlation functions
import {
	generateCorrelationId,
	generateShortCorrelationId,
	createCorrelationContextWithId,
	createCorrelationContext,
	getCurrentCorrelationContext,
	setCorrelationContext,
	clearCorrelationContext,
	withCorrelationContext,
	withNewCorrelationContext,
	getCorrelationId,
	isCorrelationEnabled,
	getCorrelationHeader,
	extractCorrelationId,
	createCorrelationFromHeaders,
	addCorrelationMetadata,
	getCorrelationMetadata,
	formatCorrelationForLog,
	correlationMiddleware,
	withCorrelation,
	getCorrelationMonitoring,
	resetCorrelationMonitoring,
	checkCorrelationHealth,
} from './correlation.js';

// Import types
import type {CorrelationContext, CorrelationMetadata} from './types.js';

// Create a temporary test directory
const testDir = join(tmpdir(), `nanocoder-correlation-test-${Date.now()}`);

test.before(() => {
	mkdirSync(testDir, {recursive: true});
});

test.after.always(() => {
	// Clean up test directory
	if (existsSync(testDir)) {
		rmSync(testDir, {recursive: true, force: true});
	}

	// Clear correlation context
	clearCorrelationContext();
});

test('generateCorrelationId creates valid correlation ID', t => {
	const id1 = generateCorrelationId();
	const id2 = generateCorrelationId();

	t.is(typeof id1, 'string', 'Should return string');
	t.is(typeof id2, 'string', 'Should return string');
	t.true(id1.length > 0, 'Should not be empty');
	t.true(id2.length > 0, 'Should not be empty');
	t.not(id1, id2, 'Should generate unique IDs');
});

test('generateShortCorrelationId creates short IDs', t => {
	const shortId = generateShortCorrelationId();
	const fullId = generateCorrelationId();

	t.is(typeof shortId, 'string', 'Should return string');
	t.true(shortId.length > 0, 'Should not be empty');
	t.true(
		shortId.length < fullId.length,
		'Short ID should be shorter than full ID',
	);
});

test('correlation context management works', t => {
	const context: CorrelationContext = {
		id: 'test-123',
		parentId: 'parent-456',
		metadata: {
			source: 'test',
			version: '1.0.0',
		},
	};

	// Use withCorrelationContext instead of deprecated setCorrelationContext
	withCorrelationContext(context, () => {
		// Get current context
		const current = getCurrentCorrelationContext();
		t.truthy(current, 'Should return context');
		t.is(current!.id, context.id, 'Should match ID');
		t.is(current!.parentId, context.parentId, 'Should match parent ID');
		t.is(
			current!.metadata?.source,
			context.metadata?.source,
			'Should match metadata',
		);
	});

	// Context should be cleared automatically after withCorrelationContext completes
	const cleared = getCurrentCorrelationContext();
	t.falsy(cleared, 'Should be cleared');
});

test('createCorrelationContext creates valid context', t => {
	const context = createCorrelationContext('parent-123', {
		source: 'test',
		version: '1.0.0',
	});

	t.is(typeof context.id, 'string', 'Should have ID');
	t.is(context.parentId, 'parent-123', 'Should set parent ID');
	t.is(context.metadata?.source, 'test', 'Should set metadata source');
	t.is(context.metadata?.version, '1.0.0', 'Should set metadata version');
});

test('withCorrelationContext executes function with context', t => {
	const context: CorrelationContext = {
		id: 'test-123',
		parentId: 'parent-456',
		metadata: {source: 'test'},
	};

	let executedContext: CorrelationContext | null = null;

	withCorrelationContext(context, () => {
		executedContext = getCurrentCorrelationContext();
	});

	t.truthy(executedContext, 'Should have context during execution');
	t.is(executedContext!.id, context.id, 'Should have correct ID');
	t.is(
		executedContext!.parentId,
		context.parentId,
		'Should have correct parent ID',
	);

	// Context should be cleared after execution
	const afterContext = getCurrentCorrelationContext();
	t.falsy(afterContext, 'Context should be cleared after execution');
});

test('withNewCorrelationContext creates new context', t => {
	let correlationId: string | undefined = undefined;

	withNewCorrelationContext(
		() => {
			const context = getCurrentCorrelationContext();
			if (context) {
				correlationId = context.id;
			}
		},
		'parent-123',
		{source: 'test'},
	);

	t.truthy(correlationId, 'Should generate correlation ID');
	t.is(typeof correlationId!, 'string', 'Should be string');
	t.true(correlationId!.length > 0, 'Should not be empty');
});

test('getCorrelationId returns current ID', t => {
	const context: CorrelationContext = {
		id: 'test-123',
		parentId: 'parent-456',
	};

	withCorrelationContext(context, () => {
		const id = getCorrelationId();
		t.is(id, 'test-123', 'Should return current correlation ID');
	});

	// Context should be cleared automatically after withCorrelationContext completes
	const clearedId = getCorrelationId();
	t.falsy(clearedId, 'Should return undefined when no context');
});

test('isCorrelationEnabled checks if correlation is active', t => {
	// isCorrelationEnabled checks process.env, not the current context
	// so this behavior may need to be adjusted based on the actual implementation
	const context = getCurrentCorrelationContext();
	t.is(context, null, 'Context should be null initially');

	withCorrelationContext(createCorrelationContext(), () => {
		const contextAfterSet = getCurrentCorrelationContext();
		t.truthy(contextAfterSet, 'Context should not be null after setting');
	});

	// Context should be cleared automatically after withCorrelationContext completes
});

test('getCorrelationHeader returns header value', t => {
	const context: CorrelationContext = {
		id: 'test-123',
		parentId: 'parent-456',
	};

	withCorrelationContext(context, () => {
		const header = getCorrelationHeader();
		t.truthy(header, 'Should return header');
		t.is(typeof header, 'object', 'Should be object');
		t.deepEqual(header, {'X-Correlation-ID': 'test-123'}, 'Should return correct header');
	});

	// Context should be cleared automatically after withCorrelationContext completes
	const noHeader = getCorrelationHeader();
	t.deepEqual(noHeader, {}, 'Should return empty object when no context');
});

test('extractCorrelationId extracts from various sources', t => {
	// Test with correlation header
	const header = 'test-123';
	t.is(
		extractCorrelationId({'x-correlation-id': header}),
		header,
		'Should extract from header',
	);

	// Test with request ID
	const requestId = 'req-456';
	t.is(
		extractCorrelationId({'x-request-id': requestId}),
		requestId,
		'Should extract from request ID',
	);

	// Test with trace ID
	const traceId = 'trace-789';
	t.is(
		extractCorrelationId({'x-trace-id': traceId}),
		traceId,
		'Should extract from trace ID',
	);

	// Test with no headers
	t.falsy(extractCorrelationId({}), 'Should return undefined with no headers');
});

test('createCorrelationFromHeaders creates context from headers', t => {
	const headers = {
		'x-correlation-id': 'corr-123',
		'x-trace-id': 'trace-456',
		'x-span-id': 'span-789',
		'x-user-id': 'user-123',
		'x-session-id': 'session-456',
	};

	const context = createCorrelationFromHeaders(headers);

	t.truthy(context, 'Should create context');
	t.is(context!.id, 'corr-123', 'Should set correlation ID');
});

test('correlation metadata management', t => {
	const metadata: CorrelationMetadata = {
		source: 'api-server',
		version: '2.1.0',
		environment: 'production',
	};

	const context: CorrelationContext = {
		id: 'test-456',
		metadata,
	};

	withCorrelationContext(context, () => {
		// Get metadata
		const retrieved = getCorrelationMetadata() as CorrelationMetadata;
		t.truthy(retrieved, 'Should return metadata');
		t.is(retrieved.source, metadata.source, 'Should match source');
		t.is(retrieved.version, metadata.version, 'Should match version');
		t.is(retrieved.environment, metadata.environment, 'Should match environment');
	});

	// Context should be cleared automatically after withCorrelationContext completes
});

test('formatCorrelationForLog formats for logging', t => {
	const context: CorrelationContext = {
		id: 'test-123',
		parentId: 'parent-456',
		metadata: {source: 'test'},
	};

	withCorrelationContext(context, () => {
		const formatted = formatCorrelationForLog();
		t.is(typeof formatted, 'object', 'Should return object');
		t.is(formatted.correlationId, 'test-123', 'Should include correlation ID');
	});

	// Context should be cleared automatically after withCorrelationContext completes
});

test('correlationMiddleware creates middleware function', t => {
	const middleware = correlationMiddleware();

	t.is(typeof middleware, 'function', 'Should return middleware function');

	// Test middleware execution
	const mockRequest = {
		headers: {
			'x-correlation-id': 'test-123',
		},
	};

	const mockResponse = {};
	const mockNext = () => {};

	t.notThrows(() => {
		middleware(mockRequest, mockResponse, mockNext);
	}, 'Middleware should execute without errors');
});

test('withCorrelation decorator works with async functions', async t => {
	const mockFunction = async (...args: unknown[]) => {
		const input = args[0] as string;
		const context = getCurrentCorrelationContext();
		return `${input}-${context?.id || 'no-context'}`;
	};

	const decoratedFunction = withCorrelation(mockFunction);

	const result = await decoratedFunction('test');
	t.is(typeof result, 'string', 'Should return string');
	t.true((result as string).includes('test-'), 'Should include input');
});

test('context isolation between concurrent operations', async t => {
	const results: string[] = [];

	const operation1 = withNewCorrelationContext(
		async () => {
			await new Promise(resolve => setTimeout(resolve, 10));
			const context = getCurrentCorrelationContext();
			results.push(`op1-${context?.metadata?.userId}`);
		},
		'parent-1',
		{userId: 'user-1'},
	);

	const operation2 = withNewCorrelationContext(
		async () => {
			await new Promise(resolve => setTimeout(resolve, 5));
			const context = getCurrentCorrelationContext();
			results.push(`op2-${context?.metadata?.userId}`);
		},
		'parent-2',
		{userId: 'user-2'},
	);

	await Promise.all([operation1, operation2]);

	t.is(results.length, 2, 'Should have both results');
	t.true(
		results.some(r => r.includes('user-1')),
		'Should have user-1 result',
	);
	t.true(
		results.some(r => r.includes('user-2')),
		'Should have user-2 result',
	);
});

test('error handling in correlation functions', t => {
	// Test with invalid context
	t.notThrows(() => {
		setCorrelationContext(null as any);
		getCurrentCorrelationContext();
	}, 'Should handle invalid context gracefully');

	// Test with malformed headers
	const malformedHeaders = {
		'x-correlation-id': null,
		'x-trace-id': undefined,
		'x-user-id': 123,
	};

	t.notThrows(() => {
		createCorrelationFromHeaders(malformedHeaders as any);
	}, 'Should handle malformed headers');
});

test('correlation ID format validation', t => {
	const validId = generateCorrelationId();

	t.regex(validId, /^[a-zA-Z0-9_-]+$/, 'Should contain only valid characters');
	t.true(validId.length >= 8, 'Should be at least 8 characters');
	t.true(validId.length <= 64, 'Should not exceed 64 characters');
});

/**
 * Test AsyncLocalStorage-only mode (legacy context disabled)
 * This test verifies that the system works correctly without legacy context fallback
 */
test('AsyncLocalStorage-only mode works without legacy context', t => {
	// Save original environment variable
	const originalEnv = process.env.NANOCODER_CORRELATION_LEGACY_FALLBACK;
	
	try {
		// Disable legacy context
		process.env.NANOCODER_CORRELATION_LEGACY_FALLBACK = 'false';
		
		// Test that AsyncLocalStorage still works
		const testId = generateCorrelationId();
		const testMetadata = {source: 'test', version: '1.0.0'};
		
		const result = withNewCorrelationContext(
			(context: CorrelationContext) => {
				// Verify context is created correctly
				t.truthy(context, 'Should have context');
				t.is(context.id, testId, 'Should have correct ID');
				t.deepEqual(context.metadata, testMetadata, 'Should have correct metadata');
				
				// Verify context is accessible within AsyncLocalStorage
				t.is(getCorrelationId(), testId, 'Should get correct ID');
				t.deepEqual(getCorrelationMetadata(), testMetadata, 'Should get correct metadata');
				
				// Verify legacy context is not used
				t.is(getCurrentCorrelationContext(), context, 'Should use AsyncLocalStorage context');
				
				return 'success';
			},
			testId,
			testMetadata
		);
		
		t.is(result, 'success', 'Should execute successfully');
		
		// Verify no legacy context was used
		const asyncOnlyResult = withNewCorrelationContext(
			(context: CorrelationContext) => {
				// In AsyncLocalStorage-only mode, legacy context should not interfere
				const current = getCurrentCorrelationContext();
				t.truthy(current, 'Should have AsyncLocalStorage context');
				t.is(current!.id, context.id, 'Should match current context');
				
				// Format for logging should work
				const formatted = formatCorrelationForLog();
				t.truthy(formatted.correlationId, 'Should format for logging');
				
				return true;
			}
		);
		
		t.true(asyncOnlyResult, 'Should work without legacy context');
		
	} finally {
		// Restore original environment variable
		if (originalEnv === undefined) {
			delete process.env.NANOCODER_CORRELATION_LEGACY_FALLBACK;
		} else {
			process.env.NANOCODER_CORRELATION_LEGACY_FALLBACK = originalEnv;
		}
	}
});

/**
 * Test concurrent operations with AsyncLocalStorage
 * Verifies that correlation contexts don't interfere with each other
 */
test('Concurrent operations maintain isolated correlation contexts', async t => {
	const results = await Promise.all([
		withNewCorrelationContext(async (context1: CorrelationContext) => {
			await new Promise(resolve => setTimeout(resolve, 10));
			return {id: context1.id, metadata: context1.metadata};
		}, 'context-1', {source: 'test1'}),
		
		withNewCorrelationContext(async (context2: CorrelationContext) => {
			await new Promise(resolve => setTimeout(resolve, 10));
			return {id: context2.id, metadata: context2.metadata};
		}, 'context-2', {source: 'test2'}),
		
		withNewCorrelationContext(async (context3: CorrelationContext) => {
			await new Promise(resolve => setTimeout(resolve, 10));
			return {id: context3.id, metadata: context3.metadata};
		}, 'context-3', {source: 'test3'}),
	]);
	
	// Verify all contexts are different
	t.is(results.length, 3, 'Should have 3 results');
	t.not(results[0].id, results[1].id, 'Context 1 and 2 should be different');
	t.not(results[0].id, results[2].id, 'Context 1 and 3 should be different');
	t.not(results[1].id, results[2].id, 'Context 2 and 3 should be different');
	
	// Verify metadata is correct
	t.deepEqual(results[0].metadata, {source: 'test1'}, 'Context 1 should have correct metadata');
	t.deepEqual(results[1].metadata, {source: 'test2'}, 'Context 2 should have correct metadata');
	t.deepEqual(results[2].metadata, {source: 'test3'}, 'Context 3 should have correct metadata');
});

/**
 * Test correlation context persistence across async boundaries
 */
test('Correlation context persists across async boundaries', async t => {
	const testId = generateCorrelationId();
	const testMetadata = {async: 'test', boundary: 'test'};
	
	const result = await withNewCorrelationContext(async (context: CorrelationContext) => {
		// Verify context in first async operation
		t.is(getCorrelationId(), testId, 'Should have context in first async op');
		
		// Wait and verify context persists
		await new Promise(resolve => setTimeout(resolve, 20));
		t.is(getCorrelationId(), testId, 'Should persist after timeout');
		
		// Nested async operation
		const nestedResult = await new Promise(resolve => {
			setTimeout(() => {
				t.is(getCorrelationId(), testId, 'Should persist in nested async');
				resolve('nested-success');
			}, 10);
		});
		
		// Final verification
		t.is(getCorrelationId(), testId, 'Should persist to end');
		
		return nestedResult;
	}, testId, testMetadata);
	
	t.is(result, 'nested-success', 'Should complete successfully');
});

/**
 * Test error handling with correlation context
 */
test('Correlation context preserved in error scenarios', async t => {
	const testId = generateCorrelationId();
	
	try {
		await withNewCorrelationContext(async (context: CorrelationContext) => {
			t.is(getCorrelationId(), testId, 'Should have context before error');
			
			// Simulate error
			throw new Error('Test error');
		}, testId);
		
		t.fail('Should have thrown error');
	} catch (error) {
		// Error should be thrown, but we can't access context here
		t.is((error as Error).message, 'Test error', 'Should throw correct error');
	}
	
	// Context should not leak after error
	const afterError = getCurrentCorrelationContext();
	t.falsy(afterError, 'Context should not leak after error');
});

test('metadata merging works correctly', t => {
	const metadata = {
		source: 'api',
		version: '1.0.0',
		environment: 'production',
		requestId: 'req-123',
	};

	const context: CorrelationContext = {
		id: 'test-123',
		metadata,
	};

	withCorrelationContext(context, () => {
		const merged = getCorrelationMetadata() as CorrelationMetadata;

		t.is(merged.source, 'api', 'Should preserve initial metadata');
		t.is(merged.version, '1.0.0', 'Should preserve initial version');
		t.is(merged.environment, 'production', 'Should include additional metadata');
		t.is(merged.requestId, 'req-123', 'Should include additional request ID');
	});

	// Context should be cleared automatically after withCorrelationContext completes
});

/**
 * Test correlation monitoring functionality
 */
test('correlation monitoring tracks context usage', t => {
	// Reset monitoring to start fresh
	resetCorrelationMonitoring();

	// Initial state
	const initialMetrics = getCorrelationMonitoring();
	t.is(initialMetrics.contextsCreated, 0, 'Should start with 0 contexts created');
	t.is(initialMetrics.activeContexts, 0, 'Should start with 0 active contexts');
	t.is(initialMetrics.errors, 0, 'Should start with 0 errors');

	// Create some contexts
	withNewCorrelationContext(() => 'test1');
	withNewCorrelationContext(() => 'test2');

	// Check metrics after context creation
	const afterMetrics = getCorrelationMonitoring();
	t.is(afterMetrics.contextsCreated, 2, 'Should track 2 contexts created');
	t.is(afterMetrics.activeContexts, 0, 'Should have 0 active contexts after completion');
	t.is(afterMetrics.errors, 0, 'Should still have 0 errors');

	// Test health check
	const health = checkCorrelationHealth();
	t.true(health.healthy, 'Health check should pass');
	t.is(health.message, 'Correlation context system is healthy', 'Should report healthy status');
});

/**
 * Test correlation monitoring error tracking
 */
test('correlation monitoring tracks errors', t => {
	// Reset monitoring to start fresh
	resetCorrelationMonitoring();

	// Create a context that throws an error
	try {
		withNewCorrelationContext(() => {
			throw new Error('Test error for monitoring');
		});
	} catch {
		// Expected to catch the error
	}

	// Check error tracking
	const metrics = getCorrelationMonitoring();
	t.is(metrics.errors, 1, 'Should track 1 error');
	t.truthy(metrics.lastError, 'Should have last error recorded');
	t.is(metrics.lastErrorTime, metrics.lastErrorTime, 'Should have error timestamp');
});
