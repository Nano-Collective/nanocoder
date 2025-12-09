import test from 'ava';
import {existsSync, writeFileSync, rmSync, mkdirSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';

console.log(`\nlogging/index.spec.ts`);

// Import the logging functions we want to test
import {
	initializeLogger,
	getLogger,
	getLoggerConfig,
	createChildLogger,
	isLevelEnabled,
	log,
	console as structuredConsole,
	flush,
	end,
} from './index.js';

// Import types for testing
import type {LoggerConfig, LogLevel} from './types.js';

// Create a temporary test directory
const testDir = join(tmpdir(), `nanocoder-logging-test-${Date.now()}`);

test.before(() => {
	// Create test directory
	mkdirSync(testDir, {recursive: true});

	// Set test environment variables
	process.env.NODE_ENV = 'test';
	process.env.LOG_LEVEL = 'debug';
});

test.after.always(async () => {
	// Clean up test directory
	if (existsSync(testDir)) {
		rmSync(testDir, {recursive: true, force: true});
	}

	// Reset logger state
	await end();
});

test('initializeLogger creates a logger instance', t => {
	const logger = initializeLogger({
		level: 'debug',
		pretty: true,
	});

	t.truthy(logger, 'Logger should be created');
	t.is(typeof logger.info, 'function', 'Logger should have info method');
	t.is(typeof logger.error, 'function', 'Logger should have error method');
	t.is(typeof logger.warn, 'function', 'Logger should have warn method');
	t.is(typeof logger.debug, 'function', 'Logger should have debug method');
});

test('getLogger returns the same logger instance', t => {
	// Reset logger state first
	const logger1 = initializeLogger({level: 'info'});
	const logger2 = getLogger();
	const logger3 = getLogger();

	t.is(logger1, logger2, 'Should return same instance');
	t.is(logger2, logger3, 'Should return same instance');
});

test('getLogger auto-initializes with defaults', async t => {
	// Reset logger state
	await end();

	const logger = getLogger();

	t.truthy(logger, 'Should auto-initialize logger');
	t.is(typeof logger.info, 'function', 'Should have info method');
});

test('getLoggerConfig returns current configuration', t => {
	const config: LoggerConfig = {
		level: 'warn',
		pretty: false,
		redact: ['apiKey'],
		correlation: true,
		serialize: true,
	};

	initializeLogger(config);
	const retrievedConfig = getLoggerConfig();

	t.truthy(retrievedConfig, 'Should return configuration');
	t.is(retrievedConfig!.level, config.level, 'Should match level');
	t.is(retrievedConfig!.pretty, config.pretty, 'Should match pretty setting');
	t.deepEqual(
		retrievedConfig!.redact,
		config.redact,
		'Should match redaction rules',
	);
});

test('createChildLogger creates child with bindings', t => {
	const parentLogger = initializeLogger({level: 'debug'});
	const childBindings = {module: 'test', userId: '123'};
	const childLogger = createChildLogger(childBindings);

	t.truthy(childLogger, 'Should create child logger');
	t.is(typeof childLogger.info, 'function', 'Child should have info method');
	t.not(parentLogger, childLogger, 'Should be different instance');
});

test('isLevelEnabled checks log level correctly', t => {
	initializeLogger({level: 'warn'});

	t.false(isLevelEnabled('debug'), 'Debug should not be enabled at warn level');
	t.false(isLevelEnabled('trace'), 'Trace should not be enabled at warn level');
	t.true(isLevelEnabled('warn'), 'Warn should be enabled at warn level');
	t.true(isLevelEnabled('error'), 'Error should be enabled at warn level');
	t.true(isLevelEnabled('fatal'), 'Fatal should be enabled at warn level');
});

test('log convenience methods work correctly', t => {
	const logger = initializeLogger({level: 'debug'});

	t.notThrows(() => {
		log.debug('Debug message');
		log.info('Info message');
		log.warn('Warning message');
		log.error('Error message');
		log.fatal('Fatal message');
		log.http('HTTP message');
		log.trace('Trace message');
	}, 'Log methods should not throw');
});

test('structured console facade provides backward compatibility', t => {
	t.notThrows(() => {
		structuredConsole.log('Test log message');
		structuredConsole.info('Test info message');
		structuredConsole.warn('Test warning message');
		structuredConsole.error('Test error message');
		structuredConsole.debug('Test debug message');
	}, 'Console facade methods should not throw');
});

test('flush and end methods work correctly', async t => {
	const logger = initializeLogger({level: 'info'});

	logger.info('Test message for flushing');

	await t.notThrowsAsync(async () => {
		await flush();
		await end();
	}, 'Flush and end should not throw');
});

test('logger handles different log levels correctly', t => {
	const logger = initializeLogger({level: 'warn'});

	// These should be filtered out
	t.notThrows(() => {
		logger.trace('trace message');
		logger.debug('debug message');
		logger.info('info message');
		logger.http('http message');
	}, 'Filtered levels should not throw');

	// These should be logged
	t.notThrows(() => {
		logger.warn('warn message');
		logger.error('error message');
		logger.fatal('fatal message');
	}, 'Active levels should not throw');
});

test('logger handles structured data correctly', t => {
	const logger = initializeLogger({level: 'debug'});

	const testData = {
		userId: '123',
		action: 'login',
		metadata: {ip: '127.0.0.1', userAgent: 'test-agent'},
	};

	t.notThrows(() => {
		logger.info('User action', testData);
		logger.warn('Warning with data', {type: 'validation', details: testData});
		logger.error('Error with context', {
			error: new Error('test'),
			context: testData,
		});
	}, 'Structured data should be handled correctly');
});

test('logger handles edge cases gracefully', t => {
	const logger = initializeLogger({level: 'debug'});

	// Empty message
	t.notThrows(() => {
		logger.info('');
		logger.info(null as any);
		logger.info(undefined as any);
	}, 'Edge cases should not throw');

	// Large objects
	const largeObject = {data: 'x'.repeat(10000)};
	t.notThrows(() => {
		logger.info('Large object', largeObject);
	}, 'Large objects should be handled');

	// Circular references
	const circular: any = {a: 1};
	circular.self = circular;
	t.notThrows(() => {
		logger.info('Circular reference', circular);
	}, 'Circular references should be handled');
});

test('logger maintains correlation context', t => {
	const logger = initializeLogger({
		level: 'debug',
		correlation: true,
	});

	t.notThrows(() => {
		logger.info('Message with correlation');
		logger.child({requestId: 'req-123'}).info('Child message');
	}, 'Correlation context should be maintained');
});

test('logger respects redaction rules', t => {
	const logger = initializeLogger({
		level: 'debug',
		redact: ['apiKey', 'token', 'password', 'secret'],
	});

	const sensitiveData = {
		username: 'user123',
		apiKey: 'sk-1234567890',
		password: 'secret123',
		token: 'abc123xyz',
		safeField: 'public-data',
	};

	t.notThrows(() => {
		logger.info('Login attempt', sensitiveData);
	}, 'Redaction should not throw errors');

	// The actual redaction would be verified by checking log output,
	// but that requires more complex test setup with output capture
});

test('multiple logger instances do not interfere', t => {
	const logger1 = initializeLogger({
		level: 'debug',
		pretty: true,
	});

	// This should return the existing instance
	const logger2 = getLogger();

	t.is(logger1, logger2, 'Should return same instance');

	t.notThrows(() => {
		logger1.info('Message from logger1');
		logger2.debug('Message from logger2');
	}, 'Multiple references should work');
});
