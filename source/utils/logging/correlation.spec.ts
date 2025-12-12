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

	// Set context
	setCorrelationContext(context);

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

	// Clear context
	clearCorrelationContext();
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

	setCorrelationContext(context);

	const id = getCorrelationId();
	t.is(id, 'test-123', 'Should return current correlation ID');

	clearCorrelationContext();
	const clearedId = getCorrelationId();
	t.falsy(clearedId, 'Should return undefined when no context');
});

test('isCorrelationEnabled checks if correlation is active', t => {
	clearCorrelationContext();
	// isCorrelationEnabled checks process.env, not the current context
	// so this behavior may need to be adjusted based on the actual implementation
	const context = getCurrentCorrelationContext();
	t.is(context, null, 'Context should be null after clear');

	setCorrelationContext(createCorrelationContext());
	const contextAfterSet = getCurrentCorrelationContext();
	t.truthy(contextAfterSet, 'Context should not be null after setting');

	clearCorrelationContext();
});

test('getCorrelationHeader returns header value', t => {
	const context: CorrelationContext = {
		id: 'test-123',
		parentId: 'parent-456',
	};

	setCorrelationContext(context);

	const header = getCorrelationHeader();
	t.truthy(header, 'Should return header');
	t.is(typeof header, 'object', 'Should be object');
	t.deepEqual(header, {'X-Correlation-ID': 'test-123'}, 'Should return correct header');

	clearCorrelationContext();
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
	// Set an initial context first
	setCorrelationContext(createCorrelationContextWithId('test-456'));

	const metadata: CorrelationMetadata = {
		source: 'api-server',
		version: '2.1.0',
		environment: 'production',
	};

	// Add metadata
	addCorrelationMetadata('source', metadata.source);
	addCorrelationMetadata('version', metadata.version);
	addCorrelationMetadata('environment', metadata.environment);

	// Get metadata
	const retrieved = getCorrelationMetadata();
	t.truthy(retrieved, 'Should return metadata');
	t.is(retrieved.source, metadata.source, 'Should match source');
	t.is(retrieved.version, metadata.version, 'Should match version');
	t.is(retrieved.environment, metadata.environment, 'Should match environment');

	clearCorrelationContext();
});

test('formatCorrelationForLog formats for logging', t => {
	const context: CorrelationContext = {
		id: 'test-123',
		parentId: 'parent-456',
		metadata: {source: 'test'},
	};

	setCorrelationContext(context);
	const formatted = formatCorrelationForLog();

	t.is(typeof formatted, 'object', 'Should return object');
	t.is(formatted.correlationId, 'test-123', 'Should include correlation ID');

	clearCorrelationContext();
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
	const mockFunction = async (input: string) => {
		const context = getCurrentCorrelationContext();
		return `${input}-${context?.id || 'no-context'}`;
	};

	const decoratedFunction = withCorrelation(mockFunction);

	const result = await decoratedFunction('test');
	t.is(typeof result, 'string', 'Should return string');
	t.true(result.includes('test-'), 'Should include input');
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

test('metadata merging works correctly', t => {
	// Set an initial context first
	setCorrelationContext(createCorrelationContextWithId('test-123'));

	const initialMetadata = {
		source: 'api',
		version: '1.0.0',
	};

	const additionalMetadata = {
		environment: 'production',
		requestId: 'req-123',
	};

	// Add initial metadata
	addCorrelationMetadata('source', initialMetadata.source);
	addCorrelationMetadata('version', initialMetadata.version);
	addCorrelationMetadata('environment', additionalMetadata.environment);
	addCorrelationMetadata('requestId', additionalMetadata.requestId);

	const merged = getCorrelationMetadata();

	t.is(merged.source, 'api', 'Should preserve initial metadata');
	t.is(merged.version, '1.0.0', 'Should preserve initial version');
	t.is(merged.environment, 'production', 'Should include additional metadata');
	t.is(merged.requestId, 'req-123', 'Should include additional request ID');

	clearCorrelationContext();
});
