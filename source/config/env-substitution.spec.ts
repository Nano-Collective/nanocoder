import test from 'ava';
import {substituteEnvVars} from './env-substitution';

// Mock logError to avoid console noise during tests
const originalConsoleError = console.error;
test.before(() => {
	console.error = () => {};
});

test.after(() => {
	console.error = originalConsoleError;
});

// ============================================================================
// String Substitution Tests
// ============================================================================

test('substituteEnvVars - returns string with existing env var', t => {
	process.env.TEST_VAR = 'test_value';
	const result = substituteEnvVars('${TEST_VAR}');
	t.is(result, 'test_value');
	delete process.env.TEST_VAR;
});

test('substituteEnvVars - returns string with unbraced env var', t => {
	process.env.MY_VAR = 'my_value';
	const result = substituteEnvVars('$MY_VAR');
	t.is(result, 'my_value');
	delete process.env.MY_VAR;
});

test('substituteEnvVars - uses default value when env var not set', t => {
	const result = substituteEnvVars('${NONEXISTENT:-default_value}');
	t.is(result, 'default_value');
});

test('substituteEnvVars - returns empty string when env var not found and no default', t => {
	const result = substituteEnvVars('${NONEXISTENT_VAR}');
	t.is(result, '');
});

test('substituteEnvVars - returns empty string for unbraced var not found', t => {
	const result = substituteEnvVars('$NONEXISTENT_VAR');
	t.is(result, '');
});

test('substituteEnvVars - substitutes multiple vars in one string', t => {
	process.env.FIRST = 'hello';
	process.env.SECOND = 'world';
	const result = substituteEnvVars('${FIRST} ${SECOND}');
	t.is(result, 'hello world');
	delete process.env.FIRST;
	delete process.env.SECOND;
});

test('substituteEnvVars - handles mixed braced and unbraced vars', t => {
	process.env.VAR1 = 'a';
	process.env.VAR2 = 'b';
	const result = substituteEnvVars('${VAR1} and $VAR2');
	t.is(result, 'a and b');
	delete process.env.VAR1;
	delete process.env.VAR2;
});

test('substituteEnvVars - keeps default value when env var is set but empty', t => {
	process.env.EMPTY_VAR = '';
	const result = substituteEnvVars('${EMPTY_VAR:-default}');
	t.is(result, '');
	delete process.env.EMPTY_VAR;
});

test('substituteEnvVars - default value with special characters', t => {
	const result = substituteEnvVars('${NONEXISTENT:-default:with:special/chars}');
	t.is(result, 'default:with:special/chars');
});

test('substituteEnvVars - handles var name with underscores', t => {
	process.env.MY_VAR_NAME = 'value123';
	const result = substituteEnvVars('${MY_VAR_NAME}');
	t.is(result, 'value123');
	delete process.env.MY_VAR_NAME;
});

test('substituteEnvVars - handles var name with numbers', t => {
	process.env.VAR123 = 'numeric';
	const result = substituteEnvVars('${VAR123}');
	t.is(result, 'numeric');
	delete process.env.VAR123;
});

// ============================================================================
// Non-String Input Tests (lines 6-7)
// ============================================================================

test('substituteEnvVars - returns number unchanged', t => {
	const result = substituteEnvVars(42);
	t.is(result, 42);
});

test('substituteEnvVars - returns boolean unchanged', t => {
	const result = substituteEnvVars(true);
	t.is(result, true);
});

test('substituteEnvVars - returns null unchanged', t => {
	const result = substituteEnvVars(null);
	t.is(result, null);
});

test('substituteEnvVars - returns undefined unchanged', t => {
	const result = substituteEnvVars(undefined);
	t.is(result, undefined);
});

// ============================================================================
// Array Recursion Tests
// ============================================================================

test('substituteEnvVars - substitutes vars in array of strings', t => {
	process.env.ARRAY_VAR = 'array_value';
	const result = substituteEnvVars(['prefix-${ARRAY_VAR}-suffix']);
	t.deepEqual(result, ['prefix-array_value-suffix']);
	delete process.env.ARRAY_VAR;
});

test('substituteEnvVars - handles nested arrays', t => {
	process.env.NESTED = 'nested';
	const result = substituteEnvVars([['${NESTED}']]);
	t.deepEqual(result, [['nested']]);
	delete process.env.NESTED;
});

test('substituteEnvVars - handles array with non-string elements', t => {
	const result = substituteEnvVars(['${VAR}', 42, true, null]);
	// Note: VAR doesn't exist, so ${VAR} becomes empty string
	t.deepEqual(result, ['', 42, true, null]);
});

// ============================================================================
// Object Recursion Tests
// ============================================================================

test('substituteEnvVars - substitutes vars in object values', t => {
	process.env.OBJ_VAR = 'obj_value';
	const result = substituteEnvVars({key: '${OBJ_VAR}'});
	t.deepEqual(result, {key: 'obj_value'});
	delete process.env.OBJ_VAR;
});

test('substituteEnvVars - handles nested objects', t => {
	process.env.NESTED_VAR = 'nested_value';
	const result = substituteEnvVars({
		outer: {
			inner: '${NESTED_VAR}',
		},
	});
	t.deepEqual(result, {
		outer: {
			inner: 'nested_value',
		},
	});
	delete process.env.NESTED_VAR;
});

test('substituteEnvVars - handles object with multiple keys', t => {
	process.env.KEY1 = 'val1';
	process.env.KEY2 = 'val2';
	const result = substituteEnvVars({
		first: '${KEY1}',
		second: '${KEY2}',
		third: 'literal',
	});
	t.deepEqual(result, {
		first: 'val1',
		second: 'val2',
		third: 'literal',
	});
	delete process.env.KEY1;
	delete process.env.KEY2;
});

test('substituteEnvVars - handles mixed object with arrays and strings', t => {
	process.env.MIXED = 'mixed';
	const result = substituteEnvVars({
		str: '${MIXED}',
		arr: ['${MIXED}'],
		nested: {
			deep: '${MIXED}',
		},
	});
	t.deepEqual(result, {
		str: 'mixed',
		arr: ['mixed'],
		nested: {
			deep: 'mixed',
		},
	});
	delete process.env.MIXED;
});

// ============================================================================
// Edge Cases
// ============================================================================

test('substituteEnvVars - handles empty string', t => {
	const result = substituteEnvVars('');
	t.is(result, '');
});

test('substituteEnvVars - handles string without env vars', t => {
	const result = substituteEnvVars('just a literal string');
	t.is(result, 'just a literal string');
});

test('substituteEnvVars - handles string with only partial matches', t => {
	process.env.PART = 'REPLACED';
	const result = substituteEnvVars('part${PART}ial');
	t.is(result, 'partREPLACEDial');
	delete process.env.PART;
});

test('substituteEnvVars - handles special regex characters in value', t => {
	process.env.SPECIAL = 'test/value/here';
	const result = substituteEnvVars('${SPECIAL}');
	t.is(result, 'test/value/here');
	delete process.env.SPECIAL;
});

test('substituteEnvVars - complex config object', t => {
	process.env.HOST = 'localhost';
	process.env.PORT = '8080';
	process.env.USER = 'admin';
	const result = substituteEnvVars({
		server: {
			host: '${HOST}',
			port: '${PORT}',
			ssl: true,
		},
		auth: {
			username: '${USER}',
			password: '${PASSWORD:-default123}',
		},
		endpoints: ['${HOST}/api', '${HOST}/health'],
	});
	t.deepEqual(result, {
		server: {
			host: 'localhost',
			port: '8080',
			ssl: true,
		},
		auth: {
			username: 'admin',
			password: 'default123',
		},
		endpoints: ['localhost/api', 'localhost/health'],
	});
	delete process.env.HOST;
	delete process.env.PORT;
	delete process.env.USER;
});

// ============================================================================
// Escaped Dollar Tests ($$)
// ============================================================================

test('substituteEnvVars - supports $$ escape sequence for literal $', t => {
	const result = substituteEnvVars('pa$$WORD');
	t.is(result, 'pa$WORD');
});

test('substituteEnvVars - preserves literal $ in secrets and api keys', t => {
	const result = substituteEnvVars('sk-$$ECRET-key');
	t.is(result, 'sk-$ECRET-key');
});

test('substituteEnvVars - preserves $$ in args and strings', t => {
	const result = substituteEnvVars('price $$USD 5');
	t.is(result, 'price $USD 5');
});

test('substituteEnvVars - handles $$ with valid env var substitution', t => {
	process.env.TEST_FOO = 'bar';
	const result = substituteEnvVars('$$TEST_FOO is $TEST_FOO');
	t.is(result, '$TEST_FOO is bar');
	delete process.env.TEST_FOO;
});

test('substituteEnvVars - handles consecutive $$ escapes', t => {
	const result = substituteEnvVars('$$$$');
	t.is(result, '$$');
});

test('substituteEnvVars - supports $$ escape in default values', t => {
	const result = substituteEnvVars('${MISSING_VAR:-pa$$WORD}');
	t.is(result, 'pa$WORD');
});

test('substituteEnvVars - preserves $VAR in default values without expanding', t => {
	const result = substituteEnvVars('${MISSING_VAR:-literal $NOT_EXPANDED}');
	t.is(result, 'literal $NOT_EXPANDED');
});

test('substituteEnvVars - prevents prototype pollution with __proto__ key', t => {
	const malicious = JSON.parse('{"__proto__": {"polluted": true}, "valid": "data"}');
	const result = substituteEnvVars(malicious) as Record<string, unknown>;
	t.is(result.valid, 'data');
	t.is(result.polluted, undefined, 'the result must not inherit the injected key');
	t.is(Object.getPrototypeOf(result), Object.prototype, 'the prototype must be intact');
	t.false(Object.hasOwn(result, '__proto__'), 'the hostile key must not become an own property');
});
