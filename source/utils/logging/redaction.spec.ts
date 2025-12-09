import test from 'ava';
import {existsSync, rmSync, mkdirSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';

console.log(`\nlogging/redaction.spec.ts`);

// Import redaction functions
import {
	createRedactionRules,
	redactValue,
	redactLogEntry,
	redactEmail,
	redactUserId,
	validateRedactionRules,
	DEFAULT_REDACT_PATHS,
} from './redaction.js';

// Import types
import type {PiiRedactionRules} from './types.js';

// Create a temporary test directory
const testDir = join(tmpdir(), `nanocoder-redaction-test-${Date.now()}`);

test.before(() => {
	mkdirSync(testDir, {recursive: true});
});

test.after.always(() => {
	// Clean up test directory
	if (existsSync(testDir)) {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test('DEFAULT_REDACT_PATHS includes common sensitive fields', t => {
	const paths = DEFAULT_REDACT_PATHS;

	t.true(Array.isArray(paths), 'Should return array');
	t.true(paths.includes('apiKey'), 'Should include apiKey');
	t.true(paths.includes('token'), 'Should include token');
	t.true(paths.includes('password'), 'Should include password');
	t.true(paths.includes('secret'), 'Should include secret');
});

test('createRedactionRules creates valid rules', t => {
	const customPaths = ['customField', 'sensitiveData'];
	const rules = createRedactionRules(customPaths);

	t.is(typeof rules, 'object', 'Should return object');
	t.true(Array.isArray(rules.customPaths), 'Should have customPaths array');
	t.true(rules.emailRedaction === true, 'Should enable email redaction by default');
	customPaths.forEach(path => {
		t.true(rules.customPaths.includes(path), `Should include ${path}`);
	});
});

test('redactLogEntry redacts specific fields', t => {
	const data = {
		username: 'john_doe',
		apiKey: 'sk-1234567890',
		password: 'secret123',
		email: 'john@example.com',
		token: 'abc123xyz',
	};

	const rules = createRedactionRules(['apiKey', 'password', 'token']);
	const redacted = redactLogEntry(data, rules);

	t.is(redacted.username, 'john_doe', 'Should not redact username');
	t.is(redacted.email, 'john@example.com', 'Should not redact email');
	t.is(redacted.apiKey, '[REDACTED]', 'Should redact apiKey');
	t.is(redacted.password, '[REDACTED]', 'Should redact password');
	t.is(redacted.token, '[REDACTED]', 'Should redact token');
});

test('redactLogEntry handles nested objects', t => {
	const data = {
		user: {
			id: '123',
			name: 'John',
			apiKey: 'user-api-key',
		},
		request: {
			headers: {
				authorization: 'Bearer secret-token',
				'content-type': 'application/json',
			},
			body: {
				password: 'user-password',
			},
		},
	};

	const rules = createRedactionRules(['apiKey', 'authorization', 'password']);
	const redacted = redactLogEntry(data, rules) as any;

	t.is(redacted.user.id, '123', 'Should not redact user ID');
	t.is(redacted.user.name, 'John', 'Should not redact user name');
	t.is(redacted.user.apiKey, '[REDACTED]', 'Should redact nested apiKey');
	t.is(
		redacted.request.headers.authorization,
		'[REDACTED]',
		'Should redact nested authorization',
	);
	t.is(
		redacted.request.body.password,
		'[REDACTED]',
		'Should redact nested password',
	);
	t.is(
		redacted.request.headers['content-type'],
		'application/json',
		'Should not redact content-type',
	);
});

test('redactLogEntry handles arrays', t => {
	const data = {
		users: [
			{id: '1', name: 'Alice', apiKey: 'alice-key'},
			{id: '2', name: 'Bob', apiKey: 'bob-key'},
			{id: '3', name: 'Charlie', token: 'charlie-token'},
		],
		metadata: {
			tokens: ['token1', 'token2', 'token3'],
		},
	};

	const rules = createRedactionRules(['apiKey', 'token']);
	const redacted = redactLogEntry(data, rules) as any;

	t.is(redacted.users[0].id, '1', 'Should not redact ID');
	t.is(redacted.users[0].name, 'Alice', 'Should not redact name');
	t.is(redacted.users[0].apiKey, '[REDACTED]', 'Should redact apiKey in array');
	t.is(redacted.users[2].token, '[REDACTED]', 'Should redact token in array');
	t.deepEqual(
		redacted.metadata.tokens,
		['token1', 'token2', 'token3'],
		'Should not redact array values not in rules',
	);
});

test('redactLogEntry handles null and undefined values', t => {
	const data = {
		apiKey: null,
		password: undefined,
		token: 'valid-token',
		email: null,
	};

	const rules = createRedactionRules(['apiKey', 'password', 'token', 'email']);
	const redacted = redactLogEntry(data, rules) as any;

	t.is(redacted.apiKey, null, 'Should preserve null values');
	t.is(redacted.password, undefined, 'Should preserve undefined values');
	t.is(redacted.token, '[REDACTED]', 'Should redact valid token');
	t.is(redacted.email, null, 'Should preserve null email');
});

test('redactLogEntry handles empty rules', t => {
	const data = {
		apiKey: 'secret-key',
		password: 'secret-pass',
	};

	const redacted = redactLogEntry(data, createRedactionRules([]));

	t.deepEqual(redacted, data, 'Should return original data with no redaction');
});

test('redactLogEntry applies smart PII detection', t => {
	const data = {
		email: 'john.doe@example.com',
		phone: '+1-555-123-4567',
		ssn: '123-45-6789',
		creditCard: '4111-1111-1111-1111',
		ipAddress: '192.168.1.1',
		regularField: 'not sensitive',
	};

	const redacted = redactLogEntry(data, createRedactionRules([], true, true)) as any;

	t.is(typeof redacted.email, 'string', 'Should return string for email');
	t.true(redacted.email.includes('***'), 'Should mask email partially');
	t.is(typeof redacted.phone, 'string', 'Should return string for phone');
	t.true(redacted.phone.includes('***'), 'Should mask phone partially');
	t.is(redacted.ssn, '[REDACTED]', 'Should fully redact SSN');
	t.is(redacted.creditCard, '[REDACTED]', 'Should fully redact credit card');
	t.is(redacted.ipAddress, '[REDACTED]', 'Should redact IP address');
	t.is(
		redacted.regularField,
		'not sensitive',
		'Should not redact regular field',
	);
});

test('redactLogEntry handles edge cases', t => {
	const data = {
		email: 'invalid-email',
		phone: '123',
		ssn: 'not-a-ssn',
		creditCard: 'not-a-card',
		emptyString: '',
		nullValue: null,
		undefinedValue: undefined,
		number: 12345,
		boolean: true,
		array: ['item1', 'item2'],
	};

	t.notThrows(() => {
		const redacted = redactLogEntry(data, createRedactionRules([]));
		t.is(typeof redacted, 'object', 'Should return object');
	}, 'Should handle edge cases gracefully');
});

test('validateRedactionRules validates rule format', t => {
	// Valid rules
	const validRules = createRedactionRules(['apiKey', 'password', 'token']);
	t.true(validateRedactionRules(validRules), 'Should accept valid rules');

	// Invalid rules - empty array
	const emptyRules = createRedactionRules([]);
	t.true(validateRedactionRules(emptyRules), 'Should accept empty array');

	// Invalid rules - non-array
	t.false(validateRedactionRules(null as any), 'Should reject null');
	t.false(validateRedactionRules(undefined as any), 'Should reject undefined');
	t.false(validateRedactionRules('string' as any), 'Should reject string');

	// Invalid rules - invalid object
	const invalidRules = {
		patterns: 'not an array' as any,
		customPaths: ['valid'],
		emailRedaction: true,
		userIdRedaction: true,
	};
	t.false(validateRedactionRules(invalidRules), 'Should reject invalid patterns');
});

test('createRedactionRules combines rules correctly', t => {
	const allPaths = ['apiKey', 'token', 'password', 'secret', 'email', 'userId'];

	const rules = createRedactionRules(allPaths);

	t.is(typeof rules, 'object', 'Should return object');
	t.true(Array.isArray(rules.customPaths), 'Should have customPaths array');
	t.true(rules.emailRedaction === true, 'Should enable email redaction');
	t.true(rules.userIdRedaction === true, 'Should enable userId redaction');
	t.true(rules.customPaths.includes('apiKey'), 'Should include apiKey');
	t.true(rules.customPaths.includes('token'), 'Should include token');
	t.true(rules.customPaths.includes('password'), 'Should include password');
	t.true(rules.customPaths.includes('secret'), 'Should include secret');
});

test('createRedactionRules handles all provided paths', t => {
	const allPaths = ['apiKey', 'token', 'password', 'secret', 'email'];
	const rules = createRedactionRules(allPaths);

	t.is(typeof rules, 'object', 'Should return object');
	t.is(rules.customPaths.length, 5, 'Should have all custom paths');
	t.true(rules.customPaths.includes('apiKey'), 'Should include apiKey');
	t.true(rules.customPaths.includes('token'), 'Should include token');
	t.true(rules.customPaths.includes('password'), 'Should include password');
	t.true(rules.customPaths.includes('secret'), 'Should include secret');
	t.true(rules.customPaths.includes('email'), 'Should include email');
});

test('createRedactionRules handles empty arrays', t => {
	const rules = ['apiKey', 'token'];

	const rules1 = createRedactionRules(rules);
	t.deepEqual(rules1.customPaths, rules, 'Should handle provided paths');

	const rules2 = createRedactionRules([]);
	t.is(rules2.customPaths.length, 0, 'Should handle empty paths array');

	const rules3 = createRedactionRules();
	t.is(rules3.customPaths.length, 0, 'Should handle no arguments');
});

test('redaction handles complex nested structures', t => {
	const data = {
		level1: {
			level2: {
				level3: {
					apiKey: 'deep-secret',
					safe: 'not-secret',
				},
				password: 'level2-secret',
			},
			token: 'level1-token',
		},
		arrayData: [
			{
				secret: 'array-secret-1',
				public: 'public-1',
			},
			{
				apiKey: 'array-api-key',
				public: 'public-2',
			},
		],
	};

	const rules = createRedactionRules(['apiKey', 'password', 'token', 'secret']);
	const redacted = redactLogEntry(data, rules) as any;

	t.is(
		redacted.level1.level2.level3.apiKey,
		'[REDACTED]',
		'Should redact deep nested apiKey',
	);
	t.is(
		redacted.level1.level2.level3.safe,
		'not-secret',
		'Should preserve safe field',
	);
	t.is(
		redacted.level1.level2.password,
		'[REDACTED]',
		'Should redact nested password',
	);
	t.is(redacted.level1.token, '[REDACTED]', 'Should redact nested token');
	t.is(redacted.arrayData[0].secret, '[REDACTED]', 'Should redact in array');
	t.is(
		redacted.arrayData[0].public,
		'public-1',
		'Should preserve public in array',
	);
	t.is(redacted.arrayData[1].apiKey, '[REDACTED]', 'Should redact in array');
});

test('redaction performance with large objects', t => {
	const largeData: any = {};

	// Create a large object
	for (let i = 0; i < 1000; i++) {
		largeData[`field${i}`] = {
			id: i,
			apiKey: `key-${i}`,
			name: `name-${i}`,
			nested: {
				password: `pass-${i}`,
				value: `value-${i}`,
			},
		};
	}

	const rules = createRedactionRules(['apiKey', 'password']);

	const startTime = performance.now();
	const redacted = redactLogEntry(largeData, rules) as any;
	const endTime = performance.now();

	t.true(endTime - startTime < 1000, 'Should complete within 1 second');
	t.is(redacted.field0.apiKey, '[REDACTED]', 'Should redact in large object');
	t.is(redacted.field0.name, 'name-0', 'Should preserve non-redacted fields');
	t.is(
		redacted.field0.nested.password,
		'[REDACTED]',
		'Should redact nested in large object',
	);
});

test('redaction handles circular references', t => {
	const data: any = {
		apiKey: 'secret-key',
		name: 'test',
	};

	// Create circular reference
	data.self = data;

	t.notThrows(() => {
		const redacted = redactLogEntry(data, createRedactionRules(['apiKey']));
		t.is(
			redacted.apiKey,
			'[REDACTED]',
			'Should redact despite circular reference',
		);
		t.is(redacted.name, 'test', 'Should preserve other fields');
		t.is(redacted.self, redacted, 'Should handle circular reference');
	}, 'Should handle circular references gracefully');
});

test('redactLogEntry recognizes various PII patterns', t => {
	const testData = {
		// Email patterns
		email1: 'user@domain.com',
		email2: 'first.last@sub.domain.co.uk',
		email3: 'user+tag@domain.com',

		// Phone patterns
		phone1: '+1-555-123-4567',
		phone2: '(555) 123-4567',
		phone3: '555.123.4567',
		phone4: '5551234567',

		// SSN patterns
		ssn1: '123-45-6789',
		ssn2: '123456789',

		// Credit card patterns
		cc1: '4111-1111-1111-1111',
		cc2: '4012888888881881',
		cc3: '5555-5555-5555-4444',

		// IP patterns
		ip1: '192.168.1.1',
		ip2: '10.0.0.1',
		ip3: '172.16.0.1',

		// Non-PII
		regularField: 'not sensitive data',
	};

	const redacted = redactLogEntry(testData, createRedactionRules([], true, true));

	// All PII should be redacted or masked
	t.true(redacted.email1 !== 'user@domain.com', 'Should redact email1');
	t.true(
		redacted.email2 !== 'first.last@sub.domain.co.uk',
		'Should redact email2',
	);
	t.true(redacted.phone1 !== '+1-555-123-4567', 'Should redact phone1');
	t.is(redacted.ssn1, '[REDACTED]', 'Should redact SSN');
	t.is(redacted.cc1, '[REDACTED]', 'Should redact credit card');
	t.is(redacted.ip1, '[REDACTED]', 'Should redact IP');

	// Non-PII should be preserved
	t.is(redacted.regularField, 'not sensitive data', 'Should preserve non-PII');
});
