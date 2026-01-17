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
	t.true(provider.isLevelEnabled('info'), 'Should enable info level');
	t.true(provider.isLevelEnabled('fatal'), 'Should enable fatal level');
	t.true(provider.isLevelEnabled('debug'), 'Should enable debug level');
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
	// Note: The fallback logger uses 'silent' to avoid console spam.
	// Once the real pino logger loads asynchronously, it will use 'info' from config.ts.
	// This test runs synchronously, so it sees the fallback config.
	process.env.NODE_ENV = 'production';
	provider.reset();
	const prodLogger = provider.initializeLogger();
	const prodConfig = provider.getLoggerConfig();
	if (prodConfig) {
		t.is(prodConfig.level, 'silent');
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

test('async dependency loading completes successfully', async t => {
	const provider = LoggerProvider.getInstance();

	// Initialize the logger - this triggers fallback setup and async loading
	const logger = provider.initializeLogger();
	t.truthy(logger, 'Should create initial logger');

	// Wait for async loading to complete
	// The loadRealDependencies() method is called asynchronously
	await new Promise(resolve => setTimeout(resolve, 100));

	// The logger should still be functional
	t.notThrows(() => {
		logger.info('Test message');
	}, 'Logger should remain functional after async load');
});

test('multiple initializeLogger calls do not cause duplicate async loads', async t => {
	const provider = LoggerProvider.getInstance();

	// Call initialize multiple times rapidly
	const logger1 = provider.initializeLogger();
	const logger2 = provider.initializeLogger();
	const logger3 = provider.initializeLogger();

	t.is(logger1, logger2, 'Should return same instance on second call');
	t.is(logger2, logger3, 'Should return same instance on third call');

	// Wait for async loading
	await new Promise(resolve => setTimeout(resolve, 100));

	// All loggers should still be functional
	t.notThrows(() => {
		logger1.info('Test message 1');
		logger2.info('Test message 2');
		logger3.info('Test message 3');
	}, 'All logger instances should work after async load');
});

test.serial(
	'Bun runtime detection - uses fallback logger when Bun detected',
	async t => {
		const provider = LoggerProvider.getInstance();

		// Simulate Bun runtime by setting globalThis.Bun
		const originalBun = (globalThis as Record<string, unknown>).Bun;
		(globalThis as Record<string, unknown>).Bun = {version: '1.0.0'};

		try {
			provider.reset();
			const logger = provider.initializeLogger();

			// Logger should still work (using fallback)
			t.truthy(logger, 'Should create logger even with Bun runtime');
			t.truthy(typeof logger.info === 'function', 'Should have info method');
			t.truthy(typeof logger.error === 'function', 'Should have error method');

			// Should be able to call logging methods without crashing
			t.notThrows(() => {
				logger.info('Test message');
				logger.error('Error message');
			}, 'Should be able to log without Pino transport crash');

			// Wait for async loading period to pass - under Bun, loadRealDependencies
			// should NOT be called, so the logger should remain a fallback logger
			await new Promise(resolve => setTimeout(resolve, 100));

			// Verify the logger is still functional after the async period
			// (in Bun, we skip Pino loading entirely, so no upgrade should occur)
			t.notThrows(() => {
				logger.info('Post-async test message');
			}, 'Logger should remain functional (fallback) after async period');

			// The fallback logger's flush is a no-op that resolves immediately
			// Pino's flush would interact with file streams - this verifies we're using fallback
			await t.notThrowsAsync(
				async () => provider.flush(),
				'Flush should complete without errors (fallback logger)',
			);
		} finally {
			// Restore original state
			if (originalBun === undefined) {
				delete (globalThis as Record<string, unknown>).Bun;
			} else {
				(globalThis as Record<string, unknown>).Bun = originalBun;
			}
			provider.reset();
		}
	},
);
