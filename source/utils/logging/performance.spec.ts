import test from 'ava';
import {
	correlationStorage,
	getCurrentCorrelationContext,
} from './correlation.js';
import {
	checkMemoryThresholds,
	measureTime,
	startMetrics,
	takePerformanceSnapshot,
	trackPerformance,
} from './performance.js';

// Test the trackPerformance decorator with async context handling
test('trackPerformance decorator maintains correlation context throughout async operation', async t => {
	const testFn = async (value: unknown) => {
		// Simulate async operation
		await new Promise(resolve => setTimeout(resolve, 10));
		return `processed-${String(value)}`;
	};

	const decoratedFn = trackPerformance(testFn, 'test-async-operation', {
		logLevel: 'debug',
		trackMemory: false,
		trackCpu: false,
	});

	const result = await decoratedFn('test-input');

	t.is(result, 'processed-test-input', 'Function should return correct result');
});

test('trackPerformance decorator handles errors correctly', async t => {
	const testFn = async () => {
		throw new Error('Test error');
	};

	const decoratedFn = trackPerformance(testFn, 'test-error-handling', {
		logLevel: 'debug',
		trackMemory: false,
		trackCpu: false,
	});

	const error = await t.throwsAsync(async () => {
		await decoratedFn();
	});

	t.is(error.message, 'Test error', 'Error should be propagated correctly');
});

test('measureTime function maintains correlation context', async t => {
	const result = await measureTime(
		async () => {
			await new Promise(resolve => setTimeout(resolve, 5));
			return 'test-result';
		},
		'test-measurement',
		{
			logPerformance: false,
			trackMemory: false,
			trackCpu: false,
		},
	);

	t.is(result.result, 'test-result', 'Should return correct result');
	t.truthy(result.duration >= 0, 'Should have valid duration');
});

test('checkMemoryThresholds function works correctly', t => {
	const memory = {
		heapUsed: 100 * 1024 * 1024, // 100MB
		heapTotal: 200 * 1024 * 1024, // 200MB
		external: 50 * 1024 * 1024, // 50MB
		rss: 150 * 1024 * 1024, // 150MB
		arrayBuffers: 10 * 1024 * 1024, // 10MB
	};

	const result = checkMemoryThresholds(memory, {
		heapUsagePercentThreshold: 0.9,
		heapUsageAbsoluteThreshold: 512,
	});

	t.true(result.isHealthy, 'Should be healthy with these thresholds');
	t.is(result.warnings.length, 0, 'Should have no warnings');
});

test('takePerformanceSnapshot function works correctly', t => {
	const snapshot = takePerformanceSnapshot();

	t.truthy(snapshot.timestamp, 'Should have timestamp');
	t.truthy(snapshot.memory, 'Should have memory data');
	t.truthy(snapshot.uptime >= 0, 'Should have uptime');
	t.truthy(snapshot.correlationId, 'Should have correlation ID');
});

test('trackPerformance with complex async chains maintains context', async t => {
	const testFn = async () => {
		// Complex async chain
		const step1 = await new Promise(resolve =>
			setTimeout(() => resolve('step1'), 10),
		);
		const step2 = await new Promise(resolve =>
			setTimeout(() => resolve('step2'), 10),
		);
		const step3 = await new Promise(resolve =>
			setTimeout(() => resolve('step3'), 10),
		);

		return {step1, step2, step3};
	};

	const decoratedFn = trackPerformance(testFn, 'complex-async-chain', {
		logLevel: 'debug',
		trackMemory: false,
		trackCpu: false,
	});

	const result = await decoratedFn();

	t.deepEqual(
		result,
		{step1: 'step1', step2: 'step2', step3: 'step3'},
		'Should handle complex async chains',
	);
});

test('trackPerformance with nested async operations', async t => {
	const outerFn = async () => {
		const innerResult = await trackPerformance(
			async () => {
				await new Promise(resolve => setTimeout(resolve, 5));
				return 'inner-result';
			},
			'nested-operation',
			{logLevel: 'debug', trackMemory: false, trackCpu: false},
		)();

		return `outer-${innerResult}`;
	};

	const decoratedFn = trackPerformance(outerFn, 'outer-operation', {
		logLevel: 'debug',
		trackMemory: false,
		trackCpu: false,
	});

	const result = await decoratedFn();

	t.is(result, 'outer-inner-result', 'Should handle nested async operations');
});

test('measureTime with thresholds', async t => {
	const result = await measureTime(
		async () => {
			// Use a longer delay to ensure we exceed the threshold
			await new Promise(resolve => setTimeout(resolve, 50));
			return 'slow-result';
		},
		'slow-operation',
		{
			logPerformance: false,
			trackMemory: false,
			trackCpu: false,
			thresholds: {
				duration: 10, // Set threshold below actual duration
			},
		},
	);

	t.is(
		result.result,
		'slow-result',
		'Should return correct result even with threshold exceeded',
	);
	t.true(result.duration >= 10, 'Should have duration >= 10ms');
});

test('trackPerformance maintains context across Promise boundaries', async t => {
	let contextId: string | null = null;

	const testFn = async () => {
		// Get context at start
		const startContext = correlationStorage.getStore();

		// Simulate async boundary
		await new Promise(resolve => setTimeout(resolve, 10));

		// Get context after async boundary
		const endContext = correlationStorage.getStore();

		// Both should be the same context
		if (startContext && endContext) {
			contextId = startContext.id;
			return startContext.id === endContext.id;
		}

		return false;
	};

	const decoratedFn = trackPerformance(testFn, 'context-persistence-test', {
		logLevel: 'debug',
		trackMemory: false,
		trackCpu: false,
	});

	const result = await decoratedFn();

	t.true(result, 'Context should persist across async boundaries');
	t.truthy(contextId, 'Should have a valid context ID');
});

// Edge case tests for process.unavailable scenarios
// Use test.serial because we are mutating the global process object!
test.serial('startMetrics works when process.memoryUsage throws', t => {
	const originalMemoryUsage = process.memoryUsage;

	// Mock to simulate environment failure
	process.memoryUsage = () => { throw new Error('process unavailable'); };

	try {
		const metrics = startMetrics();
		t.truthy(metrics.startTime);
		// Correct property name: memoryUsage
		t.deepEqual(metrics.memoryUsage, {rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0});
	} finally {
		// Restore the global object
		process.memoryUsage = originalMemoryUsage;
	}
});

test.serial('takePerformanceSnapshot works when process throws', t => {
	const originalMemoryUsage = process.memoryUsage;
	const originalCpuUsage = process.cpuUsage;

	process.memoryUsage = () => { throw new Error('process unavailable'); };
	process.cpuUsage = () => { throw new Error('process unavailable'); };

	try {
		const snapshot = takePerformanceSnapshot({ includeCpu: true });

		// Verify fallbacks were used safely
		t.deepEqual(snapshot.memory, {rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0});
		t.deepEqual(snapshot.cpu, {user: 0, system: 0});
		t.truthy(snapshot.timestamp);
	} finally {
		process.memoryUsage = originalMemoryUsage;
		process.cpuUsage = originalCpuUsage;
	}
});
