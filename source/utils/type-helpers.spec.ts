import test from 'ava';
import {
	ensureString,
	getArrayFromObject,
	getBooleanFromObject,
	getNumberFromObject,
	getObjectFromObject,
	isEmpty,
	isArray,
	isBoolean,
	isFunction,
	isNull,
	isNotEmpty,
	isNumber,
	isObject,
	isPlainObject,
	isString,
	isUndefined,
	getStringFromObject,
	toStringSafe,
	toRequiredString,
	toJSONString,
	clone,
	getTypeName,
} from './type-helpers.js';

test('toRequiredString returns empty string for null', t => {
	t.is(toRequiredString(null), '');
});

test('toRequiredString returns empty string for undefined', t => {
	t.is(toRequiredString(undefined), '');
});

test('toRequiredString returns string as-is', t => {
	t.is(toRequiredString('hello'), 'hello');
});

test('toRequiredString converts number to string', t => {
	t.is(toRequiredString(42), '42');
});

test('toRequiredString converts boolean to string', t => {
	t.is(toRequiredString(true), 'true');
	t.is(toRequiredString(false), 'false');
});

test('toRequiredString converts array to JSON string', t => {
	t.is(toRequiredString([1, 2, 3]), '[1,2,3]');
});

test('toRequiredString converts object to JSON string', t => {
	t.is(toRequiredString({key: 'value'}), '{"key":"value"}');
});

test('ensureString returns string as-is (for display)', t => {
	t.is(ensureString('hello'), 'hello');
});

test('ensureString converts number to string (for display)', t => {
	t.is(ensureString(42), '42');
});

test('isArray type guard works correctly', t => {
	t.true(isArray([1, 2, 3]));
	t.false(isArray({key: 'value'}));
	t.false(isArray('string'));
	t.false(isArray(42));
	t.false(isArray(null));
	t.false(isArray(undefined));
});

test('isString type guard works correctly', t => {
	t.true(isString('hello'));
	t.false(isString(42));
	t.false(isString(null));
	t.false(isString(undefined));
	t.false(isString({}));
});

test('isObject type guard works correctly', t => {
	t.true(isObject({key: 'value'}));
	t.true(isObject({}));
	t.false(isObject('string'));
	t.false(isObject(42));
	t.false(isObject(null));
	t.false(isObject(undefined));
	t.false(isObject([1, 2, 3]));
});

test('isPlainObject type guard works correctly', t => {
	t.true(isPlainObject({key: 'value'}));
	t.true(isPlainObject({}));
	t.false(isPlainObject('string'));
	t.false(isPlainObject(42));
	t.false(isPlainObject(null));
	t.false(isPlainObject(undefined));
	t.false(isPlainObject([1, 2, 3]));
});

test('isNumber type guard works correctly', t => {
	t.true(isNumber(42));
	t.false(isNumber('42'));
	t.false(isNumber(null));
	t.false(isNumber(undefined));
});

test('isBoolean type guard works correctly', t => {
	t.true(isBoolean(true));
	t.true(isBoolean(false));
	t.false(isBoolean('true'));
	t.false(isBoolean(null));
	t.false(isBoolean(undefined));
});

test('isNull type guard works correctly', t => {
	t.true(isNull(null));
	t.false(isNull(undefined));
	t.false(isNull(''));
});

test('isUndefined type guard works correctly', t => {
	t.true(isUndefined(undefined));
	t.false(isUndefined(null));
	t.false(isUndefined(''));
});

test('isEmpty returns true for null, undefined, empty string, empty array, empty object', t => {
	t.true(isEmpty(null));
	t.true(isEmpty(undefined));
	t.true(isEmpty(''));
	t.true(isEmpty([]));
	t.true(isEmpty({}));
});

test('isEmpty returns false for non-empty values', t => {
	t.false(isEmpty('hello'));
	t.false(isEmpty([1, 2, 3]));
	t.false(isEmpty({key: 'value'}));
});

test('isNotEmpty returns true for non-empty values', t => {
	t.true(isNotEmpty('hello'));
	t.true(isNotEmpty([1, 2, 3]));
	t.true(isNotEmpty({key: 'value'}));
});

test('isNotEmpty returns false for null, undefined, empty string, empty array, empty object', t => {
	t.false(isNotEmpty(null));
	t.false(isNotEmpty(undefined));
	t.false(isNotEmpty(''));
	t.false(isNotEmpty([]));
	t.false(isNotEmpty({}));
});

test('toStringSafe returns string as-is', t => {
	t.is(toStringSafe('hello'), 'hello');
});

test('toStringSafe converts number to string', t => {
	t.is(toStringSafe(42), '42');
});

test('toStringSafe converts boolean to string', t => {
	t.is(toStringSafe(true), 'true');
	t.is(toStringSafe(false), 'false');
});

test('toStringSafe converts array to JSON string', t => {
	t.is(toStringSafe([1, 2, 3]), '[1,2,3]');
});

test('toStringSafe converts object to JSON string', t => {
	t.is(toStringSafe({key: 'value'}), '{"key":"value"}');
});

test('toStringSafe returns fallback for unknown types', t => {
	t.is(toStringSafe(null, {fallback: 'null'}), 'null');
	t.is(toStringSafe(undefined, {fallback: 'undefined'}), 'undefined');
});

test('toJSONString returns null for null/undefined', t => {
	t.is(toJSONString(null), 'null');
	t.is(toJSONString(undefined), 'null');
});

test('toJSONString returns string as-is', t => {
	t.is(toJSONString('hello'), 'hello');
});

test('toJSONString converts number to string', t => {
	t.is(toJSONString(42), '42');
});

test('toJSONString converts boolean to string', t => {
	t.is(toJSONString(true), 'true');
	t.is(toJSONString(false), 'false');
});

test('toJSONString converts array to JSON string', t => {
	t.is(toJSONString([1, 2, 3]), '[1,2,3]');
});

test('toJSONString converts object to JSON string', t => {
	t.is(toJSONString({key: 'value'}), '{"key":"value"}');
});

test('toJSONString handles replacer function', t => {
	const replacer = (key: string, value: unknown): unknown => {
		if (key === 'secret') {
			return '***';
		}
		return value;
	};
	t.is(toJSONString({name: 'test', secret: 'password'}, {replacer}), '{"name":"test","secret":"***"}');
});

test('toJSONString handles custom indent', t => {
	t.is(toJSONString({a: 1, b: 2}, {indent: 4}), '{\n    "a": 1,\n    "b": 2\n}');
});

test('toJSONString handles spaceAfterComma option', t => {
	t.is(toJSONString({a: 1, b: 2}, {spaceAfterComma: false}), '{"a":1,"b":2}');
});

test('toStringSafe handles custom indent and space', t => {
	t.is(toStringSafe({a: 1, b: 2}, {indent: 2, space: ' '}), '{\n  "a": 1,\n  "b": 2\n}');
});

test('getStringFromObject extracts string value', t => {
	const obj = {name: 'test', value: 'hello'};
	t.is(getStringFromObject(obj, 'name'), 'test');
	t.is(getStringFromObject(obj, 'value'), 'hello');
});

test('getStringFromObject returns fallback for non-string values', t => {
	const obj = {name: 123, value: null};
	t.is(getStringFromObject(obj, 'name', 'default'), 'default');
	t.is(getStringFromObject(obj, 'value', 'default'), 'default');
});

test('getStringFromObject returns fallback for missing key', t => {
	const obj = {name: 'test'};
	t.is(getStringFromObject(obj, 'missing', 'default'), 'default');
});

test('getNumberFromObject extracts number value', t => {
	const obj = {count: 42, value: 3.14};
	t.is(getNumberFromObject(obj, 'count'), 42);
	t.is(getNumberFromObject(obj, 'value'), 3.14);
});

test('getNumberFromObject returns fallback for non-number values', t => {
	const obj = {count: '42', value: null};
	t.is(getNumberFromObject(obj, 'count', 0), 0);
	t.is(getNumberFromObject(obj, 'value', 0), 0);
});

test('getNumberFromObject returns fallback for missing key', t => {
	const obj = {count: 42};
	t.is(getNumberFromObject(obj, 'missing', 0), 0);
});

test('getBooleanFromObject extracts boolean value', t => {
	const obj = {enabled: true, flag: false};
	t.is(getBooleanFromObject(obj, 'enabled'), true);
	t.is(getBooleanFromObject(obj, 'flag'), false);
});

test('getBooleanFromObject returns fallback for non-boolean values', t => {
	const obj = {enabled: 'true', flag: null};
	t.is(getBooleanFromObject(obj, 'enabled', false), false);
	t.is(getBooleanFromObject(obj, 'flag', false), false);
});

test('getBooleanFromObject returns fallback for missing key', t => {
	const obj = {enabled: true};
	t.is(getBooleanFromObject(obj, 'missing', false), false);
});

test('getArrayFromObject extracts array value', t => {
	const obj = {items: [1, 2, 3], tags: ['a', 'b', 'c']};
	t.is(getArrayFromObject(obj, 'items').length, 3);
	t.is(getArrayFromObject(obj, 'tags').length, 3);
});

test('getArrayFromObject returns fallback for non-array values', t => {
	const obj = {items: 'not an array', tags: null};
	t.deepEqual(getArrayFromObject(obj, 'items', []), []);
	t.deepEqual(getArrayFromObject(obj, 'tags', []), []);
});

test('getArrayFromObject returns fallback for missing key', t => {
	const obj = {items: [1, 2, 3]};
	t.deepEqual(getArrayFromObject(obj, 'missing', []), []);
});

test('getObjectFromObject extracts object value', t => {
	const obj = {config: {a: 1, b: 2}, metadata: {x: 10, y: 20}};
	t.deepEqual(getObjectFromObject(obj, 'config'), {a: 1, b: 2});
	t.deepEqual(getObjectFromObject(obj, 'metadata'), {x: 10, y: 20});
});

test('getObjectFromObject returns fallback for non-object values', t => {
	const obj = {config: 'not an object', metadata: null};
	t.deepEqual(getObjectFromObject(obj, 'config', {}), {});
	t.deepEqual(getObjectFromObject(obj, 'metadata', {}), {});
});

test('getObjectFromObject returns fallback for missing key', t => {
	const obj = {config: {a: 1, b: 2}};
	t.deepEqual(getObjectFromObject(obj, 'missing', {}), {});
});

test('getTypeName returns correct type names', t => {
	t.is(getTypeName(null), 'null');
	t.is(getTypeName(undefined), 'undefined');
	t.is(getTypeName('hello'), 'string');
	t.is(getTypeName(42), 'number');
	t.is(getTypeName(true), 'boolean');
	t.is(getTypeName([1, 2, 3]), 'array');
	t.is(getTypeName({key: 'value'}), 'object');
});

test('clone preserves types', t => {
	const original = {name: 'test', value: 42, items: [1, 2, 3]};
	const cloned = clone(original);
	t.is(cloned.name, original.name);
	t.is(cloned.value, original.value);
	t.deepEqual(cloned.items, original.items);
});

test('clone handles null and undefined', t => {
	t.is(clone(null), null);
	t.is(clone(undefined), undefined);
});

test('clone handles primitive types', t => {
	t.is(clone('hello'), 'hello');
	t.is(clone(42), 42);
	t.is(clone(true), true);
});

test('clone handles arrays', t => {
	const original = [1, 2, 3];
	const cloned = clone(original);
	t.deepEqual(cloned, original);
	t.not(cloned, original); // Should be a new array
});

test('clone handles objects', t => {
	const original = {a: 1, b: 2};
	const cloned = clone(original);
	t.deepEqual(cloned, original);
	t.not(cloned, original); // Should be a new object
});
