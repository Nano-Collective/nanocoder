import test from 'ava';
import {
	ensureString,
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
} from './type-helpers.js';

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
