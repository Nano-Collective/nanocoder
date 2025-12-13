import test from 'ava';

// Implementation imports
import {LoggerProvider, loggerProvider} from './logger-provider.js';
import type {LoggerConfig} from './types.js';

test.beforeEach(() => {
	// Reset the singleton instance before each test
	const provider = LoggerProvider.getInstance();
	provider.reset();
	// Reset environment variables
	delete process.env.NODE_ENV;
	delete process.env.NANOCODER_LOG_LEVEL;
});

test('LoggerProvider is a singleton', t => {
	const provider1 = LoggerProvider.getInstance();
	const provider2 = LoggerProvider.getInstance();

	t.is(provider1, provider2, 'Should return the same instance');
	t.true(provider1 instanceof LoggerProvider);
});

test('loggerProvider exports singleton instance', t => {
	t.truthy(loggerProvider);
	t.true(loggerProvider instanceof LoggerProvider);
});

test('initializeLogger creates logger with default config', t => {
	const provider = LoggerProvider.getInstance();

	const logger = provider.initializeLogger();

	t.truthy(logger, 'Should create logger instance');
	t.truthy(typeof logger.info === 'function', 'Should have info method');
	t.truthy(typeof logger.error === 'function', 'Should have error method');
	t.truthy(typeof logger.warn === 'function', 'Should have warn method');
	t.truthy(typeof logger.debug === 'function', 'Should have debug method');
	t.truthy(typeof logger.fatal === 'function', 'Should have fatal method');
	t.truthy(typeof logger.trace === 'function', 'Should have trace method');
	t.truthy(typeof logger.http === 'function', 'Should have http method');
});

test('initializeLogger uses provided config', t => {
	const provider = LoggerProvider.getInstance();
	const config: Partial<LoggerConfig> = {
		level: 'error',
		pretty: true,
		correlation: false,
	};

	const logger = provider.initializeLogger(config);
	const actualConfig = provider.getLoggerConfig();

	if (actualConfig) {
		t.is(actualConfig.level, 'error');
		t.is(actualConfig.pretty, true);
		t.is(actualConfig.correlation, false);
	} else {
		t.fail('Logger config should not be null');
	}
});

test('initializeLogger returns same logger on subsequent calls', t => {
	const provider = LoggerProvider.getInstance();

	const logger1 = provider.initializeLogger();
	const logger2 = provider.initializeLogger();

	t.is(logger1, logger2, 'Should return the same logger instance');
});

test('getLogger auto-initializes if not initialized', t => {
	const provider = LoggerProvider.getInstance();

	const logger = provider.getLogger();

	t.truthy(logger, 'Should auto-initialize and return logger');
});

test('getLogger returns existing logger if initialized', t => {
	const provider = LoggerProvider.getInstance();

	const logger1 = provider.initializeLogger({level: 'warn'});
	const logger2 = provider.getLogger();

	t.is(logger1, logger2, 'Should return the same initialized logger');
});

test('getLoggerConfig returns current configuration', t => {
	const provider = LoggerProvider.getInstance();

	// Should be null before initialization
	t.is(provider.getLoggerConfig(), null);

	const config: Partial<LoggerConfig> = {level: 'debug'};
	provider.initializeLogger(config);

	const actualConfig = provider.getLoggerConfig();
	if (actualConfig) {
		t.is(actualConfig.level, 'debug');
	} else {
		t.fail('Logger config should not be null');
	}
});

test('createChildLogger creates child with bindings', t => {
	const provider = LoggerProvider.getInstance();

	provider.initializeLogger();

	const bindings = {module: 'test', version: '1.0'};
	const childLogger = provider.createChildLogger(bindings);

	t.truthy(childLogger, 'Should create child logger');
	t.truthy(
		typeof childLogger.info === 'function',
		'Child should have info method',
	);
	t.not(
		childLogger === provider.getLogger(),
		'Child should be different instance',
	);
});

test('isLevelEnabled checks log level', t => {
	const provider = LoggerProvider.getInstance();

	provider.initializeLogger({level: 'warn'});

	t.true(provider.isLevelEnabled('warn'), 'Should enable warn level');
	t.true(provider.isLevelEnabled('error'), 'Should enable error level');
	t.true(provider.isLevelEnabled('fatal'), 'Should enable fatal level');
	t.false(provider.isLevelEnabled('info'), 'Should not enable info level');
	t.false(provider.isLevelEnabled('debug'), 'Should not enable debug level');
});

test('reset clears all state', t => {
	const provider = LoggerProvider.getInstance();

	// Initialize and use provider
	provider.initializeLogger({level: 'debug'});
	t.truthy(provider.getLogger(), 'Should have logger after initialization');
	t.truthy(
		provider.getLoggerConfig(),
		'Should have config after initialization',
	);

	// Reset
	provider.reset();

	t.is(provider.getLoggerConfig(), null, 'Config should be null after reset');

	// Should be able to initialize again
	const newLogger = provider.initializeLogger({level: 'error'});
	t.truthy(newLogger, 'Should create new logger after reset');
});

test('flush and end work correctly', async t => {
	const provider = LoggerProvider.getInstance();

	provider.initializeLogger();

	await t.notThrowsAsync(async () => {
		await provider.flush();
	}, 'Flush should complete without errors');

	await t.notThrowsAsync(async () => {
		await provider.end();
	}, 'End should complete without errors');

	// After end, logger should be null
	t.is(provider.getLoggerConfig(), null);
});

test('createDefaultConfig handles environments correctly', t => {
	const provider = LoggerProvider.getInstance();

	// Test development environment
	process.env.NODE_ENV = 'development';
	provider.reset();
	const devLogger = provider.initializeLogger();
	const devConfig = provider.getLoggerConfig();
	if (devConfig) {
		t.is(devConfig.level, 'debug');
		t.true(devConfig.pretty);
	} else {
		t.fail('Development config should not be null');
	}

	// Test production environment
	process.env.NODE_ENV = 'production';
	provider.reset();
	const prodLogger = provider.initializeLogger();
	const prodConfig = provider.getLoggerConfig();
	if (prodConfig) {
		t.is(prodConfig.level, 'info');
		t.false(prodConfig.pretty);
	} else {
		t.fail('Production config should not be null');
	}

	// Test environment
	process.env.NODE_ENV = 'test';
	provider.reset();
	const testLogger = provider.initializeLogger();
	const testConfig = provider.getLoggerConfig();
	if (testConfig) {
		t.is(testConfig.level, 'silent');
	} else {
		t.fail('Test config should not be null');
	}
});

test('createDefaultConfig respects LOG_LEVEL environment variable', t => {
	const provider = LoggerProvider.getInstance();

	process.env.NANOCODER_LOG_LEVEL = 'warn';
	process.env.NODE_ENV = 'production';

	provider.initializeLogger();
	const config = provider.getLoggerConfig();

	if (config) {
		t.is(config.level, 'warn');
	} else {
		t.fail('Config should not be null');
	}
});

test('multiple providers share singleton state', t => {
	const provider1 = LoggerProvider.getInstance();
	const provider2 = LoggerProvider.getInstance();

	provider1.initializeLogger({level: 'error'});

	// Both should return the same config
	const config1 = provider1.getLoggerConfig();
	const config2 = provider2.getLoggerConfig();

	if (config1 && config2) {
		t.is(config1.level, 'error');
		t.is(config2.level, 'error');

		// Reset should affect both
		provider1.reset();
		t.is(provider1.getLoggerConfig(), null);
		t.is(provider2.getLoggerConfig(), null);
	} else {
		t.fail('Configs should not be null');
	}
});

test('provider handles empty initializeLogger calls', t => {
	const provider = LoggerProvider.getInstance();

	// Should not throw when called with no arguments
	t.notThrows(() => {
		const logger = provider.initializeLogger();
		t.truthy(logger);
	});
});
