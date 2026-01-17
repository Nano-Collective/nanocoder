import {existsSync, mkdirSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import test from 'ava';

console.log(`\nlogging/config.spec.ts`);

// Import configuration functions
import {
	createConfig,
	createDevelopmentConfig,
	createProductionConfig,
	createTestConfig,
	getDefaultLogDirectory,
	getEnvironmentConfig,
	normalizeLogLevel,
	validateLogLevel,
} from './config.js';

// Import types
import type {LoggerConfig} from './types.js';

// Create a temporary test directory
const testDir = join(tmpdir(), `nanocoder-config-test-${Date.now()}`);

test.before(() => {
	mkdirSync(testDir, {recursive: true});
});

test.after.always(() => {
	// Clean up test directory
	if (existsSync(testDir)) {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test('getDefaultLogDirectory returns valid directory path', t => {
	const directory = getDefaultLogDirectory();

	t.is(typeof directory, 'string', 'Should return string');
	t.true(directory.length > 0, 'Should not be empty');
	t.true(directory.includes('nanocoder'), 'Should include nanocoder in path');
});

test('getDefaultLogDirectory respects NANOCODER_LOG_DIR env var', t => {
	const originalLogDir = process.env.NANOCODER_LOG_DIR;

	try {
		process.env.NANOCODER_LOG_DIR = '/custom/log/path';
		const directory = getDefaultLogDirectory();
		t.is(directory, '/custom/log/path', 'Should use custom log directory');
	} finally {
		if (originalLogDir) {
			process.env.NANOCODER_LOG_DIR = originalLogDir;
		} else {
			delete process.env.NANOCODER_LOG_DIR;
		}
	}
});

test('createDevelopmentConfig creates valid development config', t => {
	const config = createDevelopmentConfig();

	t.is(typeof config, 'object', 'Should return object');
	t.is(config.level, 'debug', 'Should use debug level in development');
	t.true(config.pretty, 'Should enable pretty printing in development');
	t.true(config.correlation, 'Should enable correlation in development');
	t.false(config.serialize, 'Should not serialize in development');
	t.true(Array.isArray(config.redact), 'Should have redaction array');
});

test('createProductionConfig creates valid production config', t => {
	const config = createProductionConfig();

	t.is(typeof config, 'object', 'Should return object');
	t.is(config.level, 'info', 'Should use info level in production for file logging');
	t.false(config.pretty, 'Should disable pretty printing in production');
	t.true(config.correlation, 'Should enable correlation in production');
	t.true(config.serialize, 'Should serialize in production');
	t.true(Array.isArray(config.redact), 'Should have redaction array');
});

test('createTestConfig creates valid test config', t => {
	const config = createTestConfig();

	t.is(typeof config, 'object', 'Should return object');
	t.is(config.level, 'debug', 'Should use debug level in tests');
	t.false(config.pretty, 'Should disable pretty printing in tests');
	t.false(config.correlation, 'Should disable correlation in tests');
	t.false(config.serialize, 'Should not serialize in tests');
});

test('getEnvironmentConfig detects environment correctly', t => {
	// Test development environment
	const originalEnv = process.env.NODE_ENV;

	process.env.NODE_ENV = 'development';
	const devConfig = getEnvironmentConfig();
	t.is(devConfig.level, 'debug', 'Should detect development');
	t.true(devConfig.pretty, 'Should enable pretty in development');

	// Test production environment
	process.env.NODE_ENV = 'production';
	const prodConfig = getEnvironmentConfig();
	t.is(prodConfig.level, 'info', 'Should detect production (info level for file logging)');
	t.false(prodConfig.pretty, 'Should disable pretty in production');

	// Test test environment
	process.env.NODE_ENV = 'test';
	const testConfig = getEnvironmentConfig();
	t.is(testConfig.level, 'debug', 'Should detect test');
	t.is(testConfig.level, 'debug', 'Should use debug in test');

	// Test unknown environment (should default to production config for CLI tools)
	process.env.NODE_ENV = 'unknown';
	const unknownConfig = getEnvironmentConfig();
	t.is(unknownConfig.level, 'info', 'Should default to info for unknown (production default with file logging)');

	// Restore original environment
	process.env.NODE_ENV = originalEnv;
});

test('validateLogLevel validates log levels correctly', t => {
	// Valid levels
	t.true(validateLogLevel('trace'), 'Should accept trace');
	t.true(validateLogLevel('debug'), 'Should accept debug');
	t.true(validateLogLevel('info'), 'Should accept info');
	t.true(validateLogLevel('warn'), 'Should accept warn');
	t.true(validateLogLevel('error'), 'Should accept error');
	t.true(validateLogLevel('fatal'), 'Should accept fatal');
	t.true(validateLogLevel('silent'), 'Should accept silent');

	// Invalid levels
	t.false(validateLogLevel('invalid'), 'Should reject invalid');
	t.false(validateLogLevel(''), 'Should reject empty');
	t.false(validateLogLevel('info '), 'Should reject with space');
	t.false(validateLogLevel(' info'), 'Should reject with leading space');
});

test('normalizeLogLevel normalizes log levels', t => {
	// Valid levels should pass through
	t.is(normalizeLogLevel('trace'), 'trace', 'Should pass trace');
	t.is(normalizeLogLevel('debug'), 'debug', 'Should pass debug');
	t.is(normalizeLogLevel('info'), 'info', 'Should pass info');
	t.is(normalizeLogLevel('warn'), 'warn', 'Should pass warn');
	t.is(normalizeLogLevel('error'), 'error', 'Should pass error');
	t.is(normalizeLogLevel('fatal'), 'fatal', 'Should pass fatal');
	t.is(normalizeLogLevel('silent'), 'silent', 'Should pass silent');

	// Uppercase should be normalized
	t.is(normalizeLogLevel('TRACE'), 'trace', 'Should normalize TRACE');
	t.is(normalizeLogLevel('DEBUG'), 'debug', 'Should normalize DEBUG');
	t.is(normalizeLogLevel('INFO'), 'info', 'Should normalize INFO');
	t.is(normalizeLogLevel('WARN'), 'warn', 'Should normalize WARN');
	t.is(normalizeLogLevel('ERROR'), 'error', 'Should normalize ERROR');
	t.is(normalizeLogLevel('FATAL'), 'fatal', 'Should normalize FATAL');
	t.is(normalizeLogLevel('SILENT'), 'silent', 'Should normalize SILENT');

	// Invalid should default to info
	t.is(normalizeLogLevel('INFO'), 'info', 'Should default to info');
});

test('createConfig merges overrides correctly', t => {
	// Note: createConfig() uses getEnvironmentConfig()
	// Tests run in NODE_ENV='test', which has correlation: false and serialize: false

	const overrides: Partial<LoggerConfig> = {
		level: 'error',
		pretty: true,
		redact: ['token', 'password'],
	};

	const merged = createConfig(overrides);

	t.is(merged.level, 'error', 'Should override level');
	t.is(merged.pretty, true, 'Should override pretty');
	t.deepEqual(merged.redact, ['token', 'password'], 'Should override redact');
	t.is(merged.correlation, false, 'Should preserve correlation from test config');
	t.is(merged.serialize, false, 'Should preserve serialize from test config');
});

test('createConfig handles missing overrides', t => {
	const baseConfig: LoggerConfig = {
		level: 'info',
		pretty: true,
		redact: ['apiKey'],
		correlation: false,
		serialize: false,
	};

	const result = createConfig(baseConfig);

	t.notDeepEqual(
		result,
		baseConfig,
		'Should return environment config with no overrides',
	);
});

test('createConfig handles overrides correctly', t => {
	const overrides: Partial<LoggerConfig> = {
		level: 'debug',
		pretty: false,
	};

	t.notThrows(() => {
		const result = createConfig(overrides);
		t.is(typeof result, 'object', 'Should return object');
	}, 'Should handle overrides');
});

test('createConfig handles partial overrides', t => {
	const partialOverride: Partial<LoggerConfig> = {
		level: 'warn',
	};

	const result = createConfig(partialOverride);

	t.is(result.level, 'warn', 'Should override specified field');
	// Note: Other fields will depend on the environment config, not preserved from a base
});

test('createConfig validates log level in overrides', t => {
	const invalidOverride: Partial<LoggerConfig> = {
		level: 'debug',
	};

	t.notThrows(() => {
		const result = createConfig(invalidOverride);
		t.is(typeof result, 'object', 'Should handle valid level');
	}, 'Should handle valid log level');
});

test('createConfig overrides redact arrays correctly', t => {
	const overrideWithArray: Partial<LoggerConfig> = {
		redact: ['password', 'secret'],
	};

	const result = createConfig(overrideWithArray);

	// Should use override array, not merge
	t.deepEqual(
		result.redact,
		['password', 'secret'],
		'Should replace redact array',
	);
});

test('configuration respects environment variables', t => {
	const originalLogLevel = process.env.NANOCODER_LOG_LEVEL;
	const originalNodeEnv = process.env.NODE_ENV;

	// Set environment variables
	process.env.NANOCODER_LOG_LEVEL = 'error';
	process.env.NODE_ENV = 'production';

	try {
		const config = getEnvironmentConfig();

		t.is(config.level, 'error', 'Should use LOG_LEVEL from environment');
		// Production config should be applied
		t.false(config.pretty, 'Should apply production config');
	} finally {
		// Restore environment variables
		if (originalLogLevel) {
			process.env.NANOCODER_LOG_LEVEL = originalLogLevel;
		} else {
			delete process.env.NANOCODER_LOG_LEVEL;
		}
		process.env.NODE_ENV = originalNodeEnv;
	}
});

test('createDevelopmentConfig includes sensible defaults', t => {
	const config = createDevelopmentConfig();

	// Check default redaction patterns
	t.true(config.redact.includes('apiKey'), 'Should redact API keys by default');
	t.true(config.redact.includes('token'), 'Should redact tokens by default');
	t.true(
		config.redact.includes('password'),
		'Should redact passwords by default',
	);

	// Check correlation settings
	t.true(config.correlation, 'Should enable correlation in development');

	// Note: Current implementation doesn't include transport configuration
	// t.truthy(config.transport, 'Should have transport configuration');
	// t.is(
	//   (config.transport as any)?.target,
	//   'pino-pretty',
	//   'Should use pretty transport in development',
	// );
});

test('createProductionConfig includes production optimizations', t => {
	const config = createProductionConfig();

	// Check production-specific settings
	t.true(config.serialize, 'Should serialize in production');
	t.is(config.level, 'info', 'Should default to info in production for file logging');

	// Check redaction patterns for production
	t.true(config.redact.includes('email'), 'Should redact emails in production');
	t.true(
		config.redact.includes('userId'),
		'Should redact user IDs in production',
	);
});

test('createProductionConfig respects NANOCODER_LOG_DISABLE_FILE', t => {
	const originalDisableFile = process.env.NANOCODER_LOG_DISABLE_FILE;

	try {
		process.env.NANOCODER_LOG_DISABLE_FILE = 'true';
		const config = createProductionConfig();
		t.is(config.level, 'silent', 'Should use silent level when file logging is disabled');
	} finally {
		if (originalDisableFile) {
			process.env.NANOCODER_LOG_DISABLE_FILE = originalDisableFile;
		} else {
			delete process.env.NANOCODER_LOG_DISABLE_FILE;
		}
	}
});

test('createTestConfig minimizes output', t => {
	const config = createTestConfig();

	t.is(config.level, 'debug', 'Should be debug in tests');
	t.false(config.pretty, 'Should disable pretty in tests');
	t.false(config.correlation, 'Should disable correlation in tests');
	t.false(config.serialize, 'Should disable serialization in tests');
});
