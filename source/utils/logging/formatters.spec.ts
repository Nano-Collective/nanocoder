import test from 'ava';

// Implementation imports
import {
	formatLevel,
	formatTimestamp,
	formatTimestampDev,
	serializeError,
	formatProductionLog,
	formatDevelopmentLog,
	createFormatters,
	formatMessage,
	levelColors,
	getLevelColor,
	createPrettyFormatter,
} from './formatters.js';
import type {LogEntry} from './types.js';

test('formatLevel returns uppercase level string', t => {
	const result = formatLevel('info', 30);
	t.deepEqual(result, {level: 'INFO'});
});

test('formatLevel handles different levels', t => {
	const levels = ['debug', 'info', 'warn', 'error', 'fatal'];

	levels.forEach(level => {
		const result = formatLevel(level, 30);
		t.deepEqual(result, {level: level.toUpperCase()});
	});
});

test('formatTimestamp returns ISO string', t => {
	const testTime = Date.now();
	const result = formatTimestamp(testTime);

	t.true(typeof result.time === 'string');
	t.true(result.time.includes('T'));
	t.true(result.time.includes('Z'));
});

test('formatTimestampDev returns human readable time', t => {
	const testTime = Date.now();
	const result = formatTimestampDev(testTime);

	t.true(typeof result.time === 'string');
	// Should be in HH:MM:SS Z format
	t.true(/^\d{2}:\d{2}:\d{2} Z$/.test(result.time));
});

test('serializeError handles Error objects', t => {
	const error = new Error('Test error');
	error.stack = 'Error: Test error\n  at test (test.js:1:1)';

	const result = serializeError(error);

	t.is(result.name, 'Error');
	t.is(result.message, 'Test error');
	t.is(result.stack, error.stack);
});

test('serializeError includes additional error properties', t => {
	const error = new Error('Test error') as any;
	error.code = 'E123';
	error.statusCode = 500;
	error.status = 'error';

	const result = serializeError(error);

	t.is(result.code, 'E123');
	t.is(result.statusCode, 500);
	t.is(result.status, 'error');
});

test('serializeError handles production environment stack limiting', t => {
	const originalEnv = process.env.NODE_ENV;
	process.env.NODE_ENV = 'production';

	const error = new Error('Test error');
	error.stack =
		'Error: Test error\n  at test1 (test.js:1:1)\n  at test2 (test.js:2:1)\n  at test3 (test.js:3:1)\n  at test4 (test.js:4:1)\n  at test5 (test.js:5:1)';

	const result = serializeError(error);

	// In production, stack should be limited to first 3 lines
	const stackLines = result.stack?.split('\n') || [];
	t.true(stackLines.length <= 3);

	process.env.NODE_ENV = originalEnv;
});

test('serializeError returns non-Error objects as-is', t => {
	const nonError = {
		message: 'Not an error',
		custom: 'value',
	} as unknown as Error;
	const result = serializeError(nonError);

	t.deepEqual(result, nonError);
});

test('formatProductionLog formats log entry correctly', t => {
	const logEntry: LogEntry = {
		level: 'info',
		time: '2024-01-15T10:30:00.000Z',
		pid: 12345,
		hostname: 'test-host',
		msg: 'Test message',
		correlationId: 'test-123',
		extraData: 'some value',
	};

	const result = formatProductionLog(logEntry);

	t.is(result.level, 'info');
	t.is(result.time, '2024-01-15T10:30:00.000Z');
	t.is(result.pid, 12345);
	t.is(result.hostname, 'test-host');
	t.is(result.msg, 'Test message');
	t.is(result.correlationId, 'test-123');
	t.is(result.extraData, 'some value');
});

test('formatProductionLog handles Error objects', t => {
	const error = new Error('Test error');
	const logEntry: LogEntry = {
		level: 'error',
		time: '2024-01-15T10:30:00.000Z',
		pid: 12345,
		hostname: 'test-host',
		msg: 'Error occurred',
		error, // This should be serialized
	};

	const result = formatProductionLog(logEntry);

	t.deepEqual(result.error, serializeError(error));
});

test('formatProductionLog handles circular references', t => {
	const circular: any = {id: 1, data: 'test'};
	circular.self = circular;

	const logEntry: LogEntry = {
		level: 'debug',
		time: '2024-01-15T10:30:00.000Z',
		pid: 12345,
		hostname: 'test-host',
		msg: 'Circular test',
		circular,
	};

	t.notThrows(() => {
		formatProductionLog(logEntry);
	}, 'Should handle circular references gracefully');
});

test('formatDevelopmentLog includes pretty time', t => {
	const logEntry: LogEntry = {
		level: 'info',
		time: '2024-01-15T10:30:00.000Z',
		pid: 12345,
		hostname: 'test-host',
		msg: 'Development test',
	};

	const result = formatDevelopmentLog(logEntry);

	t.truthy(result.prettyTime);
	t.true(typeof result.prettyTime === 'string');
	// Should have the same properties as production log
	t.is(result.level, 'info');
	t.is(result.msg, 'Development test');
});

test('createFormatters creates production formatters', t => {
	const formatters = createFormatters(true);

	t.truthy(formatters.level);
	t.truthy(formatters.log);
	t.truthy(formatters.time);
	t.is(typeof formatters.level, 'function');
	t.is(typeof formatters.log, 'function');
	t.is(typeof formatters.time, 'function');
});

test('createFormatters creates development formatters', t => {
	const formatters = createFormatters(false);

	t.truthy(formatters.level);
	t.truthy(formatters.log);
	t.truthy(formatters.time);
	t.is(typeof formatters.level, 'function');
	t.is(typeof formatters.log, 'function');
	t.is(typeof formatters.time, 'function');
});

test('formatMessage replaces template variables', t => {
	const template = 'Hello {name}, level is {level}, value is {custom}';
	const bindings = {name: 'World', custom: 'test-value'};
	const level = 'info';

	const result = formatMessage(template, bindings, level);

	t.is(result, 'Hello World, level is INFO, value is test-value');
});

test('formatMessage handles levelLabel binding', t => {
	const template = 'Level: {levelLabel}, Level: {level}';
	const bindings = {custom: 'value'};
	const level = 'debug';

	const result = formatMessage(template, bindings, level);

	t.is(result, 'Level: debug, Level: DEBUG');
});

test('formatMessage handles missing bindings', t => {
	const template = 'Hello {missing} {name}';
	const bindings = {name: 'World'};
	const level = 'info';

	const result = formatMessage(template, bindings, level);

	t.is(result, 'Hello {missing} World');
});

test('formatMessage handles empty template', t => {
	const template = '';
	const bindings = {name: 'World'};
	const level = 'info';

	const result = formatMessage(template, bindings, level);

	t.is(result, '');
});

test('levelColors contains all required colors', t => {
	const expectedColors = [
		'fatal',
		'error',
		'warn',
		'info',
		'http',
		'debug',
		'trace',
		'reset',
	];

	expectedColors.forEach(color => {
		t.true(color in levelColors, `levelColors should contain ${color}`);
		t.true(
			typeof levelColors[color] === 'string',
			`${color} should be a string`,
		);
	});
});

test('getLevelColor returns correct colors', t => {
	t.is(getLevelColor('error'), levelColors.error);
	t.is(getLevelColor('warn'), levelColors.warn);
	t.is(getLevelColor('info'), levelColors.info);
	t.is(getLevelColor('debug'), levelColors.debug);
	t.is(getLevelColor('trace'), levelColors.trace);
	t.is(getLevelColor('http'), levelColors.http);
	t.is(getLevelColor('fatal'), levelColors.fatal);
});

test('getLevelColor returns info color for unknown levels', t => {
	const unknownLevel = 'unknown';
	t.is(getLevelColor(unknownLevel), levelColors.info);
});

test('getLevelColor handles case insensitive input', t => {
	t.is(getLevelColor('ERROR'), levelColors.error);
	t.is(getLevelColor('WARN'), levelColors.warn);
	t.is(getLevelColor('INFO'), levelColors.info);
});

test('createPrettyFormatter returns valid configuration', t => {
	const formatter = createPrettyFormatter();

	t.truthy(formatter);
	t.is(typeof formatter.translateTime, 'string');
	t.is(typeof formatter.ignore, 'string');
	t.is(typeof formatter.messageFormat, 'string');
	t.truthy(formatter.customPrettifiers);
	t.true(formatter.colorize);
	t.true(formatter.levelFirst);
});

test('createPrettyFormatter has required properties', t => {
	const formatter = createPrettyFormatter();

	t.is(formatter.translateTime, 'SYS:standard');
	t.is(formatter.ignore, 'pid,hostname,time');
	t.is(formatter.messageFormat, '{levelLabel} - {msg}');
	t.true(formatter.colorize);
	t.true(formatter.levelFirst);
});

test('createPrettyFormatter customPrettifiers contain required functions', t => {
	const formatter = createPrettyFormatter();

	t.truthy(formatter.customPrettifiers);
	t.is(typeof formatter.customPrettifiers.time, 'function');
	t.is(typeof formatter.customPrettifiers.level, 'function');
	t.is(typeof formatter.customPrettifiers.hostname, 'function');
});

test('pretty formatter time prettifier returns locale string', t => {
	const formatter = createPrettyFormatter();
	const timestamp = Date.now();

	const result = formatter.customPrettifiers.time(timestamp);

	t.true(typeof result === 'string');
	t.true(/^\d{1,2}:\d{2}:\d{2}/.test(result));
});

test('pretty formatter level prettifier adds colors', t => {
	const formatter = createPrettyFormatter();

	const infoResult = formatter.customPrettifiers.level('info');
	const errorResult = formatter.customPrettifiers.level('error');
	const warnResult = formatter.customPrettifiers.level('warn');

	t.true(infoResult.includes('\x1b[36m')); // Cyan
	t.true(infoResult.includes('\x1b[0m')); // Reset
	t.true(infoResult.includes('INFO'));

	t.true(errorResult.includes('\x1b[31m')); // Red
	t.true(errorResult.includes('\x1b[0m')); // Reset
	t.true(errorResult.includes('ERROR'));

	t.true(warnResult.includes('\x1b[33m')); // Yellow
	t.true(warnResult.includes('\x1b[0m')); // Reset
	t.true(warnResult.includes('WARN'));
});

test('pretty formatter hostname prettifier returns environment', t => {
	const formatter = createPrettyFormatter();
	const originalEnv = process.env.NODE_ENV;

	process.env.NODE_ENV = 'test';
	const testResult = formatter.customPrettifiers.hostname();
	t.is(testResult, 'test');

	delete process.env.NODE_ENV;
	const defaultResult = formatter.customPrettifiers.hostname();
	t.is(defaultResult, 'development');

	process.env.NODE_ENV = originalEnv;
});

test('formatProductionLog handles complex nested objects', t => {
	const complexObject = {
		user: {
			profile: {
				name: 'Test User',
				settings: {
					theme: 'dark',
					notifications: {
						email: true,
						push: false,
					},
				},
			},
		},
		request: {
			headers: {
				'user-agent': 'test-agent',
				accept: 'application/json',
			},
		},
	};

	const logEntry: LogEntry = {
		level: 'info',
		time: '2024-01-15T10:30:00.000Z',
		pid: 12345,
		hostname: 'test-host',
		msg: 'Complex object test',
		...complexObject,
	};

	const result = formatProductionLog(logEntry);

	t.deepEqual(result.user, complexObject.user);
	t.deepEqual(result.request, complexObject.request);
});

test('formatProductionLog excludes system fields from additional properties', t => {
	const logEntry: LogEntry = {
		level: 'info',
		time: '2024-01-15T10:30:00.000Z',
		pid: 12345,
		hostname: 'test-host',
		msg: 'Test message',
		correlationId: 'test-123',
		customField: 'custom value',
		anotherField: 42,
	};

	const result = formatProductionLog(logEntry);

	// Should not have duplicate system fields
	t.is(result.level, 'info');
	t.is(result.time, '2024-01-15T10:30:00.000Z');
	t.is(result.pid, 12345);
	t.is(result.hostname, 'test-host');
	t.is(result.msg, 'Test message');

	// Should include custom fields
	t.is(result.customField, 'custom value');
	t.is(result.anotherField, 42);
});

test('formatters handle edge cases', t => {
	// Empty string level
	const emptyLevelResult = formatLevel('', 0);
	t.deepEqual(emptyLevelResult, {level: ''});

	// Valid timestamps
	const zeroTimeResult = formatTimestamp(0);
	t.true(typeof zeroTimeResult.time === 'string');

	const currentTimeResult = formatTimestamp(Date.now());
	t.true(typeof currentTimeResult.time === 'string');
});

test('formatMessage handles complex templates', t => {
	const template =
		'User {user.name} has {user.count} notifications in category {user.settings.category}';
	const bindings = {
		user: {
			name: 'John',
			count: 5,
			settings: {
				category: 'general',
			},
		},
		extra: 'ignored',
	};
	const level = 'info';

	const result = formatMessage(template, bindings, level);

	// Should only replace top-level keys, not nested ones
	t.is(
		result,
		'User {user.name} has {user.count} notifications in category {user.settings.category}',
	);
});

test('formatMessage handles simple template replacement', t => {
	const template = 'Hello {name}, level is {level}';
	const bindings = {name: 'World'};
	const level = 'info';

	const result = formatMessage(template, bindings, level);

	t.is(result, 'Hello World, level is INFO');
});
