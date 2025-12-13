import test from 'ava';
import {join} from 'path';
import {existsSync, rmSync, mkdirSync} from 'fs';
import {tmpdir} from 'os';

// Implementation imports
import {
	createDevelopmentTransport,
	createProductionTransport,
	createTestTransport,
	createCustomTransport,
	createMultiTransport,
	createBufferedTransport,
	createErrorTransport,
	createAuditTransport,
	getTransportFromEnvironment,
	validateTransport,
	createSafeTransport,
} from './transports.js';
import type {TransportConfig} from './types.js';

// Test utilities
const testLogDir = join(tmpdir(), `nanocoder-transport-test-${Date.now()}`);

test.before(() => {
	mkdirSync(testLogDir, {recursive: true});
});

test.after.always(() => {
	// Clean up test directory
	if (existsSync(testLogDir)) {
		rmSync(testLogDir, {recursive: true, force: true});
	}
});

test.beforeEach(() => {
	// Reset environment variables
	delete process.env.NODE_ENV;
	delete process.env.LOG_TRANSPORTS;
	delete process.env.LOG_TO_FILE;
});

test('createDevelopmentTransport creates valid transport', t => {
	const transport = createDevelopmentTransport();

	t.is(transport.target, 'pino-pretty');
	t.is(transport.level, 'debug');
	t.truthy(transport.options);
	if (transport.options) {
		t.true(transport.options.colorize);
		t.is(transport.options.translateTime, 'HH:MM:ss Z');
		t.is(transport.options.ignore, 'pid,hostname');
		t.true(transport.options.levelFirst);
		t.is(transport.options.messageFormat, '{levelLabel} - {msg}');
		t.false(transport.options.singleLine);
		t.truthy((transport.options as any).customPrettifiers);
		t.is(typeof (transport.options as any).customPrettifiers.time, 'function');
	}
});

test('createProductionTransport creates valid transport with default directory', t => {
	const transport = createProductionTransport();

	t.is(transport.target, 'pino-roll');
	t.is(transport.level, 'info');
	t.truthy(transport.options);
	if (transport.options) {
		t.true((transport.options as any).file.includes('nanocoder-%Y-%m-%d.log'));
		t.is(transport.options.frequency, 'daily');
		t.is(transport.options.size, '100m');
		t.is(transport.options.dateFormat, 'yyyy-MM-dd');
		t.is(transport.options.extension, '.log');
		t.true(transport.options.symlink);
		t.true(transport.options.mkdir);
		t.true(transport.options.compress);
		t.false(transport.options.sync);
		t.truthy(transport.options.limit);
		if (transport.options.limit) {
			t.is((transport.options.limit as any).count, 30);
			t.true((transport.options.limit as any).removeOtherLogFiles);
		}
		t.is(transport.options.minLength, 4096);
		t.is(transport.options.maxLength, 1048576);
		t.is(transport.options.periodicFlush, 1000);
	}
});

test('createProductionTransport uses custom log directory', t => {
	const transport = createProductionTransport(testLogDir);

	if (transport.options) {
		t.is(transport.options.file, join(testLogDir, 'nanocoder-%Y-%m-%d.log'));
	}
});

test('createTestTransport creates silent transport', t => {
	const transport = createTestTransport();

	t.is(transport.target, 'pino/file');
	t.is(transport.level, 'silent');
	if (transport.options) {
		t.is(transport.options.destination, '/dev/null');
	}
});

test('createCustomTransport uses provided config', t => {
	const config: TransportConfig = {
		target: 'pino/file',
		options: {
			destination: '/tmp/test.log',
			level: 'warn',
			minLength: 2048,
			maxLength: 512000,
		},
	};

	const transport = createCustomTransport(config);

	t.is(transport.target, 'pino/file');
	t.is(transport.level, 'warn');
	t.truthy(transport.options);
	if (transport.options) {
		t.is(transport.options.destination, '/tmp/test.log');
		t.is(transport.options.minLength, 2048);
		t.is(transport.options.maxLength, 512000);
	}
});

test('createCustomTransport sets default options when not provided', t => {
	const config: TransportConfig = {
		target: 'pino/file',
		options: {
			destination: '/tmp/test.log',
		},
	};

	const transport = createCustomTransport(config);

	t.is(transport.level, 'info');
	if (transport.options) {
		t.is(transport.options.minLength, 4096);
		t.is(transport.options.maxLength, 1048576);
	}
});

test('createMultiTransport returns development transport in non-production', t => {
	process.env.NODE_ENV = 'development';

	const transports = createMultiTransport();

	t.true(Array.isArray(transports));
	t.is(transports.length, 1);
	t.is(transports[0].target, 'pino-pretty');
});

test('createMultiTransport returns production transport in production', t => {
	process.env.NODE_ENV = 'production';

	const transports = createMultiTransport();

	t.true(Array.isArray(transports));
	t.is(transports.length, 1);
	t.is(transports[0].target, 'pino-roll');
});

test('createMultiTransport returns both transports when LOG_TO_FILE is true', t => {
	process.env.NODE_ENV = 'development';
	process.env.LOG_TO_FILE = 'true';

	const transports = createMultiTransport();

	t.true(Array.isArray(transports));
	t.is(transports.length, 2);
	t.is(transports[0].target, 'pino-pretty');
	t.is(transports[1].target, 'pino-roll');
});

test('createBufferedTransport adds buffering options', t => {
	const baseTransport: TransportConfig = {
		target: 'pino/file',
		options: {
			destination: '/tmp/test.log',
		},
	};

	const bufferedTransport = createBufferedTransport(baseTransport, 32768);

	t.is(bufferedTransport.target, baseTransport.target);
	if (bufferedTransport.options && baseTransport.options) {
		t.is(
			bufferedTransport.options.destination,
			baseTransport.options.destination,
		);
		t.is(bufferedTransport.options.bufferSize, 32768);
		t.false(bufferedTransport.options.sync);
	}
});

test('createBufferedTransport uses default buffer size', t => {
	const baseTransport: TransportConfig = {
		target: 'pino/file',
		options: {
			destination: '/tmp/test.log',
		},
	};

	const bufferedTransport = createBufferedTransport(baseTransport);

	if (bufferedTransport.options) {
		t.is(bufferedTransport.options.bufferSize, 65536);
	}
});

test('createErrorTransport creates error-specific transport', t => {
	const transport = createErrorTransport(testLogDir);

	t.is(transport.target, 'pino-roll');
	t.is(transport.level, 'error');
	if (transport.options) {
		t.is(
			transport.options.file,
			join(testLogDir, 'nanocoder-error-%Y-%m-%d.log'),
		);
		t.is(transport.options.frequency, 'daily');
		t.is(transport.options.size, '50m');
		t.true(transport.options.mkdir);
		t.true(transport.options.compress);
		t.true(transport.options.sync); // Sync for errors
		if (transport.options.limit) {
			t.is((transport.options.limit as any).count, 90); // Keep more error logs
		}
		t.is(transport.options.minLength, 1024);
	}
});

test('createAuditTransport creates audit-specific transport', t => {
	const transport = createAuditTransport(testLogDir);

	t.is(transport.target, 'pino-roll');
	t.is(transport.level, 'info');
	if (transport.options) {
		t.is(
			transport.options.file,
			join(testLogDir, 'nanocoder-audit-%Y-%m-%d.log'),
		);
		t.is(transport.options.frequency, 'daily');
		t.is(transport.options.size, '200m');
		t.true(transport.options.mkdir);
		t.true(transport.options.compress);
		t.true(transport.options.sync); // Sync for audit
		if (transport.options.limit) {
			t.is((transport.options.limit as any).count, 365); // Keep 1 year of logs
			t.false((transport.options.limit as any).removeOtherLogFiles);
		}
		t.is(transport.options.maxLength, 10485760); // 10MB for audit logs
	}
});

test('getTransportFromEnvironment handles default transport', t => {
	const transport = getTransportFromEnvironment();

	// Should return development transport by default
	if (Array.isArray(transport)) {
		t.is(transport[0].target, 'pino-pretty');
	} else {
		t.is(transport.target, 'pino-pretty');
	}
});

test('getTransportFromEnvironment handles single transport type', t => {
	process.env.LOG_TRANSPORTS = 'production';

	const transport = getTransportFromEnvironment();

	if (Array.isArray(transport)) {
		t.is(transport[0].target, 'pino-roll');
	} else {
		t.is(transport.target, 'pino-roll');
	}
});

test('getTransportFromEnvironment handles multiple transport types', t => {
	process.env.LOG_TRANSPORTS = 'development, production';

	const transports = getTransportFromEnvironment();

	t.true(Array.isArray(transports));
	if (Array.isArray(transports)) {
		t.is(transports.length, 2);
		t.is(transports[0].target, 'pino-pretty');
		t.is(transports[1].target, 'pino-roll');
	}
});

test('getTransportFromEnvironment handles transport aliases', t => {
	const testCases = [
		['dev', 'pino-pretty'],
		['development', 'pino-pretty'],
		['prod', 'pino-roll'],
		['production', 'pino-roll'],
		['test', 'pino/file'],
		['error', 'pino-roll'],
		['audit', 'pino-roll'],
	];

	testCases.forEach(([alias, expectedTarget]) => {
		process.env.LOG_TRANSPORTS = alias;
		const transport = getTransportFromEnvironment();

		if (Array.isArray(transport)) {
			t.is(
				transport[0].target,
				expectedTarget,
				`Alias ${alias} should map to ${expectedTarget}`,
			);
		} else {
			t.is(
				transport.target,
				expectedTarget,
				`Alias ${alias} should map to ${expectedTarget}`,
			);
		}
	});
});

test('getTransportFromEnvironment handles whitespace and commas', t => {
	process.env.LOG_TRANSPORTS = ' development , production , error ';

	const transports = getTransportFromEnvironment();

	t.true(Array.isArray(transports));
	if (Array.isArray(transports)) {
		t.is(transports.length, 3);
	}
});

test('validateTransport accepts valid transport', t => {
	const validTransport: TransportConfig = {
		target: 'pino/file',
		options: {
			destination: '/tmp/test.log',
		},
	};

	t.true(validateTransport(validTransport));
});

test('validateTransport rejects transport without target', t => {
	// Capture console.error to avoid noise in test output
	const originalError = console.error;
	console.error = () => {};

	const invalidTransport = {
		target: '',
		options: {
			destination: '/tmp/test.log',
		},
	};

	t.false(validateTransport(invalidTransport));

	// Restore console.error
	console.error = originalError;
});

test('validateTransport rejects invalid target type', t => {
	const originalError = console.error;
	console.error = () => {};

	const invalidTransport: TransportConfig = {
		target: 123 as any, // Invalid type
		options: {},
	};

	t.false(validateTransport(invalidTransport));

	console.error = originalError;
});

test('validateTransport rejects invalid options type', t => {
	const originalError = console.error;
	console.error = () => {};

	const invalidTransport: TransportConfig = {
		target: 'pino/file',
		options: 'invalid' as any, // Should be object
	};

	t.false(validateTransport(invalidTransport));

	console.error = originalError;
});

test('validateTransport accepts transport without options', t => {
	const validTransport = {
		target: 'pino/file',
	};

	t.true(validateTransport(validTransport));
});

test('createSafeTransport returns primary transport when valid', t => {
	const validTransport = {
		target: 'pino/file',
		options: {
			destination: '/tmp/test.log',
		},
	};

	const transport = createSafeTransport(validTransport);

	t.is(transport, validTransport);
});

test('createSafeTransport falls back to development when both fail', t => {
	const originalError = console.error;
	console.error = () => {};

	const invalidTransport = {
		target: '' as any, // Missing/invalid target
		options: {},
	};

	const invalidFallback = {
		target: 123 as any, // Invalid target type
		options: {},
	};

	const transport = createSafeTransport(invalidTransport, invalidFallback);

	t.is(transport.target, 'pino-pretty'); // Development transport

	console.error = originalError;
});

test('transport configurations have expected structure', t => {
	const devTransport = createDevelopmentTransport();
	const prodTransport = createProductionTransport(testLogDir);
	const testTransport = createTestTransport();

	// All transports should have target property
	t.truthy(devTransport.target);
	t.truthy(prodTransport.target);
	t.truthy(testTransport.target);

	// All transports should have options object
	t.truthy(devTransport.options);
	t.truthy(prodTransport.options);
	t.truthy(testTransport.options);

	// Production transport should have file path
	if (prodTransport.options) {
		t.truthy(prodTransport.options.file);
		t.true((prodTransport.options as any).file.includes(testLogDir));
	}

	// Test transport should output to /dev/null
	if (testTransport.options) {
		t.is(testTransport.options.destination, '/dev/null');
	}
});

test('transport configurations handle edge cases', t => {
	// Custom transport with minimal config
	const minimalConfig = {
		target: 'pino/file',
		options: {},
	};

	const minimalTransport = createCustomTransport(minimalConfig);
	t.is(minimalTransport.target, 'pino/file');
	t.is(minimalTransport.level, 'info'); // Default level
	if (minimalTransport.options) {
		t.is(minimalTransport.options.minLength, 4096); // Default
		t.is(minimalTransport.options.maxLength, 1048576); // Default
	}

	// Custom transport with empty options
	const emptyOptionsConfig = {
		target: 'pino/file',
		options: {},
	};

	const emptyOptionsTransport = createCustomTransport(emptyOptionsConfig);
	t.is(emptyOptionsTransport.target, 'pino/file');
	t.truthy(emptyOptionsTransport.options);
});

test('multi-transport handles environment changes', t => {
	// Test production environment
	process.env.NODE_ENV = 'production';
	const prodTransports = createMultiTransport();
	t.true(Array.isArray(prodTransports));

	// Test development environment
	process.env.NODE_ENV = 'development';
	const devTransports = createMultiTransport();
	t.true(Array.isArray(devTransports));

	// Test with LOG_TO_FILE enabled
	process.env.LOG_TO_FILE = 'true';
	const fileTransports = createMultiTransport();
	t.true(Array.isArray(fileTransports));
	t.true(fileTransports.length >= devTransports.length);
});
