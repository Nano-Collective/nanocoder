import test from 'ava';

// Implementation imports
import {
	StructuredConsole,
	ConsoleInterceptor,
	globalConsoleInterceptor,
	useStructuredConsole,
	createModuleConsole,
	ConsoleUsageTracker,
} from './console-facade.js';

// Simple mock implementations without sinon
const createMockLogger = () => {
	const calls: any[] = [];
	return {
		info: (...args: any[]) => calls.push({method: 'info', args}),
		error: (...args: any[]) => calls.push({method: 'error', args}),
		warn: (...args: any[]) => calls.push({method: 'warn', args}),
		debug: (...args: any[]) => calls.push({method: 'debug', args}),
		getCalls: () => calls,
		reset: () => (calls.length = 0),
	};
};

const createMockCorrelation = () => {
	let callCount = 0;
	return {
		generateCorrelationId: () => `test-correlation-id-${++callCount}`,
		getCorrelationId: () => 'test-correlation-id',
		withNewCorrelationContext: (fn: any) => fn({id: 'test-correlation-id'}),
	};
};

const createMockErrorFormatter = () => ({
	createErrorInfo: (error: any) => ({error: `mocked error info for ${error}`}),
});

let mockLogger: ReturnType<typeof createMockLogger>;
let mockCorrelation: ReturnType<typeof createMockCorrelation>;
let mockErrorFormatter: ReturnType<typeof createMockErrorFormatter>;

test.before(() => {
	mockLogger = createMockLogger();
	mockCorrelation = createMockCorrelation();
	mockErrorFormatter = createMockErrorFormatter();
});

test.afterEach(() => {
	mockLogger.reset();
});

test('StructuredConsole.log handles empty arguments', t => {
	StructuredConsole.log();

	const calls = mockLogger.getCalls();
	t.is(calls.length, 1);
	t.is(calls[0].method, 'info');
	t.is(calls[0].args[0], 'Empty console.log call');
	t.deepEqual(calls[0].args[1], {
		correlationId: 'test-correlation-id',
		source: 'console-facade',
	});
});

test('StructuredConsole.log handles single string argument', t => {
	const testMessage = 'Test log message';
	StructuredConsole.log(testMessage);

	const calls = mockLogger.getCalls();
	t.is(calls.length, 1);
	t.is(calls[0].method, 'info');
	t.is(calls[0].args[0], testMessage);
	t.deepEqual(calls[0].args[1], {
		correlationId: 'test-correlation-id',
		source: 'console-facade',
	});
});

test('StructuredConsole.log handles single object argument', t => {
	const testObject = {key: 'value', number: 42};
	StructuredConsole.log(testObject);

	const calls = mockLogger.getCalls();
	t.is(calls.length, 1);
	t.is(calls[0].method, 'info');
	t.is(calls[0].args[0], 'Object logged via console.log');
	t.deepEqual(calls[0].args[1], {
		object: testObject,
		correlationId: 'test-correlation-id',
		source: 'console-facade',
	});
});

test('StructuredConsole.log handles single primitive argument', t => {
	const testValue = 123;
	StructuredConsole.log(testValue);

	const calls = mockLogger.getCalls();
	t.is(calls.length, 1);
	t.is(calls[0].method, 'info');
	t.is(calls[0].args[0], '123');
	t.deepEqual(calls[0].args[1], {
		correlationId: 'test-correlation-id',
		source: 'console-facade',
	});
});

test('StructuredConsole.log handles multiple arguments', t => {
	const stringArg = 'Test message';
	const objectArg = {data: 'test'};
	const numberArg = 42;
	StructuredConsole.log(stringArg, objectArg, numberArg);

	const calls = mockLogger.getCalls();
	t.is(calls.length, 1);
	t.is(calls[0].method, 'info');
	t.is(calls[0].args[0], 'Test message 42');
	t.deepEqual(calls[0].args[1], {
		correlationId: 'test-correlation-id',
		source: 'console-facade',
		argumentCount: 3,
		stringArgs: 1,
		objectArgs: 1,
		primitiveArgs: 1,
		objects: [objectArg],
	});
});

test('StructuredConsole.error handles Error objects', t => {
	const testError = new Error('Test error');
	StructuredConsole.error(testError);

	const calls = mockLogger.getCalls();
	t.is(calls.length, 1);
	t.is(calls[0].method, 'error');
	t.is(calls[0].args[0], 'Error logged via console.error');
	t.deepEqual(calls[0].args[1], {
		errorInfo: {error: `mocked error info for ${testError}`},
		correlationId: 'test-correlation-id',
		source: 'console-facade',
	});
});

test('StructuredConsole.warn handles arguments correctly', t => {
	StructuredConsole.warn('Warning message', {context: 'test'});

	const calls = mockLogger.getCalls();
	t.is(calls.length, 1);
	t.is(calls[0].method, 'warn');
	t.is(calls[0].args[0], 'Warning message');
	t.deepEqual(calls[0].args[1], {
		correlationId: 'test-correlation-id',
		source: 'console-facade',
		argumentCount: 2,
		stringArgs: 1,
		objectArgs: 1,
		primitiveArgs: 0,
		objects: [{context: 'test'}],
	});
});

test('ConsoleInterceptor activates and deactivates correctly', t => {
	const originalConsole = {
		log: console.log,
		error: console.error,
		warn: console.warn,
		info: console.info,
		debug: console.debug,
	};

	const interceptor = new ConsoleInterceptor();

	// Test activation
	interceptor.activate();
	t.true(interceptor.isInterceptorActive());

	// Verify console methods are replaced
	t.is(console.log, StructuredConsole.log);
	t.is(console.error, StructuredConsole.error);
	t.is(console.warn, StructuredConsole.warn);
	t.is(console.info, StructuredConsole.info);
	t.is(console.debug, StructuredConsole.debug);

	// Test deactivation
	interceptor.deactivate();
	t.false(interceptor.isInterceptorActive());

	// Verify original methods are restored
	t.is(console.log, originalConsole.log);
	t.is(console.error, originalConsole.error);
	t.is(console.warn, originalConsole.warn);
	t.is(console.info, originalConsole.info);
	t.is(console.debug, originalConsole.debug);
});

test('ConsoleInterceptor handles multiple activation calls', t => {
	const interceptor = new ConsoleInterceptor();

	interceptor.activate();
	const firstActivation = interceptor.isInterceptorActive();

	interceptor.activate(); // Should not cause issues
	const secondActivation = interceptor.isInterceptorActive();

	t.true(firstActivation);
	t.true(secondActivation);
	t.is(console.log, StructuredConsole.log);

	interceptor.deactivate();
});

test('ConsoleInterceptor handles deactivation when not active', t => {
	const interceptor = new ConsoleInterceptor();

	// Should not throw when deactivating while not active
	t.notThrows(() => {
		interceptor.deactivate();
	}, 'Deactivation when not active should not throw');

	t.false(interceptor.isInterceptorActive());
});

test('globalConsoleInterceptor is available and functional', t => {
	t.truthy(globalConsoleInterceptor);
	t.true(globalConsoleInterceptor instanceof ConsoleInterceptor);
	t.false(globalConsoleInterceptor.isInterceptorActive());
});

test('createModuleConsole creates properly scoped console', t => {
	const moduleName = 'test-module';
	const moduleConsole = createModuleConsole(moduleName);

	t.truthy(moduleConsole);
	t.truthy(typeof moduleConsole.log === 'function');
	t.truthy(typeof moduleConsole.error === 'function');
	t.truthy(typeof moduleConsole.warn === 'function');
	t.truthy(typeof moduleConsole.info === 'function');
	t.truthy(typeof moduleConsole.debug === 'function');
});

test('ConsoleUsageTracker tracks console usage', t => {
	const tracker = new ConsoleUsageTracker();

	// Simulate some console calls
	console.log('test log');
	console.error('test error');
	console.log('another log');

	const stats = tracker.getUsageStats();
	t.true(typeof stats === 'object');
});

test('ConsoleUsageTracker.reportUsage logs statistics', t => {
	const tracker = new ConsoleUsageTracker();
	mockLogger.reset();

	tracker.reportUsage();

	const calls = mockLogger.getCalls();
	t.is(calls.length, 1);
	t.is(calls[0].method, 'info');
});

test('ConsoleUsageTracker.restore works without errors', t => {
	const tracker = new ConsoleUsageTracker();
	mockLogger.reset();

	t.notThrows(() => {
		tracker.restore();
	}, 'Restore should not throw errors');
});

test('StructuredConsole handles all console methods consistently', t => {
	const methods = ['log', 'error', 'warn', 'info', 'debug'] as const;

	methods.forEach(method => {
		mockLogger.reset();

		// Call the method with a test message
		StructuredConsole[method](`Test ${method} message`);

		const calls = mockLogger.getCalls();
		t.is(calls.length, 1);

		// Determine which logger method should have been called
		let expectedMethod;

		switch (method) {
			case 'error':
				expectedMethod = 'error';
				break;
			case 'warn':
				expectedMethod = 'warn';
				break;
			case 'debug':
				expectedMethod = 'debug';
				break;
			default:
				expectedMethod = 'info';
		}

		t.is(
			calls[0].method,
			expectedMethod,
			`${method} should call logger.${expectedMethod}`,
		);
		t.is(
			calls[0].args[0],
			`Test ${method} message`,
			`${method} should pass correct message`,
		);
		t.deepEqual(
			calls[0].args[1],
			{
				correlationId: 'test-correlation-id',
				source: 'console-facade',
			},
			`${method} should pass correct metadata`,
		);
	});
});
